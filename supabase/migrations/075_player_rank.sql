-- A player's rank, worked out in one place.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THE DATABASE OWNS RANK.
--
-- /rating printed each row's position, so two players on the same rating got
-- different numbers, decided by their names, and filtering to a clan quietly
-- turned the same column into a position inside that clan. Home and the profile
-- need the number too, and a second calculation would be a second answer.
--
-- Ties share a rank and the next one skips: 1, 2, 2, 4. `tied` says so, because
-- a rank alone cannot.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- R3 — NO NEW EXCEPTION.
--
-- player_rating_history() reads only through family_player_ratings(), so 073's
-- guard and its list of what is returned both still decide everything. It adds
-- a way to ask for fewer rows, and nothing a member could not already read.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THERE IS NO NEW INDEX.
--
-- A rank needs the whole month, and 073's unique (month, player_id) serves that.
-- An index leading with player_id would not be used.
--
-- `rated_players` counts players with any marks, not any rating: ratings can be
-- negative, and marks can cancel to a rating of zero.

-- Dropped first: a change of return type cannot be replaced in place (071).
drop function family_player_ratings(text);

create function family_player_ratings(p_month text)
returns table (
  player_id       uuid,
  clan_id         uuid,
  clan_tag        text,
  clan_name       text,
  tag             text,
  name            text,
  th_level        integer,
  donation_marks  numeric,
  war_marks       numeric,
  cwl_marks       numeric,
  games_marks     numeric,
  raid_marks      numeric,
  donation_share  numeric,
  war_share       numeric,
  cwl_share       numeric,
  games_share     numeric,
  raid_share      numeric,
  rating          numeric,
  computed_at     timestamptz,
  family_rank     integer,
  family_size     integer,
  tied            boolean,
  clan_rank       integer,
  clan_size       integer,
  rated_players   integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with live as (
    select
      r.player_id,
      r.clan_id,
      c.tag as clan_tag,
      c.name as clan_name,
      p.tag as player_tag,
      p.name as player_name,
      p.th_level::integer as player_th,
      r.donation_marks,
      r.war_marks,
      r.cwl_marks,
      r.games_marks,
      r.raid_marks,
      r.donation_share,
      r.war_share,
      r.cwl_share,
      r.games_share,
      r.raid_share,
      r.rating,
      r.computed_at
    from public.player_ratings r
    join public.players p on p.id = r.player_id and p.deleted_at is null
    join public.clans c on c.id = r.clan_id and c.deleted_at is null
    where r.month = p_month
      and r.computed_at = (
        select max(l.computed_at) from public.player_ratings l where l.month = p_month
      )
      and (
        exists (select 1 from public.auth_clan_ids())
        or current_setting('role', true) = 'service_role'
      )
  )
  select
    live.player_id,
    live.clan_id,
    live.clan_tag,
    live.clan_name,
    live.player_tag,
    live.player_name,
    live.player_th,
    live.donation_marks,
    live.war_marks,
    live.cwl_marks,
    live.games_marks,
    live.raid_marks,
    live.donation_share,
    live.war_share,
    live.cwl_share,
    live.games_share,
    live.raid_share,
    live.rating,
    live.computed_at,
    (rank() over (order by live.rating desc))::integer,
    (count(*) over ())::integer,
    (count(*) over (partition by live.rating)) > 1,
    (rank() over (partition by live.clan_id order by live.rating desc))::integer,
    (count(*) over (partition by live.clan_id))::integer,
    (count(*) filter (
      where live.donation_marks <> 0
         or live.war_marks <> 0
         or live.cwl_marks <> 0
         or live.games_marks <> 0
         or live.raid_marks <> 0
    ) over ())::integer
  from live
  order by live.rating desc, live.player_name
  limit 2000
$$;

revoke execute on function family_player_ratings(text) from public, anon;
grant execute on function family_player_ratings(text) to authenticated, service_role;

comment on function family_player_ratings(text) is
  '075 - every family player''s rating and rank for one month (family-wide, a '
  'deliberate R3 exception alongside 037 and 038). Marks and shares only, no raw '
  'donations or attacks. Returns nothing to a caller holding no clan role.';


-- ---------------------------------------------------------------------------
-- A few players' recent months, for Home and the profile.
--
-- One row per requested player per month with a ranking, so a player absent from
-- a month is a row with a null rank rather than a gap: "not in October's ranking"
-- and "October has no ranking" are different things to tell someone.
--
-- Each month is read once however many players are asked for. Capped, as 071's
-- function is, because the cost is the caller's to choose.
-- ---------------------------------------------------------------------------
create function player_rating_history(p_players uuid[], p_months integer)
returns table (
  player_id       uuid,
  month           text,
  rated_players   integer,
  family_size     integer,
  family_rank     integer,
  tied            boolean,
  clan_rank       integer,
  clan_size       integer,
  clan_id         uuid,
  clan_tag        text,
  clan_name       text,
  donation_marks  numeric,
  war_marks       numeric,
  cwl_marks       numeric,
  games_marks     numeric,
  raid_marks      numeric,
  donation_share  numeric,
  war_share       numeric,
  cwl_share       numeric,
  games_share     numeric,
  raid_share      numeric,
  rating          numeric,
  computed_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if coalesce(cardinality(p_players), 0) > 500 then
    raise exception 'player_rating_history: at most 500 players per call, got %',
      cardinality(p_players)
      using errcode = '22023';
  end if;

  return query
  with wanted as (
    select distinct requested.id
    from unnest(coalesce(p_players, '{}'::uuid[])) as requested(id)
  ),
  recent as (
    select m.month
    from public.family_rating_months() m
    limit least(greatest(coalesce(p_months, 1), 1), 12)
  ),
  ranked as materialized (
    select recent.month as rated_month, f.*
    from recent
    cross join lateral public.family_player_ratings(recent.month) f
  ),
  totals as (
    select distinct on (ranked.rated_month)
      ranked.rated_month,
      ranked.rated_players,
      ranked.family_size
    from ranked
  )
  select
    wanted.id,
    totals.rated_month,
    totals.rated_players,
    totals.family_size,
    r.family_rank,
    r.tied,
    r.clan_rank,
    r.clan_size,
    r.clan_id,
    r.clan_tag,
    r.clan_name,
    r.donation_marks,
    r.war_marks,
    r.cwl_marks,
    r.games_marks,
    r.raid_marks,
    r.donation_share,
    r.war_share,
    r.cwl_share,
    r.games_share,
    r.raid_share,
    r.rating,
    r.computed_at
  from totals
  cross join wanted
  left join ranked r
    on r.rated_month = totals.rated_month
   and r.player_id = wanted.id
  order by wanted.id, totals.rated_month desc;
end;
$$;

revoke execute on function player_rating_history(uuid[], integer) from public, anon;
grant execute on function player_rating_history(uuid[], integer) to authenticated, service_role;

comment on function player_rating_history(uuid[], integer) is
  '075 - the newest months of family_player_ratings() for up to 500 players, with '
  'a null rank where a player is absent from a month. Reads only through that '
  'function, so its guard and its columns decide what comes back.';


-- ---------------------------------------------------------------------------
-- Verify by hand, as a member of clan A:
--
--   select name, rating, family_rank, tied, clan_rank
--   from family_player_ratings('2026-10');
--
--   select month, family_rank, family_size
--   from player_rating_history(array['<a player id>']::uuid[], 6);
-- ---------------------------------------------------------------------------
