// One clan's regular wars for one month, gathered once for the pages that rate
// them: Player rating → War rating, and the clan's own war rating page.
//
// `clan` must already have been resolved for the viewer (requireClanByTag or
// visibleClans). Every read below is by clan id, or by a war id this function
// has just read under that clan (R3).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  membersOfWar,
  opponentAttacksOfWar,
  opponentsOfWar,
  ratingAttacksForWar,
  warsInMonth,
  type WarRatingWar,
} from "@/repositories/war";
import { monthWarRating, warBoard, type MonthWarRating, type WarBoard } from "@/services/war-rating";

export interface WarMonthView {
  month: string;
  /** The month's wars, oldest first. */
  wars: WarRatingWar[];
  /** One board per war, in the order of `wars`. */
  boards: WarBoard[];
  rating: MonthWarRating;
}

export async function loadWarMonth(
  supabase: SupabaseClient,
  clan: { id: string },
  month: string,
): Promise<WarMonthView> {
  const wars = await warsInMonth(supabase, clan.id, month);

  // Per war rather than one read for the month: a month of 40-base wars is
  // past 1,000 attack rows, the page size a single select stops at in silence.
  const boards = await Promise.all(
    wars.map(async (war): Promise<WarBoard> => {
      const [members, attacks, opponents, opponentAttacks] = await Promise.all([
        membersOfWar(supabase, war.id),
        ratingAttacksForWar(supabase, war.id),
        opponentsOfWar(supabase, war.id),
        opponentAttacksOfWar(supabase, war.id),
      ]);
      return warBoard({
        members,
        attacks,
        opponents,
        opponentAttacks,
        defenceKnown: war.opponentAttacksCapturedAt !== null,
        teamSize: war.teamSize,
      });
    }),
  );

  return {
    month,
    wars,
    boards,
    rating: monthWarRating(
      wars.map((war, index) => ({
        id: war.id,
        startTime: war.startTime,
        opponentName: war.opponentName,
        state: war.state,
        board: boards[index]!,
      })),
    ),
  };
}
