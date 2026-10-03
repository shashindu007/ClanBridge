// 057 — scouting, gathered for the CWL pages: the Standings table and each
// clan's own page. Enemy villages come from the scout; ours from our own daily
// readings, so both sides are measured the same way.
//
// `seasonId` must already have been resolved under the clan filter, as for
// loadSeasonView.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GroupWar } from "@/repositories/cwl";
import { ourVillages, scoutingForSeason } from "@/repositories/cwl-scouting";
import {
  clanScout,
  type ClanScout,
  type ScoutSeason,
  type StandingScout,
} from "@/services/cwl-scouting";

export async function loadScouting(
  supabase: SupabaseClient,
  seasonId: string,
  ourTag: string,
): Promise<ScoutSeason> {
  const season = await scoutingForSeason(supabase, seasonId);
  const ourTags = season.roster.filter((m) => m.clanTag === ourTag).map((m) => m.tag);
  const ours = await ourVillages(supabase, ourTag, ourTags);
  return { ...season, villages: [...season.villages.filter((v) => v.clanTag !== ourTag), ...ours] };
}

/** One scout per clan in the group, by tag. */
export function scoutsByClan(
  clanTags: readonly string[],
  season: ScoutSeason,
  wars: readonly GroupWar[],
): Map<string, ClanScout> {
  return new Map(clanTags.map((tag) => [tag, clanScout(tag, season, wars)]));
}

/** The Standings table's slice of each scout. Null when nothing was captured. */
export function standingScouts(scouts: ReadonlyMap<string, ClanScout>): Map<string, StandingScout> | null {
  const rows = [...scouts].filter(([, s]) => s.roster.total > 0 || s.players.length > 0);
  if (!rows.length) return null;
  return new Map(
    rows.map(([tag, s]) => [
      tag,
      {
        roster: s.roster,
        avgHeroPct: s.avgHeroPct,
        weakPoints: s.weakPoints.length,
        defences: s.defences,
        avgDestructionAgainst: s.avgDestructionAgainst,
        tripledAgainst: s.tripledAgainst,
      },
    ]),
  );
}
