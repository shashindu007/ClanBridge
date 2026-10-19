// T7.3 — Capital raid reads.
//
// R1 — PostgreSQL only. Everything here arrives via scripts/sync/raids.ts.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CLAN FILTER, AGAIN, AND WHY IT IS NOT .eq("clan_id", clanId) THROUGHOUT
//
// raid_participants has no clan_id. The chain is
//
//     raid_participants -> raid_seasons.clan_id
//
// which is the shape of the RLS policy in 006_rls.sql. R3 is satisfied the same
// way cwl.ts does it: resolve the SEASON under an explicit clan filter first,
// then read its children by the id that resolution proved. A season id from
// another clan never reaches the child query, because it never resolves.
//
// RLS would deny it too. R3 exists because the policy is the net and the query
// is the mechanism, and a page that leans only on the net is one policy edit
// away from leaking.
// ─────────────────────────────────────────────────────────────────────────────
//
// Two stand-in limitations shape the code below, both documented in cwl.ts:
// there are no embedded selects (two queries instead), and `.order()` has no
// descending option (reverse in JS).

import type { SupabaseClient } from "@supabase/supabase-js";
import { playerNames } from "@/repositories/cwl";

export interface RaidSeasonRow {
  id: string;
  startTime: string;
  endTime: string | null;
  totalLoot: number | null;
  /** 'ongoing' | 'ended' | null. Null means the sync stored it before 027. */
  state: string | null;
  raidsCompleted: number | null;
  totalAttacks: number | null;
  /** Raid medals — the number members compare weekends by. */
  offensiveReward: number | null;
  defensiveReward: number | null;
  /**
   * 064 — when the weekend's attacks were captured, as an ISO string. Null
   * means they never were (the API sends them for the latest weekend only),
   * and the raid rating cannot rate the weekend.
   */
  attacksCapturedAt: string | null;
}

export interface RaidParticipantRow {
  playerId: string;
  tag: string;
  name: string;
  attacksUsed: number | null;
  /** The denominator (027). Null on rows written before it existed. */
  attackLimit: number | null;
  bonusAttackLimit: number | null;
  loot: number | null;
}

const SEASON_COLUMNS =
  "id, start_time, end_time, total_loot, state, raids_completed, " +
  "total_attacks, offensive_reward, defensive_reward, attacks_captured_at";

/** PostgREST sends an ISO string; the PGlite stand-in a Date. */
function isoOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : new Date(value as string | Date).toISOString();
}

function toSeason(r: Record<string, unknown>): RaidSeasonRow {
  return {
    id: r.id as string,
    startTime: r.start_time as string,
    endTime: (r.end_time as string | null) ?? null,
    totalLoot: (r.total_loot as number | null) ?? null,
    state: (r.state as string | null) ?? null,
    raidsCompleted: (r.raids_completed as number | null) ?? null,
    totalAttacks: (r.total_attacks as number | null) ?? null,
    offensiveReward: (r.offensive_reward as number | null) ?? null,
    defensiveReward: (r.defensive_reward as number | null) ?? null,
    attacksCapturedAt: isoOrNull(r.attacks_captured_at),
  };
}

/** Every weekend this clan has raid data for, newest first. */
export async function seasonsForClan(
  supabase: SupabaseClient,
  clanId: string,
): Promise<RaidSeasonRow[]> {
  const { data, error } = await supabase
    .from("raid_seasons")
    .select(SEASON_COLUMNS)
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .order("start_time");

  if (error || !data) return [];
  // Newest first; the stand-in's .order() is ascending only.
  return (data as unknown as Array<Record<string, unknown>>).map(toSeason).reverse();
}

/**
 * The most recent weekend, or null.
 *
 * Null is the ordinary state for a clan that has never opened its Capital, and
 * the page has to say which of the two it is rather than rendering blank.
 */
export async function latestSeason(
  supabase: SupabaseClient,
  clanId: string,
): Promise<RaidSeasonRow | null> {
  return (await seasonsForClan(supabase, clanId))[0] ?? null;
}

