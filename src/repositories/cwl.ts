// T4.3 — CWL reads. Every function takes a clanId and reaches it.
//
// ─────────────────────────────────────────────────────────────────────────────
// HOW THE CLAN FILTER WORKS HERE, AND WHY IT IS NOT .eq("clan_id", clanId)
//
// README.md in this directory gives a worked example ending
//
//     .from("cwl_attacks").select("*").eq("war_id", warId).eq("clan_id", clanId)
//
// That column does not exist. cwl_attacks has no clan_id, and neither does
// cwl_wars or cwl_war_members — the chain is
//
//     cwl_attacks -> cwl_wars -> cwl_seasons.clan_id
//
// which is exactly the shape of the RLS policy in 006_rls.sql:172-181. So R3 is
// satisfied here by resolving the season (or the war) under an explicit clan
// filter FIRST, and only then reading its children by id. The id handed to the
// child query has already been proven to belong to the caller's clan; a war id
// from another clan simply never gets that far.
//
// That is a real filter, not a formality: RLS would also deny it, but R3 exists
// because the policy is the net and the query is the mechanism.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CwlSeason {
  id: string;
  season: string;
  league: string | null;
}

export interface CwlWar {
  id: string;
  warTag: string;
  dayNumber: number | null;
  opponentName: string | null;
  opponentTag: string | null;
  teamSize: number | null;
  state: string | null;
  ourStars: number | null;
  theirStars: number | null;
  ourDestruction: number | null;
  theirDestruction: number | null;
  result: string | null;
  endTime: string | null;
}

export interface CwlRosterEntry {
  playerId: string;
  tag: string;
  name: string;
  mapPosition: number | null;
  thLevel: number | null;
}

export interface CwlAttack {
  playerId: string;
  attackOrder: number;
  stars: number;
  destruction: number;
  defenderTag: string | null;
  defenderPosition: number | null;
}

/** Every season this clan has CWL data for, newest first. */
export async function seasonsForClan(
  supabase: SupabaseClient,
  clanId: string,
): Promise<CwlSeason[]> {
  const { data, error } = await supabase
    .from("cwl_seasons")
    .select("id, season, league")
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .order("season");

  if (error || !data) return [];
  // Newest first. `.order()` in the PGlite stand-in has no descending option, so
  // the reversal happens here and behaves identically in both.
  return (data as CwlSeason[]).slice().reverse();
}

/**
 * One season by its 'YYYY-MM' string, or null.
 *
 * The clan filter is what makes every later query in the page safe: once a
 * season id has been resolved under `clan_id = <this clan>`, its wars and their
 * attacks are known to belong here.
 */
export async function seasonByName(
  supabase: SupabaseClient,
  clanId: string,
  season: string,
): Promise<CwlSeason | null> {
  const { data, error } = await supabase
    .from("cwl_seasons")
    .select("id, season, league")
    .eq("clan_id", clanId) // R3
    .eq("season", season)
    .is("deleted_at", null);

  if (error || !data) return null;
  return (data as CwlSeason[])[0] ?? null;
}

/** The wars of one season, in day order. `seasonId` must already be clan-checked. */
export async function warsInSeason(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<CwlWar[]> {
  const { data, error } = await supabase
    .from("cwl_wars")
    .select(
      "id, war_tag, day_number, opponent_name, opponent_tag, team_size, state, " +
        "our_stars, their_stars, our_destruction, their_destruction, result, end_time",
    )
    .eq("season_id", seasonId)
    .is("deleted_at", null)
    .order("day_number");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    warTag: r.war_tag as string,
    dayNumber: (r.day_number as number | null) ?? null,
    opponentName: (r.opponent_name as string | null) ?? null,
    opponentTag: (r.opponent_tag as string | null) ?? null,
    teamSize: (r.team_size as number | null) ?? null,
    state: (r.state as string | null) ?? null,
    ourStars: (r.our_stars as number | null) ?? null,
    theirStars: (r.their_stars as number | null) ?? null,
    ourDestruction: r.our_destruction === null ? null : Number(r.our_destruction),
    theirDestruction: r.their_destruction === null ? null : Number(r.their_destruction),
    result: (r.result as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
  }));
}

