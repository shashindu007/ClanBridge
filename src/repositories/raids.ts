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
  "total_attacks, offensive_reward, defensive_reward";

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
