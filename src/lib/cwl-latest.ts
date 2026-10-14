// The latest CWL month across a set of clans: which month it is, and every clan
// that played it with its season view and player rating. Read by CWL rating and
// by the results image beside it, so both show the same month the same way.
//
// R3 — spanning clans is not the same as not filtering by clan. Each season is
// resolved under its own clan (seasonsForClan), over the list the caller got
// from visibleClans(), and every read below hangs off that season's id. RLS on
// the CWL tables is auth_clan_ids(), so a member of clan A reads nothing of B.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { VisibleClan } from "@/lib/clans";
import { loadSeasonBoards, loadSeasonView, ratingFor, type SeasonView } from "@/lib/cwl-season";
import { seasonsForClan } from "@/repositories/cwl";
import type { SeasonRating } from "@/services/cwl-rating";

export interface LatestCwlEntry {
  clan: VisibleClan;
  view: SeasonView;
  rating: SeasonRating;
}

/** Null when none of the clans has a CWL season recorded yet. */
export async function latestCwlMonth(
  supabase: SupabaseClient,
  clans: VisibleClan[],
): Promise<{ month: string; entries: LatestCwlEntry[] } | null> {
  const seasonLists = await Promise.all(clans.map((clan) => seasonsForClan(supabase, clan.id)));
  const month = seasonLists.flatMap((list) => list.map((s) => s.season)).sort().at(-1) ?? null;
  if (!month) return null;

  const played = clans.flatMap((clan, index) => {
    const season = seasonLists[index]!.find((s) => s.season === month);
    return season ? [{ clan, season }] : [];
  });
  const entries = await Promise.all(
    played.map(async ({ clan, season }) => {
      const view = await loadSeasonView(supabase, clan, season, { withPlayers: true });
      const boards = await loadSeasonBoards(supabase, clan, view);
      return { clan, view, rating: ratingFor(view, boards) };
    }),
  );
  return { month, entries };
}