/**
 * One weekend by id, under a clan filter.
 *
 * The clan filter is the whole safety of the page: once a season id has
 * resolved here, its participants are known to belong to this clan and can be
 * read by id alone. A raid id pasted in from another clan resolves to null and
 * falls through to the "no weekend" branch — not to their data.
 */
export async function seasonById(
  supabase: SupabaseClient,
  clanId: string,
  seasonId: string,
): Promise<RaidSeasonRow | null> {
  const { data, error } = await supabase
    .from("raid_seasons")
    .select(SEASON_COLUMNS)
    .eq("clan_id", clanId) // R3
    .eq("id", seasonId)
    .is("deleted_at", null);

  if (error || !data?.length) return null;
  return toSeason((data as unknown as Array<Record<string, unknown>>)[0]!);
}

/**
 * Who raided in one weekend. `seasonId` must already be clan-checked.
 *
 * Two queries, not an embedded select: PostgREST's `select("*, players(...)")`
 * is unsupported by the PGlite stand-in, so every join in this layer is done
 * the same way — read the rows, then resolve the names.
 */
export async function participantsOfSeason(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<RaidParticipantRow[]> {
  const { data, error } = await supabase
    .from("raid_participants")
    .select("player_id, attacks_used, attack_limit, bonus_attack_limit, loot")
    .eq("raid_season_id", seasonId)
    .is("deleted_at", null);

  if (error || !data) return [];

  const rows = (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    playerId: r.player_id as string,
    attacksUsed: (r.attacks_used as number | null) ?? null,
    attackLimit: (r.attack_limit as number | null) ?? null,
    bonusAttackLimit: (r.bonus_attack_limit as number | null) ?? null,
    loot: (r.loot as number | null) ?? null,
  }));

  const names = await playerNames(
    supabase,
    rows.map((r) => r.playerId),
  );

  return rows.map((r) => ({
    ...r,
    tag: names.get(r.playerId)?.tag ?? "",
    // Same fallback cwl.ts uses. A participant whose player row was soft-deleted
    // still appears — dropping them would quietly shrink the weekend's roster.
    name: names.get(r.playerId)?.name ?? "Unknown player",
  }));
}

/**
 * One player's raid record across every weekend of one clan (T7.3, T3B.4).
 *
 * Driven from raid_seasons rather than from raid_participants, so a weekend a
 * member sat out still appears in their history as a zero. Iterating
 * participation instead makes the weekends they skipped invisible — and those
 * are the ones the leader is looking for, the same argument warRecord makes.
 */
export async function seasonsForPlayer(
  supabase: SupabaseClient,
  clanId: string,
  playerId: string,
): Promise<Array<{ season: RaidSeasonRow; participation: RaidParticipantRow | null }>> {
  const seasons = await seasonsForClan(supabase, clanId);
  if (!seasons.length) return [];

  const { data, error } = await supabase
    .from("raid_participants")
    .select("raid_season_id, player_id, attacks_used, attack_limit, bonus_attack_limit, loot")
    .eq("player_id", playerId)
    .in(
      "raid_season_id",
      seasons.map((s) => s.id), // R3 — every id came from the clan-filtered read
    )
    .is("deleted_at", null);

  if (error) return seasons.map((season) => ({ season, participation: null }));

  const bySeason = new Map<string, RaidParticipantRow>();
  for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    bySeason.set(r.raid_season_id as string, {
      playerId: r.player_id as string,
      tag: "",
      name: "",
      attacksUsed: (r.attacks_used as number | null) ?? null,
      attackLimit: (r.attack_limit as number | null) ?? null,
      bonusAttackLimit: (r.bonus_attack_limit as number | null) ?? null,
      loot: (r.loot as number | null) ?? null,
    });
  }

  return seasons.map((season) => ({
    season,
    participation: bySeason.get(season.id) ?? null,
  }));
}

// ---------------------------------------------------------------------------
// 064 — the raid rating's reads: a month of weekends, and each weekend's
// attacks and the clans it raided.
// ---------------------------------------------------------------------------

