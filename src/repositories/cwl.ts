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
import { cache } from "react";

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
  /**
   * When battle day BEGAN for this war day — the API's startTime, which is the
   * end of preparation and not when the day was matched up.
   *
   * Synced into cwl_wars since 002 and selected here since T12.2, which is the
   * whole of that task: the column was written every CWL sync and no query ever
   * asked for it, so the season page could not say when a day ran while the war
   * board three tabs away said exactly that about a regular war.
   */
  startTime: string | null;
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
        "our_stars, their_stars, our_destruction, their_destruction, result, " +
        "start_time, end_time",
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
    startTime: (r.start_time as string | null) ?? null,
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
export interface PlayerSeasonTotals {
  season: string;
  warsRostered: number;
  attacksUsed: number;
  stars: number;
}

/** One season of one player's CWL, and the clan it was played in (T11C.2). */
export interface FamilySeasonTotals extends PlayerSeasonTotals {
  clanId: string;
  clanTag: string;
  clanName: string;
}

/**
 * Players' CWL history from EVERY platform clan, keyed by player id (T11C.2).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE ONE READ IN THIS FILE THAT DOES NOT TAKE A clanId
 *
 * Everything above resolves a clan first, and the header of this file explains
 * why. This does not, on purpose: a village's CWL record belongs to the village,
 * and the family's members move between clans — SK FLASH played every CWL war it
 * has in DH CWL ONLY and lives in Dark Hell. Asking one clan for that record
 * returned nothing, and 006's policies would have hidden it anyway.
 *
 * So it calls family_cwl_history() (037), a definer function that is the whole
 * of the R3 exception: it returns season TOTALS and the clan's name, answers
 * only callers who hold a role in some platform clan (or own the village), and
 * leaves every CWL table's own policy untouched. Read 037's header before
 * widening what it returns.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Seasons are newest first — callers read `[0]` as "last CWL", exactly as they
 * did with the per-clan history this replaced. A player with no rostered war
 * anywhere is absent from the map, not present with [].
 *
 * One round trip however many players are asked about, which is what lets the
 * roster builder ask for its whole pool at once.
 *
 * It REPLACED seasonHistoryForClan() and playerSeasonHistory(), which walked one
 * clan's CWL tree in JavaScript — seasons, wars, then every roster and attack
 * list — and so could only ever answer "what did this player play HERE". The
 * semantics that walk established (driven from the roster, newest first, an
 * off-roster attack not counted) are now 037's SQL, and
 * test/cwl-history-repo.test.ts holds the two to the same expectations.
 *
 * Wrapped in cache(); the key is the array's identity, so a caller that wants
 * the memo must pass the same array.
 */
export const familyCwlHistory = cache(async function familyCwlHistory(
  supabase: SupabaseClient,
  playerIds: readonly string[],
): Promise<Map<string, FamilySeasonTotals[]>> {
  const ids = [...new Set(playerIds)];
  const result = new Map<string, FamilySeasonTotals[]>();
  if (!ids.length) return result;

  const { data, error } = await supabase.rpc("family_cwl_history", { p_player_ids: ids });
  if (error || !data) return result;

  // The function orders season desc, then clan name; appending preserves that.
  for (const row of data as Array<Record<string, unknown>>) {
    const playerId = row.player_id as string;
    const list = result.get(playerId) ?? [];
    list.push({
      season: row.season as string,
      clanId: row.clan_id as string,
      clanTag: row.clan_tag as string,
      clanName: row.clan_name as string,
      warsRostered: Number(row.wars_rostered),
      attacksUsed: Number(row.attacks_used),
      stars: Number(row.stars),
    });
    result.set(playerId, list);
  }
  return result;
});
