-- T12.5 — member feedback, and the first two things an anonymous visitor may read.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- THIS FILE OPENS THE FIRST DOOR TO `anon`, AND ONLY TWO FUNCTIONS WIDE.
--
-- 006 established that the anon key with no session reads zero rows from every
-- table: every policy is `to authenticated`, and `npm run supabase:check`
-- asserts it against the live project. That stays true after this file. No
-- policy here is `to anon` and no table gains an anon read.
--
-- What anon gains is EXECUTE on two definer functions, for the public landing
-- page (T12.5):
--
--   public_stats()      four integers — clans, members, CWL seasons, wars
--   public_feedback()   approved quotes: body, rating, username, one clan name
--
-- Nothing else. No tag, no player name, no email, no user id, no war result.
-- If the landing page ever needs more, widen a function's OUTPUT on purpose,
-- in a file that says so — the rule 038 wrote about clans and 041 followed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- FEEDBACK IS REAL OR IT IS NOT SHOWN
--
-- The alternative to this table was quotes typed into the landing page, which
-- nobody said. Every quote the public sees came from a signed-in, approved
-- member, and was approved again by the platform admin before it appeared.
-- ─────────────────────────────────────────────────────────────────────────────


create table feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users (id) on delete restrict,
  rating      smallint not null,
  body        text not null,
  -- pending until the platform admin decides. 'hidden' is a decision, not a
  -- deletion (R4): the row and who hid it survive.
  status      text not null default 'pending',
  reviewed_by uuid references users (id) on delete restrict,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz,

  constraint feedback_rating_range check (rating between 1 and 5),
  -- Ten characters minimum: "good" is not feedback anyone can learn from, and a
  -- public quote of one word reads as padding.
  constraint feedback_body_length check (char_length(body) between 10 and 500),
  constraint feedback_status check (status in ('pending', 'approved', 'hidden'))
);

-- One PENDING item per member. A second submission while the first is waiting
-- replaces it (submit_feedback below) rather than queueing — the admin reviews
-- what the member thinks now, not a history of drafts.
create unique index feedback_one_pending_idx
  on feedback (user_id)
  where status = 'pending' and deleted_at is null;

-- The landing page read: approved, newest first.
create index feedback_approved_idx
  on feedback (created_at desc)
  where status = 'approved' and deleted_at is null;

create trigger feedback_set_updated_at
  before update on feedback
  for each row execute function set_updated_at();

alter table feedback enable row level security;

create policy "read own feedback" on feedback
  for select to authenticated
  using (user_id = auth.uid());

create policy "platform admin reads all feedback" on feedback
  for select to authenticated
  using (auth_is_platform_admin());

-- SELECT only. Every write is a function below, because approving is a
-- decision that must be recorded (R4) and a member must not be able to set
-- their own quote to 'approved'.
grant select on feedback to authenticated;
grant select on feedback to service_role;

comment on table feedback is
  'T12.5 — member feedback. Public only once status = approved, and then only '
  'through public_feedback(), which returns no email and no user id.';


-- ---------------------------------------------------------------------------
-- submit_feedback — a member says something.
--
-- Returns the row id, or null when refused. Approved and not removed only:
-- a pending account has not been let in yet and has nothing to review, and a
-- removed one (039) has had its voice taken with its access.
-- ---------------------------------------------------------------------------
create or replace function submit_feedback(p_rating smallint, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing uuid;
  result   uuid;
begin
  if auth.uid() is null then
    return null;
  end if;

  if not exists (
    select 1 from public.users
    where id = auth.uid() and status = 'approved' and deleted_at is null
  ) then
    return null;
  end if;

  select id into existing
  from public.feedback
  where user_id = auth.uid() and status = 'pending' and deleted_at is null;

  if existing is not null then
    update public.feedback
    set rating = p_rating, body = btrim(p_body)
    where id = existing
    returning id into result;
  else
    insert into public.feedback (user_id, rating, body)
    values (auth.uid(), p_rating, btrim(p_body))
    returning id into result;
  end if;

  return result;
end;
$$;

revoke execute on function submit_feedback(smallint, text) from public;
grant execute on function submit_feedback(smallint, text) to authenticated;


-- ---------------------------------------------------------------------------
-- review_feedback — the platform admin decides what the public sees.
--
-- Platform admin only, not clan leaders: the landing page speaks for the whole
-- platform, and one clan's leader choosing what represents three clans is the
-- wrong authority. Audited with clan_id null, which the platform admin can
-- read since 039.
-- ---------------------------------------------------------------------------
create or replace function review_feedback(p_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_id is null then
    return false;
  end if;

  if not public.auth_is_platform_admin() then
    return false;
  end if;

  if p_status not in ('approved', 'hidden') then
    return false;
  end if;

  update public.feedback
  set status = p_status,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_id and deleted_at is null;

  if not found then
    return false;
  end if;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), null, 'review', 'feedback', p_id,
          jsonb_build_object('status', p_status));

  return true;
end;
$$;

revoke execute on function review_feedback(uuid, text) from public;
grant execute on function review_feedback(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- public_feedback — what the landing page shows. The first anon-callable read.
--
-- The author is named by username, never by email, and by the ONE clan they
-- belong to first by tag — enough to be believable as a real member, not
-- enough to look anybody up. A member whose access was removed disappears from
-- the page with them.
-- ---------------------------------------------------------------------------
create or replace function public_feedback(p_limit integer default 6)
returns table (
  body       text,
  rating     smallint,
  author     text,
  clan       text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.body,
    f.rating,
    coalesce(u.username, u.display_name, 'A member'),
    (
      select c.name
      from public.clan_roles cr
      join public.clans c on c.id = cr.clan_id and c.deleted_at is null
      where cr.user_id = u.id and cr.deleted_at is null
      order by c.tag
      limit 1
    ),
    f.created_at
  from public.feedback f
  join public.users u on u.id = f.user_id and u.deleted_at is null
  where f.status = 'approved'
    and f.deleted_at is null
  order by f.created_at desc
  -- Capped here, not only by the caller: anon controls p_limit.
  limit least(greatest(coalesce(p_limit, 6), 1), 12)
$$;

revoke execute on function public_feedback(integer) from public;
grant execute on function public_feedback(integer) to anon, authenticated;


-- ---------------------------------------------------------------------------
-- public_stats — four totals for the landing page.
--
-- Integers only. Counts of approved accounts rather than of players, because
-- "members using this" is the claim the page makes; the in-game roster size is
-- a Supercell fact and says nothing about this product.
-- ---------------------------------------------------------------------------
create or replace function public_stats()
returns table (
  clans        integer,
  members      integer,
  cwl_seasons  integer,
  wars         integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.clans where deleted_at is null)::integer,
    (select count(*) from public.users
       where deleted_at is null and status = 'approved')::integer,
    (select count(*) from public.cwl_seasons where deleted_at is null)::integer,
    (select count(*) from public.wars where deleted_at is null)::integer
$$;

revoke execute on function public_stats() from public;
grant execute on function public_stats() to anon, authenticated;


-- ---------------------------------------------------------------------------
-- Verify by hand, with the ANON key and no session:
--
--   select * from public_stats();        -- one row of four integers
--   select * from public_feedback();     -- approved quotes only
--   select count(*) from feedback;       -- 0 — the table itself stays closed
--   select count(*) from users;          -- 0 — unchanged since 006
-- ---------------------------------------------------------------------------
