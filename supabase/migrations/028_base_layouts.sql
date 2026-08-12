-- Phase 8 — everything base_layouts needs that 004 and 006 did not give it.
--
-- 004 created the table. 006 gave it a SELECT policy and stopped, so the library
-- has been readable and unwritable since the first week of this project. That is
-- now the fourth time: 021 (announcements), 022 (cwl_bonuses), 023
-- (push_subscriptions) each had to add the write path for a table that already
-- existed, and each header said the same thing. Stating it once more because the
-- pattern is the finding:
--
--   A POLICY IS NOT A GRANT. Postgres checks the table privilege first, so a
--   missing `grant insert` fails with "permission denied for table" and the
--   policy is never evaluated at all — an error that reads like a bug in the
--   route rather than a missing line in a migration (014, 023).
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY VOTES NEED A TABLE AND NOT JUST THE COUNTER 004 ALREADY HAS
--
-- base_layouts.votes is an integer. An integer cannot answer the only question
-- voting actually has to answer, which is "have I already voted for this one?"
-- Without that, every vote button is a +1 button, one member can hold it down,
-- and the ranking becomes a measure of who cared most rather than what the clan
-- thinks. It also cannot be undone, because there is no record of who to undo.
--
-- So base_layout_votes carries one row per member per layout, with a unique
-- constraint doing the enforcing. The counter stays as a maintained cache — the
-- definer functions below move both in the same statement, so they cannot come
-- apart, and browse-by-popularity stays a sort rather than an aggregate per row.
--
-- R4 — a withdrawn vote is SOFT deleted, like everything else here. The first
-- draft of this file argued for a real DELETE, on the grounds that a retracted
-- vote is somebody changing their mind rather than history worth keeping. The
-- suite rejected it (`contains no DELETE statements`), and the suite was right:
-- 023 had already solved exactly this shape for notification_preferences with a
-- PARTIAL unique index, so a soft-deleted row does not block writing a fresh
-- one. An invariant that holds everywhere is worth more than a table-sized
-- exception, and the exception bought nothing this does not.
-- ─────────────────────────────────────────────────────────────────────────────


-- ---------------------------------------------------------------------------
-- base_layout_votes — one member, one layout, one live vote.
-- ---------------------------------------------------------------------------
create table base_layout_votes (
  id         uuid primary key default gen_random_uuid(),
  layout_id  uuid not null references base_layouts (id) on delete restrict,
  user_id    uuid not null references users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

-- The whole point, and PARTIAL so R4's tombstone does not block a re-vote.
-- Without the constraint the counter is a click tally; without the `where` a
-- member who unvotes can never vote again.
create unique index base_layout_votes_one_per_member_idx
  on base_layout_votes (layout_id, user_id)
  where deleted_at is null;

create index base_layout_votes_layout_idx on base_layout_votes (layout_id)
  where deleted_at is null;

create trigger base_layout_votes_set_updated_at
  before update on base_layout_votes
  for each row execute function set_updated_at();

alter table base_layout_votes enable row level security;

-- Readable by members of the clan that owns the layout, so a page can show
-- "you voted" rather than only a total. The clan check goes through the layout,
-- because a vote row has no clan of its own (R3 — the filter is still there, it
-- is one join away).
create policy "read votes on own clan layouts" on base_layout_votes
  for select to authenticated
  using (
    layout_id in (
      select id from base_layouts
      where clan_id in (select auth_clan_ids())
        and deleted_at is null
    )
  );

grant select on base_layout_votes to authenticated;
-- No insert or update grant to authenticated ANYWHERE. Voting happens only
-- through the definer functions below, which is what keeps the counter and the
-- rows in step. A member who could insert directly could add a vote row without
-- moving the counter, and nothing would ever notice.
grant select, insert, update on base_layout_votes to service_role;


-- ---------------------------------------------------------------------------
-- Writes on base_layouts itself.
--
-- Any member may upload — a good base is a good base regardless of rank, and
-- restricting this to leadership would empty the library. Editing and removing
-- are limited to the uploader or the clan's leadership.
-- ---------------------------------------------------------------------------
create policy "members add layouts to their own clan" on base_layouts
  for insert to authenticated
  with check (
    clan_id in (select auth_clan_ids())
    and uploaded_by = auth.uid()
  );

-- Update rather than delete, because R4 means removal is `deleted_at`, and that
-- is an UPDATE. Both the uploader and leadership can reach it; the WITH CHECK
-- repeats the USING clause so a row cannot be updated out of its own clan.
create policy "uploader or leadership edits a layout" on base_layouts
  for update to authenticated
  using (
    clan_id in (select auth_clan_ids())
    and (uploaded_by = auth.uid() or clan_id in (select auth_leadership_clan_ids()))
  )
  with check (
    clan_id in (select auth_clan_ids())
    and (uploaded_by = auth.uid() or clan_id in (select auth_leadership_clan_ids()))
  );

grant select, insert, update on base_layouts to authenticated;
grant select on base_layouts to anon;
grant select, insert, update on base_layouts to service_role;


-- ---------------------------------------------------------------------------
-- vote_for_layout(layout) / unvote_layout(layout)
--
-- Definer functions rather than policies, for the reason 021 gives: the vote row
-- and the counter must move together or not at all. Two statements from the
-- application is two statements that can be interrupted between, and the visible
-- symptom is a layout whose displayed score disagrees with the number of people
-- who actually voted — with nothing to say which is right.
--
-- Returns the new total so the caller can render it without a second read.
-- ---------------------------------------------------------------------------
create or replace function vote_for_layout(p_layout uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan  uuid;
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  -- R3 — the caller must be in the layout's clan, checked here rather than
  -- trusted to the page. A definer function bypasses RLS, so this IS the check.
  select clan_id into v_clan
  from public.base_layouts
  where id = p_layout and deleted_at is null;

  if v_clan is null then
    raise exception 'layout not found';
  end if;

  if v_clan not in (select public.auth_clan_ids()) then
    raise exception 'layout not found';  -- deliberately not "forbidden": see below
  end if;

  -- Already voted: a no-op returning the current total, not an error. A
  -- double-tap on a phone is not a mistake worth showing somebody.
  if exists (
    select 1 from public.base_layout_votes
    where layout_id = p_layout and user_id = auth.uid() and deleted_at is null
  ) then
    select votes into v_total from public.base_layouts where id = p_layout;
    return v_total;
  end if;

  -- Revive a withdrawn vote if there is one, otherwise record a new one. Two
  -- statements rather than an upsert because the partial index means ON CONFLICT
  -- would have to name the predicate, and a resurrection is a different event
  -- from a first vote even though both end with the same row.
  update public.base_layout_votes
  set deleted_at = null
  where layout_id = p_layout and user_id = auth.uid() and deleted_at is not null;

  if not found then
    insert into public.base_layout_votes (layout_id, user_id)
    values (p_layout, auth.uid());
  end if;

  update public.base_layouts
  set votes = votes + 1
  where id = p_layout
  returning votes into v_total;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), v_clan, 'vote', 'base_layouts', p_layout,
          jsonb_build_object('votes', v_total));

  return v_total;
