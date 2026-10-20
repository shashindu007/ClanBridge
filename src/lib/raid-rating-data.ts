// One clan's raid weekends for one month, gathered once for Player rating →
// Raids rating.
//
// `clan` must already have been resolved for the viewer (visibleClans). Every
// read below is by clan id, or by a season id this function has just read
// under that clan (R3).

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  participantsOfSeason,
  raidAttacksOfSeason,
  raidOpponentsOfSeason,
  raidSeasonsInMonth,
  type RaidRatingSeason,
} from "@/repositories/raids";
import {
  monthRaidRating,
  raidWeekendRating,
  type MonthRaidRating,
  type RaidWeekendRating,
} from "@/services/raid-rating";

export interface RaidMonthView {
  month: string;
  /** The month's weekends, oldest first. */
  weekends: RaidRatingSeason[];
  /** One rating per weekend, in the order of `weekends`. */
  ratings: RaidWeekendRating[];
  rating: MonthRaidRating;
}

export async function loadRaidMonth(
  supabase: SupabaseClient,
  clan: { id: string },
  month: string,
): Promise<RaidMonthView> {
  const weekends = await raidSeasonsInMonth(supabase, clan.id, month);

  const ratings = await Promise.all(
    weekends.map(async (season): Promise<RaidWeekendRating> => {
      const captured = season.attacksCapturedAt !== null;
      // A weekend that cannot be rated costs no further reads.
      if (!captured) return raidWeekendRating({ state: season.state, captured, participants: [], attacks: [], opponents: [] });
      const [participants, attacks, opponents] = await Promise.all([
        participantsOfSeason(supabase, season.id),
        raidAttacksOfSeason(supabase, season.id),
        raidOpponentsOfSeason(supabase, season.id),
      ]);
      return raidWeekendRating({ state: season.state, captured, participants, attacks, opponents });
    }),
  );

  return {
    month,
    weekends,
    ratings,
    rating: monthRaidRating(
      weekends.map((season, index) => ({
        id: season.id,
        startTime: season.startTime,
        rating: ratings[index]!,
      })),
    ),
  };
}