/**
 * The roster the API reported for one war, with player names attached.
 *
 * Two queries rather than an embedded select: the PostgREST join syntax is not
 * supported by the PGlite stand-in the tests run against, and a roster is at
 * most 30 rows so the second round trip costs nothing.
 */
export async function rosterForWar(
  supabase: SupabaseClient,
  warId: string,
): Promise<CwlRosterEntry[]> {
  const { data, error } = await supabase
    .from("cwl_war_members")
    .select("player_id, map_position, th_level")
    .eq("war_id", warId)
    .is("deleted_at", null)
    .order("map_position");

  if (error || !data) return [];
  const rows = data as Array<{
    player_id: string;
    map_position: number | null;
    th_level: number | null;
  }>;
  if (!rows.length) return [];

  const names = await playerNames(
    supabase,
    rows.map((r) => r.player_id),
  );

  return rows.map((r) => ({
    playerId: r.player_id,
    tag: names.get(r.player_id)?.tag ?? "",
    name: names.get(r.player_id)?.name ?? "Unknown player",
    mapPosition: r.map_position,
    thLevel: r.th_level,
  }));
}

/** The attacks recorded for one war. A player who did not attack has no row (R5/002). */
export async function attacksForWar(
  supabase: SupabaseClient,
  warId: string,
): Promise<CwlAttack[]> {
  const { data, error } = await supabase
    .from("cwl_attacks")
    .select("player_id, attack_order, stars, destruction, defender_tag, defender_position")
    .eq("war_id", warId)
    .is("deleted_at", null);

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    playerId: r.player_id as string,
    attackOrder: r.attack_order as number,
    stars: r.stars as number,
    destruction: Number(r.destruction),
    defenderTag: (r.defender_tag as string | null) ?? null,
    defenderPosition: (r.defender_position as number | null) ?? null,
  }));
}

/** id -> {tag, name}, for turning player_ids into something readable. */
export async function playerNames(
  supabase: SupabaseClient,
  playerIds: string[],
): Promise<Map<string, { tag: string; name: string }>> {
  if (!playerIds.length) return new Map();

  const { data, error } = await supabase
    .from("players")
    .select("id, tag, name")
    .in("id", [...new Set(playerIds)]);

  if (error || !data) return new Map();
  return new Map(
    (data as Array<{ id: string; tag: string; name: string }>).map((p) => [
      p.id,
      { tag: p.tag, name: p.name },
    ]),
  );
}

/**
 * T4.6 — one player's CWL record across every season of one clan.
 *
 * Scoped by clan on purpose: a player who has moved between the three clans has
 * a separate history in each, and merging them here would show a leader of clan
 * A a record built partly from clan B (R3).
 */
export async function playerSeasonHistory(
  supabase: SupabaseClient,
  clanId: string,
  playerId: string,
): Promise<
  Array<{ season: string; warsRostered: number; attacksUsed: number; stars: number }>
> {
  const seasons = await seasonsForClan(supabase, clanId);
  const history = [];

  for (const season of seasons) {
    const wars = await warsInSeason(supabase, season.id);
    if (!wars.length) continue;

    let warsRostered = 0;
    let attacksUsed = 0;
    let stars = 0;

    for (const war of wars) {
      const roster = await rosterForWar(supabase, war.id);
      if (!roster.some((r) => r.playerId === playerId)) continue;
      warsRostered += 1;

      for (const attack of await attacksForWar(supabase, war.id)) {
        if (attack.playerId !== playerId) continue;
        attacksUsed += 1;
        stars += attack.stars;
      }
    }

    if (warsRostered) history.push({ season: season.season, warsRostered, attacksUsed, stars });
  }

  return history;
}