end;
$$;

revoke execute on function vote_for_layout(uuid) from public;
grant execute on function vote_for_layout(uuid) to authenticated;


create or replace function unvote_layout(p_layout uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan  uuid;
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select clan_id into v_clan
  from public.base_layouts
  where id = p_layout and deleted_at is null;

  if v_clan is null or v_clan not in (select public.auth_clan_ids()) then
    raise exception 'layout not found';
  end if;

  -- R4 — the row stays, marked. The partial unique index above is what lets the
  -- same member vote again later without colliding with this tombstone.
  update public.base_layout_votes
  set deleted_at = now()
  where layout_id = p_layout and user_id = auth.uid() and deleted_at is null;

  if found then
    -- greatest(...) rather than a bare subtraction. The counter is a cache, and
    -- a cache that can go negative renders "-1 votes" forever with no way for a
    -- member to correct it.
    update public.base_layouts
    set votes = greatest(votes - 1, 0)
    where id = p_layout
    returning votes into v_total;

    insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
    values (auth.uid(), v_clan, 'unvote', 'base_layouts', p_layout,
            jsonb_build_object('votes', v_total));
  else
    select votes into v_total from public.base_layouts where id = p_layout;
  end if;

  return v_total;
end;
$$;

revoke execute on function unvote_layout(uuid) from public;
grant execute on function unvote_layout(uuid) to authenticated;


comment on table base_layout_votes is
  'T8.5 — one live vote per member per layout. The partial unique index is the '
  'rule; base_layouts.votes is a cache the definer functions keep in step with '
  'it. Withdrawing a vote sets deleted_at (R4), and the index''s predicate is '
  'what lets the same member vote again afterwards.';

comment on function vote_for_layout(uuid) is
  'T8.5 — record a vote and bump the counter in one statement. Raises '
  '"layout not found" for a layout outside the caller''s clans, deliberately: '
  'a distinct "forbidden" would confirm that the id exists.';


-- ---------------------------------------------------------------------------
-- Verify:
--
--   -- a member of the clan can vote, once:
--   select vote_for_layout('<layout>');   -- 1
--   select vote_for_layout('<layout>');   -- 1, unchanged
--   select unvote_layout('<layout>');     -- 0
--   select unvote_layout('<layout>');     -- 0, never negative
--
--   -- a member of another clan cannot, and cannot tell it exists:
--   select vote_for_layout('<layout>');   -- ERROR: layout not found
--
--   -- and cannot reach the table directly:
--   insert into base_layout_votes (layout_id, user_id)
--   values ('<layout>', auth.uid());      -- permission denied for table
-- ---------------------------------------------------------------------------
