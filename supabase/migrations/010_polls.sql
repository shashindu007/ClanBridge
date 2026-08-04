-- T4B.1 — Poll tables
--
-- NOTE: 009 is intentionally absent. It held cwl_signups from the superseded
-- T4.9, which Phase 4B replaced with polls + rosters. Nothing was ever applied.
--
-- R11 — HUMAN DECISION DATA. Written only by people through the application.
-- No sync job may ever write to these tables. A 2 AM job that touches them
-- silently erases an hour of the leader's work, and R4 means there is no deleted
-- row to recover.
--
-- scripts/sync/shared.ts lists all three tables in its "MUST NEVER WRITE" block.


-- ---------------------------------------------------------------------------
-- Leadership, as a set of clan ids.
--
-- 006 gave us auth_clan_ids() (any role) and auth_leader_clan_ids() (leader
-- only). Polls need the band between them: a co-leader may open a poll and read
-- who answered, an elder may not. Adding it here rather than widening
-- auth_leader_clan_ids(), because that function guards audit_log and quietly
-- letting co-leaders read the audit trail would be a different decision made by
-- accident.
-- ---------------------------------------------------------------------------
create or replace function auth_leadership_clan_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select clan_id
  from public.clan_roles
  where user_id = auth.uid()
    and role in ('leader', 'co-leader')
    and deleted_at is null
$$;

grant execute on function auth_leadership_clan_ids() to anon, authenticated;

comment on function auth_leadership_clan_ids() is
  'Clans where the caller is leader or co-leader. Distinct from '
  'auth_leader_clan_ids(), which guards audit_log and stays leader-only.';


-- ---------------------------------------------------------------------------
-- polls
--
-- `scope` is the whole reason this table is not just clan_id.
--
--   'clan'    one clan answers. War availability, a question for one roster.
--   'family'  every clan answers at once, and clan_id is NULL.
--
-- A CWL availability poll is 'family': the leader is choosing across all clans
-- together (T4B.7), so asking each clan separately would produce three lists
-- that have to be merged by hand — which is the spreadsheet this project exists
-- to delete.
-- ---------------------------------------------------------------------------
create table polls (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('clan', 'family')),
  clan_id     uuid references clans (id) on delete restrict,
  season      text,
  poll_type   text not null
              check (poll_type in ('cwl_availability', 'war_availability', 'general')),
  title       text not null,
  question    text,
  opens_at    timestamptz,
  closes_at   timestamptz,
  status      text not null default 'open'
              check (status in ('draft', 'open', 'closed')),
  created_by  uuid not null references users (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz,
  deleted_at  timestamptz,

  -- The pairing that makes `scope` mean something. A 'clan' poll with no clan is
  -- unanswerable; a 'family' poll with one is a lie about who it is for, and
  -- both would slip past a policy that only reads clan_id.
  constraint polls_scope_clan check (
    (scope = 'clan'   and clan_id is not null) or
    (scope = 'family' and clan_id is null)
  )
);

create index polls_clan_id_idx on polls (clan_id, created_at desc) where deleted_at is null;
create index polls_open_idx on polls (status, closes_at) where deleted_at is null;

create trigger polls_set_updated_at
  before update on polls
  for each row execute function set_updated_at();


create table poll_options (
  id          uuid primary key default gen_random_uuid(),
  poll_id     uuid not null references polls (id) on delete restrict,
  label       text not null,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now(),
  deleted_at  timestamptz,

  -- Two options reading "Maybe" on one poll is a data-entry slip that makes the
  -- result meaningless and cannot be spotted in a bar chart.
  unique (poll_id, label)
);

create index poll_options_poll_id_idx on poll_options (poll_id, sort_order)
  where deleted_at is null;


-- ---------------------------------------------------------------------------
-- poll_responses
--
-- Answers belong to a PLAYER, not a user. A member may own more than one Clash
-- account (Architecture.md 7.1), and CWL availability is a question about a
-- village — "can this account play" — not about a person.
--
-- updated_at is kept deliberately: a leader building a roster needs to see that
-- someone flipped from In to Out an hour before the deadline, which is invisible
-- if the edit overwrites silently (T4B.3).
-- ---------------------------------------------------------------------------
create table poll_responses (
  id            uuid primary key default gen_random_uuid(),
  poll_id       uuid not null references polls (id) on delete restrict,
  player_id     uuid not null references players (id) on delete restrict,
  option_id     uuid not null references poll_options (id) on delete restrict,
  note          text,
  responded_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz,
  deleted_at    timestamptz,

  -- One answer per player, editable until the poll closes.
  unique (poll_id, player_id)
);

create index poll_responses_poll_id_idx on poll_responses (poll_id)
  where deleted_at is null;
create index poll_responses_player_id_idx on poll_responses (player_id)
  where deleted_at is null;

