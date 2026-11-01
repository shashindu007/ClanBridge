// The stored Player rating, as /rating, Home and the profile show it. Thin
// wrappers over the definer functions in 073 and 075, in the shape
// repositories/family.ts uses for 038.
//
// R3 — THESE CROSS A CLAN BOUNDARY BY DESIGN, like family.ts. The widening is the
// function, not a policy: player_ratings keeps a clan-scoped SELECT policy, and
// what comes back here is the whole permission. Zero rows, not an error, is how
// a caller with no clan role is refused.
//
// RANK IS READ, NEVER COUNTED. The database works it out once (075), so no two
// pages can show a player different numbers.

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRead } from "@/lib/errors";
import type { RatingKind } from "@/lib/rating";

type BySection = Record<RatingKind, number>;

export interface RatedPlayer {
  playerId: string;
  clanId: string;
  clanTag: string;
  clanName: string;
  tag: string;
  name: string;
  thLevel: number | null;
  marks: BySection;
  shares: BySection;
  rating: number;
  computedAt: string;
  /** In the whole family. Ties share a rank: 1, 2, 2, 4. */
  familyRank: number;
  familySize: number;
  tied: boolean;
  clanRank: number;
  clanSize: number;
  /** Players with any marks this month. Zero means nothing has counted yet. */
  ratedPlayers: number;
}

/** Where a player finished in one month. */
export interface Placement {
  familyRank: number;
  tied: boolean;
  clanRank: number;
  clanSize: number;
  clanTag: string;
  clanName: string;
  marks: BySection;
  shares: BySection;
  rating: number;
  computedAt: string;
}

/** One player in one month. `placed` is null when they are not in its ranking. */
export interface RatingMonth {
  playerId: string;
  month: string;
  ratedPlayers: number;
  familySize: number;
  placed: Placement | null;
}

/** numeric columns: PostgREST sends numbers, but a driver may send strings. */
function marksOf(r: Record<string, unknown>): BySection {
  return {
    donations: Number(r.donation_marks),
    war: Number(r.war_marks),
    cwl: Number(r.cwl_marks),
    games: Number(r.games_marks),
    raids: Number(r.raid_marks),
  };
}

function sharesOf(r: Record<string, unknown>): BySection {
  return {
    donations: Number(r.donation_share),
    war: Number(r.war_share),
    cwl: Number(r.cwl_share),
    games: Number(r.games_share),
    raids: Number(r.raid_share),
  };
}

/** PostgREST sends an ISO string; the PGlite stand-in a Date. */
function isoOf(value: unknown): string {
  return value instanceof Date ? value.toISOString() : (value as string);
}

/** Every month with a stored ranking, newest first. */
export async function ratingMonths(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.rpc("family_rating_months");
  assertRead(error, "family_rating_months");
  return ((data ?? []) as Array<{ month: string }>).map((r) => r.month);
}

/** One month's ranking from the newest run, best first. */
export async function familyRatings(
  supabase: SupabaseClient,
  month: string,
): Promise<RatedPlayer[]> {
  const { data, error } = await supabase.rpc("family_player_ratings", { p_month: month });
  assertRead(error, "family_player_ratings");

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    playerId: r.player_id as string,
    clanId: r.clan_id as string,
    clanTag: r.clan_tag as string,
    clanName: r.clan_name as string,
    tag: r.tag as string,
    name: r.name as string,
    thLevel: (r.th_level as number | null) ?? null,
    marks: marksOf(r),
    shares: sharesOf(r),
    rating: Number(r.rating),
    computedAt: isoOf(r.computed_at),
    familyRank: Number(r.family_rank),
    familySize: Number(r.family_size),
    tied: r.tied === true,
    clanRank: Number(r.clan_rank),
    clanSize: Number(r.clan_size),
    ratedPlayers: Number(r.rated_players),
  }));
}

/** The newest months for these players, each player's newest first. */
export async function playerRatingHistory(
  supabase: SupabaseClient,
  playerIds: readonly string[],
  months: number,
): Promise<Map<string, RatingMonth[]>> {
  const out = new Map<string, RatingMonth[]>();
  const ids = [...new Set(playerIds)];
  if (!ids.length) return out;

  const { data, error } = await supabase.rpc("player_rating_history", {
    p_players: ids,
    p_months: months,
  });
  assertRead(error, "player_rating_history");

  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const playerId = r.player_id as string;
    const row: RatingMonth = {
      playerId,
      month: r.month as string,
      ratedPlayers: Number(r.rated_players),
      familySize: Number(r.family_size),
      placed:
        r.family_rank === null || r.family_rank === undefined
          ? null
          : {
              familyRank: Number(r.family_rank),
              tied: r.tied === true,
              clanRank: Number(r.clan_rank),
              clanSize: Number(r.clan_size),
              clanTag: r.clan_tag as string,
              clanName: r.clan_name as string,
              marks: marksOf(r),
              shares: sharesOf(r),
              rating: Number(r.rating),
              computedAt: isoOf(r.computed_at),
            },
    };
    out.set(playerId, [...(out.get(playerId) ?? []), row]);
  }

  for (const rows of out.values()) rows.sort((a, b) => b.month.localeCompare(a.month));
  return out;
}
