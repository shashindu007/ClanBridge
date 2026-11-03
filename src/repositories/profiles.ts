// 065 — reads behind the clan's war record, a village's career, and its in-game
// war preference.
//
// Both tables hold the LATEST reading only (065's header says why), so every
// read here is one row per clan or per village — no history, no windows.
//
// R3 — the same two scopes as repositories/player-progress.ts, and for the
// same reasons, which that file's header gives in full:
//
//   { clanId }  a member looking through the clan. Filtered by clan
//               explicitly; 065's clan policy is the net.
//   "owner"     a member looking at their own village from /account. Not
//               clan-filtered — a village outside every platform clan has
//               clan_id null — and 065's owner policy only returns villages
//               whose user_id is the caller.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProgressScope } from "@/repositories/player-progress";
import type { Achievement, CapitalDistrict } from "@/types/domain";
import { assertRead } from "@/lib/errors";

export interface ClanProfile {
  warWins: number | null;
  warTies: number | null;
  warLosses: number | null;
  warWinStreak: number | null;
  capitalLeague: string | null;
  capitalHallLevel: number | null;
  capitalDistricts: CapitalDistrict[];
  /** 071 — the clan's card. */
  description: string | null;
  clanPoints: number | null;
  clanBuilderBasePoints: number | null;
  clanCapitalPoints: number | null;
  warFrequency: string | null;
  requiredTownhallLevel: number | null;
  requiredTrophies: number | null;
  location: string | null;
  labels: string[];
  /** When the clan sync last wrote it, ISO. */
  updatedAt: string | null;
}

export interface PlayerProfileRow {
  warPreference: "in" | "out" | null;
  expLevel: number | null;
  bestTrophies: number | null;
  attackWins: number | null;
  defenseWins: number | null;
  warStars: number | null;
  capitalContributions: number | null;
  builderBaseTrophies: number | null;
  bestBuilderBaseTrophies: number | null;
  achievements: Achievement[];
  /** When the player sync read it, ISO. */
  capturedAt: string;
}

/** PostgREST sends an ISO string; the PGlite stand-in a Date. */
function iso(value: unknown): string | null {
  return value === null || value === undefined ? null : new Date(value as string | Date).toISOString();
}

function num(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function preference(value: unknown): "in" | "out" | null {
  return value === "in" || value === "out" ? value : null;
}

/** The clan's war record and Clan Capital, or null before the first sync after 065. */
export async function clanProfile(
  supabase: SupabaseClient,
  clanId: string,
): Promise<ClanProfile | null> {
  const { data, error } = await supabase
    .from("clan_profiles")
    .select(
      "war_wins, war_ties, war_losses, war_win_streak, capital_league, " +
        "capital_hall_level, capital_districts, description, clan_points, " +
        "clan_builder_base_points, clan_capital_points, war_frequency, " +
        "required_townhall_level, required_trophies, location, labels, updated_at, created_at",
    )
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null);

  assertRead(error, "clan_profiles");
  if (!data) return null;
  const row = (data as unknown as Array<Record<string, unknown>>)[0];
  if (!row) return null;

  return {
    warWins: num(row.war_wins),
    warTies: num(row.war_ties),
    warLosses: num(row.war_losses),
    warWinStreak: num(row.war_win_streak),
    capitalLeague: (row.capital_league as string | null) ?? null,
    capitalHallLevel: num(row.capital_hall_level),
    capitalDistricts: Array.isArray(row.capital_districts)
      ? (row.capital_districts as CapitalDistrict[])
      : [],
    description: (row.description as string | null) || null,
    clanPoints: num(row.clan_points),
    clanBuilderBasePoints: num(row.clan_builder_base_points),
    clanCapitalPoints: num(row.clan_capital_points),
    warFrequency: (row.war_frequency as string | null) ?? null,
    requiredTownhallLevel: num(row.required_townhall_level),
    requiredTrophies: num(row.required_trophies),
    location: (row.location as string | null) ?? null,
    labels: Array.isArray(row.labels) ? (row.labels as string[]) : [],
    // A row never updated since it was written has only created_at.
    updatedAt: iso(row.updated_at) ?? iso(row.created_at),
  };
}

