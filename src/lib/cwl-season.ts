// One CWL season, gathered once for every page that shows it: the day-by-day
// page, the medals page, the report and its printed copy, and the season list.
//
// Each of those used to assemble its own subset — wars here, totals there — and
// the day page and the report already disagreed about which days count. Now the
// wars, the group, the standings, the league and (when asked for) every
// player's season are read in one place and handed on.
//
// `season` must already have been resolved under the clan filter (seasonByName
// / seasonsForClan). Every read below hangs off its id, which is what makes
// them this clan's (R3).

import type { SupabaseClient } from "@supabase/supabase-js";
import { currentUserId, isPlatformAdmin } from "@/lib/auth";
import type { ClanRole } from "@/types/domain";
import { isLeadership } from "@/lib/visibility";
import { canonicalLeague } from "@/data/cwl-medals";
import { clanDetail } from "@/repositories/clans";
import {
  attacksForWar,
  groupForSeason,
  rosterForWar,
  warsInSeason,
  type CwlSeason,
  type CwlWar,
  type GroupClan,
  type GroupWar,
} from "@/repositories/cwl";
import { lineupsForWars } from "@/repositories/cwl-scouting";
import { fieldedOnly, teamSizes } from "@/services/cwl-scouting";
import { seasonSpan, seasonTotals, type SeasonSpan, type SeasonTotals } from "@/services/cwl";
import { dayBoard, type DayBoard } from "@/services/cwl-day";
import { seasonRating, type SeasonRating } from "@/services/cwl-rating";
import { groupStandings, ourStanding, type Standing } from "@/services/cwl-standings";
import { medalPlan, type MedalPlan } from "@/services/cwl-medals";
import { contributionReport, type ContributionRow, type SeasonWarData } from "@/services/rosters";

export interface SeasonView {
  season: CwlSeason;
  wars: CwlWar[];
  totals: SeasonTotals;
  span: SeasonSpan | null;
  running: boolean;
  groupClans: GroupClan[];
  /** Every war in the group, ours included (048) — what scouting reads days and states from. */
  groupWars: GroupWar[];
  standings: Standing[];
  us: Standing | null;
  /** The league the season was played in, when known, spelled as the medal table spells it. */
  league: string | null;
  /**
   * Where `league` came from. "clan" means the season row had none and the
   * clan's current league was used — right while the season runs, a guess after.
   */
  leagueSource: "season" | "clan" | null;
  /** Per-war rosters and attacks. Only when `withPlayers`. */
  warData: SeasonWarData[];
  /** Ended days only — see contributionReport. Only when `withPlayers`. */
  contributions: ContributionRow[];
  /** Every started day, live ones included: what medals are paid on so far. */
  starsSoFar: ContributionRow[];
  medals: MedalPlan | null;
}

export async function loadSeasonView(
  supabase: SupabaseClient,
  clan: { id: string; tag: string },
  season: CwlSeason,
  options: { withPlayers?: boolean; leagueOverride?: string | null } = {},
): Promise<SeasonView> {
  const [wars, group] = await Promise.all([
    warsInSeason(supabase, season.id),
    groupForSeason(supabase, season.id),
  ]);
  const span = seasonSpan(wars, new Date());
  const running = span?.state === "running";

  const standings = groupStandings(group.clans, group.wars, clan.tag);
  const us = group.wars.length ? ourStanding(standings) : null;

  // The season's own league first. Failing that, the clan's current one — but
  // only trusted while the season runs; after it, promotion may have moved it.
  let league = canonicalLeague(season.league);
  let leagueSource: SeasonView["leagueSource"] = league ? "season" : null;
  if (!league && running) {
    const detail = await clanDetail(supabase, clan.id);
    league = canonicalLeague(detail?.warLeague ?? null);
    leagueSource = league ? "clan" : null;
  }
  const override = canonicalLeague(options.leagueOverride ?? null);
  if (override) {
    league = override;
    leagueSource = "season";
  }

  let warData: SeasonWarData[] = [];
  if (options.withPlayers) {
    warData = await Promise.all(
      wars.map(async (war): Promise<SeasonWarData> => {
        const [apiRoster, attacks] = await Promise.all([
          rosterForWar(supabase, war.id),
          attacksForWar(supabase, war.id),
        ]);
        return { apiRoster, attacks, state: war.state };
      }),
    );
  }
  const contributions = contributionReport(warData);
  // A running day's stars already count towards medals, so for this one tally
  // a live day is treated as over. Preparation days still count for nothing.
  const starsSoFar = contributionReport(
    warData.map((w) => (w.state === "inWar" ? { ...w, state: "warEnded" } : w)),
  );

  const totals = seasonTotals(wars);
  const medals = medalPlan({
    league,
    position: us?.rank ?? null,
    final: !running,
    warsWon: totals.wins,
    players: starsSoFar.map((c) => ({
      playerId: c.playerId,
      tag: c.tag,
      name: c.name,
      warsPlayed: c.warsPlayed,
      attacksUsed: c.attacksUsed,
      stars: c.stars,
    })),
  });

  return {
    season,
    wars,
    totals,
    span,
    running,
    groupClans: group.clans,
    groupWars: group.wars,
    standings,
    us,
    league,
    leagueSource,
    warData,
    contributions,
    starsSoFar,
    medals,
  };
}

/**
 * One board per war day of the season, in the order of `view.wars`: each of our
 * bases with its owner's attack and the enemy's attacks on it.
 *
 * The enemy half comes from the group lineups (057), read once for all of our
 * wars. `view` must have been loaded `withPlayers` — the rosters and attacks
 * are its warData.
 */
export async function loadSeasonBoards(
  supabase: SupabaseClient,
  clan: { tag: string },
  view: SeasonView,
): Promise<DayBoard[]> {
  // Without the members swapped out in preparation: a 15-base war is fifteen
  // bases a side, whatever was listed the day before.
  const lineups = fieldedOnly(
    await lineupsForWars(
      supabase,
      view.season.id,
      view.wars.map((w) => w.warTag),
    ),
    teamSizes(view.wars),
  );
  return view.wars.map((war, index) =>
    dayBoard({
      roster: view.warData[index]?.apiRoster ?? [],
      attacks: view.warData[index]?.attacks ?? [],
      lineup: lineups.filter((m) => m.warTag === war.warTag),
      ourTag: clan.tag,
      teamSize: war.teamSize,
      groupWar: view.groupWars.find((w) => w.warTag === war.warTag),
    }),
  );
}

/**
 * The season's player rating (services/cwl-rating.ts) from its boards. A day
 * the sync never saw finish counts once the season itself is over.
 */
export function ratingFor(view: SeasonView, boards: readonly DayBoard[]): SeasonRating {
  return seasonRating(
    view.wars.map((war, index) => ({
      dayNumber: war.dayNumber,
      state: war.state,
      board: boards[index]!,
    })),
    !view.running,
  );
}

/**
 * Who may open the printable monthly report: the clan's leader and co-leaders,
 * and platform admins. Admins are not a clan role (lib/auth.ts keeps them
 * apart on purpose), so this is the one place the two are combined.
 */
export async function canPrintCwlReport(
  supabase: SupabaseClient,
  role: ClanRole,
): Promise<boolean> {
  if (isLeadership(role)) return true;
  const userId = await currentUserId(supabase);
  return userId ? isPlatformAdmin(supabase, userId) : false;
}