create trigger poll_responses_set_updated_at
  before update on poll_responses
  for each row execute function set_updated_at();


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table polls          enable row level security;
alter table poll_options   enable row level security;
alter table poll_responses enable row level security;

-- A family poll is visible to anyone in any clan; a clan poll only to that clan.
create policy "read visible polls" on polls
  for select to authenticated
  using (
    (scope = 'family' and exists (select 1 from auth_clan_ids()))
    or clan_id in (select auth_clan_ids())
  );

create policy "leadership creates polls" on polls
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      (scope = 'clan' and clan_id in (select auth_leadership_clan_ids()))
      -- A family poll spans every clan, so leadership anywhere may open one.
      or (scope = 'family' and exists (select 1 from auth_leadership_clan_ids()))
    )
  );

create policy "leadership updates polls" on polls
  for update to authenticated
  using (
    (scope = 'clan' and clan_id in (select auth_leadership_clan_ids()))
    or (scope = 'family' and exists (select 1 from auth_leadership_clan_ids()))
  );

create policy "read options of visible polls" on poll_options
  for select to authenticated
  using (exists (select 1 from polls p where p.id = poll_options.poll_id));

create policy "leadership writes options" on poll_options
  for insert to authenticated
  with check (
    exists (
      select 1 from polls p
      where p.id = poll_options.poll_id
        and ((p.scope = 'clan' and p.clan_id in (select auth_leadership_clan_ids()))
             or (p.scope = 'family' and exists (select 1 from auth_leadership_clan_ids())))
    )
  );

-- ── The rule T4B.4 states: "Members see counts; leadership sees names." ──
--
-- Enforced here rather than by hiding a column in the UI, because a member with
-- the anon key and a REST client is not looking at the UI. A member reads their
-- OWN answers; leadership of the poll's clan reads everyone's. Counts for
-- everybody else come from poll_option_counts() below, which aggregates inside a
-- definer function and so never exposes a row.
create policy "read own or led responses" on poll_responses
  for select to authenticated
  using (
    player_id in (select id from players where user_id = auth.uid())
    or exists (
      select 1 from polls p
      where p.id = poll_responses.poll_id
        and ((p.scope = 'clan' and p.clan_id in (select auth_leadership_clan_ids()))
             or (p.scope = 'family' and exists (select 1 from auth_leadership_clan_ids())))
    )
  );

-- You answer for a player you have verified as yours, and only while the poll is
-- open. The closes_at check lives in the policy, not the form: a closed poll that
-- can still be edited by a crafted request is a poll whose result is not final.
create policy "answer for your own player" on poll_responses
  for insert to authenticated
  with check (
    player_id in (select id from players where user_id = auth.uid() and deleted_at is null)
    and exists (
      select 1 from polls p
      where p.id = poll_responses.poll_id
        and p.status = 'open'
        and (p.closes_at is null or p.closes_at > now())
    )
  );

create policy "change your own answer" on poll_responses
  for update to authenticated
  using (
    player_id in (select id from players where user_id = auth.uid() and deleted_at is null)
    and exists (
      select 1 from polls p
      where p.id = poll_responses.poll_id
        and p.status = 'open'
        and (p.closes_at is null or p.closes_at > now())
    )
  )
  with check (
    player_id in (select id from players where user_id = auth.uid() and deleted_at is null)
  );


-- ---------------------------------------------------------------------------
-- poll_option_counts — the aggregate a member is allowed to see.
--
-- Definer, so it reads past the row-level policy above and returns only totals.
-- The caller still has to be able to see the poll itself, checked explicitly:
-- without that this would happily count a poll belonging to a clan they are not
-- in, which is the shape of leak R3 exists to prevent.
-- ---------------------------------------------------------------------------
create or replace function poll_option_counts(p_poll uuid)
returns table (option_id uuid, label text, sort_order smallint, votes bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.polls p
    where p.id = p_poll
      and p.deleted_at is null
      and ((p.scope = 'family' and exists (select 1 from public.auth_clan_ids()))
           or p.clan_id in (select public.auth_clan_ids()))
  ) then
    return;
  end if;

  return query
    select o.id, o.label, o.sort_order, count(r.id)
    from public.poll_options o
    left join public.poll_responses r
      on r.option_id = o.id and r.deleted_at is null
    where o.poll_id = p_poll
      and o.deleted_at is null
    group by o.id, o.label, o.sort_order
    order by o.sort_order, o.label;
end;
$$;

revoke execute on function poll_option_counts(uuid) from public;
grant execute on function poll_option_counts(uuid) to authenticated;


grant select on polls, poll_options, poll_responses to anon, authenticated;
grant insert, update on polls, poll_options, poll_responses to authenticated;
grant select, insert, update on polls, poll_options, poll_responses to service_role;

-- No delete grant, for anybody. R4.