const PROFILE_COLUMNS =
  "war_preference, exp_level, best_trophies, attack_wins, defense_wins, war_stars, " +
  "capital_contributions, builder_base_trophies, best_builder_base_trophies, achievements, captured_at";

/** One village's latest profile, or null when the player sync has not read it since 065. */
export async function playerProfile(
  supabase: SupabaseClient,
  playerId: string,
  scope: ProgressScope,
): Promise<PlayerProfileRow | null> {
  let query = supabase
    .from("player_profiles")
    .select(PROFILE_COLUMNS)
    .eq("player_id", playerId)
    .is("deleted_at", null);
  if (scope !== "owner") query = query.eq("clan_id", scope.clanId); // R3

  const { data, error } = await query;
  assertRead(error, "player_profiles");
  if (!data) return null;
  const row = (data as unknown as Array<Record<string, unknown>>)[0];
  if (!row) return null;

  return {
    warPreference: preference(row.war_preference),
    ...toCareer(row),
    achievements: Array.isArray(row.achievements) ? (row.achievements as Achievement[]) : [],
  };
}

/** A village's career numbers — the profile without achievements or war preference. */
export type PlayerCareer = Omit<PlayerProfileRow, "warPreference" | "achievements">;

const CAREER_COLUMNS =
  "player_id, exp_level, best_trophies, attack_wins, defense_wins, war_stars, " +
  "capital_contributions, builder_base_trophies, best_builder_base_trophies, captured_at";

function toCareer(row: Record<string, unknown>): PlayerCareer {
  return {
    expLevel: num(row.exp_level),
    bestTrophies: num(row.best_trophies),
    attackWins: num(row.attack_wins),
    defenseWins: num(row.defense_wins),
    warStars: num(row.war_stars),
    capitalContributions: num(row.capital_contributions),
    builderBaseTrophies: num(row.builder_base_trophies),
    bestBuilderBaseTrophies: num(row.best_builder_base_trophies),
    capturedAt: iso(row.captured_at) ?? new Date(0).toISOString(),
  };
}

/**
 * The career numbers of the caller's OWN villages, in one read — for Home's base
 * cards. "owner" scope only: 065's owner policy is the net, and the caller
 * passes ids from basesForUser(). Achievements are left out; Home does not show
 * them and they are most of a row's size.
 */
export async function ownCareers(
  supabase: SupabaseClient,
  playerIds: readonly string[],
): Promise<Map<string, PlayerCareer>> {
  const out = new Map<string, PlayerCareer>();
  const ids = [...new Set(playerIds)];
  if (!ids.length) return out;

  const { data, error } = await supabase
    .from("player_profiles")
    .select(CAREER_COLUMNS)
    .in("player_id", ids)
    .is("deleted_at", null);

  assertRead(error, "player_profiles");
  for (const row of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    out.set(row.player_id as string, toCareer(row));
  }
  return out;
}

/**
 * The in-game war preference of many villages at once, for the CWL roster
 * builder. Only villages filed under one of `clanIds` (R3): the builder spans
 * every clan the leader runs, and passes exactly those.
 */
export async function warPreferences(
  supabase: SupabaseClient,
  playerIds: readonly string[],
  clanIds: readonly string[],
): Promise<Map<string, "in" | "out">> {
  const out = new Map<string, "in" | "out">();
  if (!playerIds.length || !clanIds.length) return out;

  const { data, error } = await supabase
    .from("player_profiles")
    .select("player_id, war_preference")
    .in("clan_id", [...clanIds]) // R3
    .in("player_id", [...new Set(playerIds)])
    .is("deleted_at", null);

  assertRead(error, "player_profiles");
  if (!data) return out;
  for (const row of data as unknown as Array<Record<string, unknown>>) {
    const value = preference(row.war_preference);
    if (value) out.set(row.player_id as string, value);
  }
  return out;
}