/** A month's weekends need their start as a sortable ISO string, whatever the client sent. */
export interface RaidRatingSeason extends RaidSeasonRow {
  startTime: string;
}

/**
 * This clan's weekends that started in one month ('YYYY-MM', UTC), oldest
 * first. A weekend belongs to the month it started in — a Friday the 31st
 * counts for that month, not the next.
 */
export async function raidSeasonsInMonth(
  supabase: SupabaseClient,
  clanId: string,
  month: string,
): Promise<RaidRatingSeason[]> {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return [];
  const from = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const to = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));

  const { data, error } = await supabase
    .from("raid_seasons")
    .select(SEASON_COLUMNS)
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .gte("start_time", from.toISOString())
    .lt("start_time", to.toISOString())
    .order("start_time");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    ...toSeason(r),
    startTime: isoOrNull(r.start_time) as string,
  }));
}

/** The months ('YYYY-MM', UTC) this clan has a weekend in, newest first. */
export async function raidMonthsForClan(
  supabase: SupabaseClient,
  clanId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("raid_seasons")
    .select("start_time")
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .limit(1000)
    .order("start_time", { ascending: false });

  if (error || !data) return [];
  const months = (data as unknown as Array<{ start_time: string | Date }>).map((r) =>
    new Date(r.start_time).toISOString().slice(0, 7),
  );
  return [...new Set(months)];
}

export interface RaidAttackRow {
  raidNumber: number;
  districtId: number;
  districtName: string | null;
  districtHallLevel: number | null;
  /** 1 for the first attack on the district in this raid. */
  attackNumber: number;
  playerId: string;
  tag: string;
  name: string;
  /** The DISTRICT's destruction after this attack — not this attack's share. */
  destruction: number;
  stars: number;
}

/** Every attack of one weekend. `seasonId` must already be clan-checked. */
export async function raidAttacksOfSeason(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<RaidAttackRow[]> {
  const { data, error } = await supabase
    .from("raid_attacks")
    .select(
      "raid_number, district_id, district_name, district_hall_level, attack_number, " +
        "player_id, destruction, stars",
    )
    .eq("raid_season_id", seasonId)
    .is("deleted_at", null)
    .order("attack_number");

  if (error || !data) return [];
  const rows = data as unknown as Array<Record<string, unknown>>;
  const names = await playerNames(
    supabase,
    [...new Set(rows.map((r) => r.player_id as string))],
  );

  return rows.map((r) => ({
    raidNumber: Number(r.raid_number),
    districtId: Number(r.district_id),
    districtName: (r.district_name as string | null) ?? null,
    districtHallLevel:
      r.district_hall_level === null || r.district_hall_level === undefined ? null : Number(r.district_hall_level),
    attackNumber: Number(r.attack_number),
    playerId: r.player_id as string,
    tag: names.get(r.player_id as string)?.tag ?? "",
    name: names.get(r.player_id as string)?.name ?? "Unknown player",
    destruction: Number(r.destruction),
    stars: Number(r.stars),
  }));
}

export interface RaidOpponentRow {
  raidNumber: number;
  defenderTag: string;
  defenderName: string | null;
  /** The API's league id, 85000001 (Bronze League III) to 85000022 (Legend League). */
  capitalLeagueId: number | null;
  capitalLeague: string | null;
}

/** The enemy capitals one weekend raided. `seasonId` must already be clan-checked. */
export async function raidOpponentsOfSeason(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<RaidOpponentRow[]> {
  const { data, error } = await supabase
    .from("raid_opponents")
    .select("raid_number, defender_tag, defender_name, capital_league_id, capital_league")
    .eq("raid_season_id", seasonId)
    .is("deleted_at", null)
    .order("raid_number");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    raidNumber: Number(r.raid_number),
    defenderTag: r.defender_tag as string,
    defenderName: (r.defender_name as string | null) ?? null,
    capitalLeagueId:
      r.capital_league_id === null || r.capital_league_id === undefined ? null : Number(r.capital_league_id),
    capitalLeague: (r.capital_league as string | null) ?? null,
  }));
}
