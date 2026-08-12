// T7.5 — Clan Games reads.
//
// R1 — PostgreSQL only. Everything here arrives via scripts/sync/clan-games.ts.
//
// R3 — clan_games_scores has no clan_id; the chain is
//
//     clan_games_scores -> clan_games.clan_id
//
// so the season is resolved under an explicit clan filter first and its scores
// are read by the id that resolution proved. Same shape as cwl.ts and raids.ts,
// and the same reason: RLS is the net, the query is the mechanism.
//
// No embedded selects and no descending .order() — both unsupported by the
// PGlite stand-in, so joins are two queries and reversal happens in JS.

import type { SupabaseClient } from "@supabase/supabase-js";
import { playerNames } from "@/repositories/cwl";

export interface ClanGamesRow {
  id: string;
  /** 'YYYY-MM' — the month the points belong to. */
  season: string;
  startTime: string | null;
  endTime: string | null;
  /**
   * Set once the end-of-period snapshot has been taken (027).
   *
   * Null means the period is still open and every score on it is provisional —
   * the page has to say which, because a leaderboard that looks final and is not
   * will be screenshotted and argued about.
   */
  settledAt: string | null;
}

export interface ClanGamesScoreRow {
  playerId: string;
  tag: string;
  name: string;
  /** Null until the end snapshot runs. Not zero — see services/clan-games.ts. */
  points: number | null;
  startValue: number | null;
  endValue: number | null;
}

const GAMES_COLUMNS = "id, season, start_time, end_time, settled_at";

function toGames(r: Record<string, unknown>): ClanGamesRow {
  return {
    id: r.id as string,
    season: r.season as string,
    startTime: (r.start_time as string | null) ?? null,
    endTime: (r.end_time as string | null) ?? null,
    settledAt: (r.settled_at as string | null) ?? null,
  };
}

/** Every Clan Games month this clan has data for, newest first. */
export async function gamesForClan(
  supabase: SupabaseClient,
  clanId: string,
): Promise<ClanGamesRow[]> {
  const { data, error } = await supabase
    .from("clan_games")
    .select(GAMES_COLUMNS)
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .order("season");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map(toGames).reverse();
}

/**
 * One month by its 'YYYY-MM' string, under a clan filter.
 *
 * Once this resolves, its scores are known to belong to this clan and can be
 * read by id alone. A season string from another clan resolves to null.
 */
export async function gamesBySeason(
  supabase: SupabaseClient,
  clanId: string,
  season: string,
): Promise<ClanGamesRow | null> {
  const { data, error } = await supabase
    .from("clan_games")
    .select(GAMES_COLUMNS)
    .eq("clan_id", clanId) // R3
    .eq("season", season)
    .is("deleted_at", null);

  if (error || !data?.length) return null;
  return toGames((data as unknown as Array<Record<string, unknown>>)[0]!);
}

/** The scores of one month. `gamesId` must already be clan-checked. */
export async function scoresForGames(
  supabase: SupabaseClient,
  gamesId: string,
): Promise<ClanGamesScoreRow[]> {
  const { data, error } = await supabase
    .from("clan_games_scores")
    .select("player_id, points, start_value, end_value")
    .eq("clan_games_id", gamesId)
    .is("deleted_at", null);

  if (error || !data) return [];

  const rows = (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    playerId: r.player_id as string,
    points: (r.points as number | null) ?? null,
    startValue: (r.start_value as number | null) ?? null,
    endValue: (r.end_value as number | null) ?? null,
  }));

  const names = await playerNames(
    supabase,
    rows.map((r) => r.playerId),
  );

  return rows.map((r) => ({
    ...r,
    tag: names.get(r.playerId)?.tag ?? "",
    name: names.get(r.playerId)?.name ?? "Unknown player",
  }));
}

/**
 * One player's Clan Games record across every month of one clan.
 *
 * Driven from clan_games, so a month they scored nothing in still appears —
 * the same argument raids.ts's seasonsForPlayer makes. A member with no row for
 * a month was not snapshotted at all (they joined mid-period, or the start pass
 * missed them), which is a different fact from scoring zero and is kept
 * distinguishable by the null.
 */
export async function gamesForPlayer(
  supabase: SupabaseClient,
  clanId: string,
  playerId: string,
): Promise<Array<{ games: ClanGamesRow; score: ClanGamesScoreRow | null }>> {
  const months = await gamesForClan(supabase, clanId);
  if (!months.length) return [];

  const { data, error } = await supabase
    .from("clan_games_scores")
    .select("clan_games_id, player_id, points, start_value, end_value")
    .eq("player_id", playerId)
    .in(
      "clan_games_id",
      months.map((m) => m.id), // R3 — every id came from the clan-filtered read
    )
    .is("deleted_at", null);

  if (error) return months.map((games) => ({ games, score: null }));

  const byGames = new Map<string, ClanGamesScoreRow>();
  for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    byGames.set(r.clan_games_id as string, {
      playerId: r.player_id as string,
      tag: "",
      name: "",
      points: (r.points as number | null) ?? null,
      startValue: (r.start_value as number | null) ?? null,
      endValue: (r.end_value as number | null) ?? null,
    });
  }

  return months.map((games) => ({ games, score: byGames.get(games.id) ?? null }));
}
