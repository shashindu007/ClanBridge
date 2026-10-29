// One clan's Clan Games month, gathered once for Player rating → Clan Games
// rating.
//
// `clan` must already have been resolved for the viewer (visibleClans). The
// month is read under the clan's id, and its scores by the id that read
// returned (R3) — see repositories/clan-games.ts for the chain.

import type { SupabaseClient } from "@supabase/supabase-js";
import { gamesBySeason, scoresForGames, type ClanGamesRow } from "@/repositories/clan-games";
import { monthGamesRating, type MonthGamesRating } from "@/services/games-rating";

export interface GamesMonthView {
  month: string;
  /** Null when this clan has no Clan Games recorded for the month. */
  games: ClanGamesRow | null;
  rating: MonthGamesRating;
}

export async function loadGamesMonth(
  supabase: SupabaseClient,
  clan: { id: string },
  month: string,
): Promise<GamesMonthView> {
  const games = await gamesBySeason(supabase, clan.id, month);
  // A month still running has no points yet, so it costs no further reads.
  const scores = games?.settledAt ? await scoresForGames(supabase, games.id) : [];
  return { month, games, rating: monthGamesRating(scores, games) };
}
