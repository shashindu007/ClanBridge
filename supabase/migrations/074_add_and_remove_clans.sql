-- Adding a clan part-way through a season, and taking one away.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY A NEW CLAN NEEDS A LINEUP MADE FOR IT.
--
-- A season's lineups were only created by pressing "Create draft lineups", once.
-- A clan added afterwards had none, and its leader had no way to pick. The admin
-- adding a clan holds no role in it yet, so RLS refuses that insert from the
-- application; add_clan() does both in one transaction instead.
--
-- It only ever inserts this clan's rows. Other clans' lineups are not touched.
--
-- Which seasons is the caller's question: lib/roster-view.ts holds the CWL
-- calendar, and that does not belong in SQL as well. A season no other clan has
-- started is left alone, since starting one is the leader's decision.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- R4 — REMOVING A CLAN DELETES NOTHING.
--
-- The clan, its live lineups and its live roles all get the same deleted_at, and
-- that timestamp is how adding the tag back finds exactly what was removed:
-- something retired earlier, like a role a leader had taken away, stays retired.
--
-- The lineups are withdrawn, not just hidden, because 011's double-booking guard
-- counts live lineups: a player picked for a removed clan could otherwise never
-- be picked for another clan that season.
--
-- The roles are retired because auth_clan_ids() reads clan_roles alone, so a role
-- in a removed clan would keep opening the family-wide reads (037, 038, 073).
--
-- WHO: the platform admin, or a leader of that clan. Not a co-leader, the same
-- line 044 draws around roles.

create or replace function add_clan(p_tag text, p_name text, p_seasons text[])
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clan    uuid;
  v_deleted timestamptz;
  v_result  text;
begin
  if auth.uid() is null or not public.auth_is_platform_admin() then
    return 'refused';
  end if;

  select id, deleted_at into v_clan, v_deleted
  from public.clans
  where tag = p_tag;

  if v_clan is not null and v_deleted is null then
    return 'exists';
  end if;

  if v_clan is null then
    insert into public.clans (tag, name)
    values (p_tag, p_name)
    returning id into v_clan;
    v_result := 'added';
  else
    update public.clans set deleted_at = null where id = v_clan;
    update public.clan_roles set deleted_at = null
    where clan_id = v_clan and deleted_at = v_deleted;
    update public.cwl_rosters set deleted_at = null
    where clan_id = v_clan and deleted_at = v_deleted;

    -- Whoever was picked elsewhere while this clan was gone stays picked there.
    -- 011's guard only runs when a pick is written, so it cannot catch this.
    update public.cwl_roster_members m
    set deleted_at = now()
    from public.cwl_rosters r
    where r.id = m.roster_id
      and r.clan_id = v_clan
      and r.deleted_at is null
      and m.deleted_at is null
      and exists (
        select 1
        from public.cwl_roster_members other
        join public.cwl_rosters other_roster on other_roster.id = other.roster_id
        where other.player_id = m.player_id
          and other.deleted_at is null
          and other_roster.deleted_at is null
          and other_roster.season = r.season
          and other_roster.clan_id <> v_clan
      );

    v_result := 'restored';
  end if;

  insert into public.cwl_rosters (clan_id, season, created_by)
  select v_clan, s.season, auth.uid()
  from unnest(p_seasons) as s (season)
  where exists (
    select 1
    from public.cwl_rosters r
    join public.clans c on c.id = r.clan_id
    where r.season = s.season
      and r.clan_id <> v_clan
      and r.deleted_at is null
      and c.deleted_at is null
  )
  on conflict (clan_id, season) do nothing;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), v_clan, 'add-clan', 'clans', v_clan,
          jsonb_build_object('tag', p_tag, 'result', v_result));

  return v_result;
end;
$$;

revoke execute on function add_clan(text, text, text[]) from public;
grant execute on function add_clan(text, text, text[]) to authenticated;

comment on function add_clan(text, text, text[]) is
  '074 — the platform admin adds a clan, or brings a removed one back, and gives '
  'it a draft lineup for each of these seasons another clan has already started.';


create or replace function remove_clan(p_clan uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_tag text;
begin
  if auth.uid() is null or p_clan is null then
    return false;
  end if;

  if not public.auth_is_platform_admin()
     and p_clan not in (select public.auth_leader_clan_ids()) then
    return false;
  end if;

  update public.clans
  set deleted_at = v_now
  where id = p_clan and deleted_at is null
  returning tag into v_tag;

  if v_tag is null then
    return false;
  end if;

  update public.cwl_rosters set deleted_at = v_now
  where clan_id = p_clan and deleted_at is null;
  update public.clan_roles set deleted_at = v_now
  where clan_id = p_clan and deleted_at is null;

  insert into public.audit_log (user_id, clan_id, action, entity, entity_id, after)
  values (auth.uid(), p_clan, 'remove-clan', 'clans', p_clan,
          jsonb_build_object('tag', v_tag));

  return true;
end;
$$;

revoke execute on function remove_clan(uuid) from public;
grant execute on function remove_clan(uuid) to authenticated;

comment on function remove_clan(uuid) is
  '074 — a leader of the clan or the platform admin retires it, its lineups and '
  'its roles under one timestamp. add_clan() with the same tag undoes it.';
