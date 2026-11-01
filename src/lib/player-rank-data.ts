// The reads behind a player's rank and summary, for Home and both profile pages.
//
// EVERY READ HERE MAY FAIL ON ITS OWN. These add to a page that works without
// them, so a failure costs that one block, says so, and leaves the page standing.
// Repositories still throw: deciding that a failure is survivable belongs here.

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeMessage } from "@/lib/errors";
import { latestTrophies } from "@/repositories/members";
import { latestProgressFor, type VillageSnapshot } from "@/repositories/player-progress";
import { playerRatingHistory, type RatingMonth } from "@/repositories/player-ratings";

/** Months a profile lists. */
export const PROFILE_RANK_MONTHS = 6;

/** Enough for Home to skip an open month and still compare the one it lands on. */
export const HOME_RANK_MONTHS = 3;

/** Null means the read failed, which is not the same as having no rank. */
export async function rankHistories(
  supabase: SupabaseClient,
  playerIds: readonly string[],
  months: number,
): Promise<Map<string, RatingMonth[]> | null> {
  try {
    return await playerRatingHistory(supabase, playerIds, months);
  } catch (error) {
    safeMessage("player-rating-history", { message: String(error) }, "");
    return null;
  }
}

export interface PlayerGlanceData {
  /** Null when the read failed. */
  history: RatingMonth[] | null;
  progress: VillageSnapshot | null;
  trophies: number | null;
}

/** @param clanId where to read trophies from. Null reads none. */
export async function playerGlance(
  supabase: SupabaseClient,
  playerId: string,
  clanId: string | null,
): Promise<PlayerGlanceData> {
  const [histories, progress, trophies] = await Promise.all([
    rankHistories(supabase, [playerId], PROFILE_RANK_MONTHS),
    latestProgressFor(supabase, [playerId]).catch((error: unknown) => {
      safeMessage("player-glance-progress", { message: String(error) }, "");
      return null;
    }),
    clanId
      ? latestTrophies(supabase, clanId, playerId).catch((error: unknown) => {
          safeMessage("player-glance-trophies", { message: String(error) }, "");
          return null;
        })
      : null,
  ]);

  return {
    history: histories === null ? null : (histories.get(playerId) ?? []),
    progress: progress?.get(playerId) ?? null,
    trophies,
  };
}
