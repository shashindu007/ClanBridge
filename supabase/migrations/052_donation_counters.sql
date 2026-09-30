-- 052 — Season donations that survive a clan move.
--
-- THE PROBLEM. member_snapshots.donations is the clan counter Supercell keeps,
-- and Supercell zeroes it twice: at the monthly reset, and whenever the player
-- leaves a clan. A member who moves from clan X to clan Y mid-season therefore
-- shows only what they gave in Y, and what they gave in X is gone from the game.
--
-- TWO SOURCES, USED TOGETHER (services/season-donations.ts does the arithmetic):
--
--   A. member_snapshots, which already holds every hourly reading WITH the clan
--      it was taken in. Split each player's readings wherever the clan changes
--      or the counter drops, and each piece's last reading is what they gave in
--      that clan: xa, ya, ... donation_segments() below does the splitting.
--
--   B. The lifetime achievement counters — "Friend in Need" (troop capacity),
--      "Sharing is caring" (spell capacity), "Siege Sharer" (siege machines).
--      They never reset, not at the month and not on a clan move, and they count
--      donations made in ANY clan. donation_counters stores them.
--
-- WHY THE CLAN COUNTERS ARE STORED BESIDE THE ACHIEVEMENTS. One /players/{tag}
-- response carries both, read at the same instant. While a player stays in one
-- clan, (achievement - clan counter) is constant: it is the achievement value at
-- the moment that clan's counter was zero. That constant is what lets B tell the
-- donations missed between two hourly readings (still ours) apart from those
-- made in a clan outside the platform — and if it is NOT constant, the two
-- counters do not measure the same thing and B is not used. Storing them apart
-- would lose the instant that makes the comparison valid.
--
-- The three achievements are stored separately rather than summed, because
-- they count in different units (capacity, capacity, machines) and which sum
-- matches the clan counter is checked against real data, not assumed.
--
-- SIZE. One row per village per UTC day, ~100 villages: about 36,000 rows and a
-- few MB a year against the 500 MB tier. Written by the daily players sync from
-- the response it already fetches, so it costs no API calls and no Action
-- minutes. donation_segments() adds no storage at all.
--
-- A GAME FACT (R11), append-only (R5), the same privileges 036 gives
-- player_progress. clan_id is the clan the API reported at capture, null when
-- that is no platform clan; the clan policy then hides the row from everyone,
-- which is right — it is not about any clan a member belongs to.

create table donation_counters (
  id                       uuid primary key default gen_random_uuid(),
  player_id                uuid not null references players (id) on delete restrict,
  clan_id                  uuid references clans (id) on delete restrict,
  captured_at              timestamptz not null default now(),

  troops_donated           integer,   -- "Friend in Need", lifetime troop capacity
  spells_donated           integer,   -- "Sharing is caring", lifetime spell capacity
  sieges_donated           integer,   -- "Siege Sharer", lifetime siege machines
  clan_donations           integer,   -- the clan counter, same response
  clan_donations_received  integer,

  created_at               timestamptz not null default now(),
  deleted_at               timestamptz,

  -- `at time zone 'UTC'` for the reason 007 records: it is what makes the
  -- generated column immutable.
  captured_day             timestamp generated always as
                             (date_trunc('day', captured_at at time zone 'UTC')) stored,

  unique (player_id, captured_day)
);

create index donation_counters_clan_idx
  on donation_counters (clan_id, captured_at desc)
  where deleted_at is null;

alter table donation_counters enable row level security;

create policy "read own clan donation counters" on donation_counters
  for select to authenticated
  using (clan_id in (select auth_clan_ids()));

grant select on donation_counters to anon, authenticated;
grant select, insert on donation_counters to service_role;
revoke update, delete on donation_counters from service_role;

comment on table donation_counters is
  '052 - one daily reading per village of its lifetime donation achievements and '
  'its clan donation counters, taken from the same /players response. A GAME FACT '
  '(R11): written only by scripts/sync/players.ts, append-only (R5).';


-- ---------------------------------------------------------------------------
-- Each player's readings, cut into one piece per stay in a clan.
--
-- A new piece starts where the clan changes ('clan') or either counter falls
-- ('drop' — the monthly reset, or leaving and rejoining the same clan; the
-- service tells those apart, because a reset drops half the family in the same
-- hour and a rejoin drops one player). The first reading in the window is
-- 'first': the piece may have begun earlier.
--
-- `given` and `received` are the piece's LAST reading, which is its total,
-- because the counter is cumulative within a stay — services/members.ts has the
-- long version of why the last value is right and summing deltas is wrong.
--
-- Done here rather than in TypeScript because a season is ~60,000 hourly rows
-- across the family and PostgREST returns 1,000 at a time; this returns a few
-- hundred. Readings with no donation value are skipped rather than read as
-- zero, so a sync gap is not mistaken for a reset.
--
-- SECURITY INVOKER: no new access. The caller's RLS on member_snapshots decides
-- which rows exist, and p_clan_ids is the explicit filter R3 asks for on top.
-- ---------------------------------------------------------------------------
create or replace function donation_segments(p_clan_ids uuid[], p_since timestamptz)
returns table (
  player_id     uuid,
  clan_id       uuid,
  started_at    timestamptz,
  ended_at      timestamptz,
  start_reason  text,
  given         integer,
  received      integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with points as (
    select s.player_id, s.clan_id, s.captured_at, s.donations, s.donations_received,
           lag(s.clan_id) over w            as prev_clan,
           lag(s.donations) over w          as prev_given,
           lag(s.donations_received) over w as prev_received
    from public.member_snapshots s
    where s.clan_id = any (p_clan_ids)
      and s.captured_at >= p_since
      and s.deleted_at is null
      and s.donations is not null
      and s.donations_received is not null
    window w as (partition by s.player_id order by s.captured_at)
  ),
  marked as (
    select p.*,
           case
             when p.prev_clan is null then 'first'
             when p.prev_clan <> p.clan_id then 'clan'
             when p.donations < p.prev_given
               or p.donations_received < p.prev_received then 'drop'
           end as reason
    from points p
  ),
  numbered as (
    -- count() skips nulls, so this is a running piece number per player.
    select m.*, count(m.reason) over (partition by m.player_id order by m.captured_at) as piece
    from marked m
  )
  select n.player_id,
         n.clan_id,
         min(n.captured_at),
         max(n.captured_at),
         (array_agg(n.reason order by n.captured_at))[1],
         (array_agg(n.donations order by n.captured_at desc))[1],
         (array_agg(n.donations_received order by n.captured_at desc))[1]
  from numbered n
  group by n.player_id, n.clan_id, n.piece
  order by n.player_id, min(n.captured_at);
$$;

revoke execute on function donation_segments(uuid[], timestamptz) from public;
grant execute on function donation_segments(uuid[], timestamptz) to authenticated, service_role;
