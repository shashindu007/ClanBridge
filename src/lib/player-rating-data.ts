// The whole family's Player rating for one month, worked out for the sync job
// (scripts/sync/ratings.ts) to store.
//
// Takes the service client: this is the one place that reads every clan, and it
// can only run on GitHub Actions (R6). Each clan's reads still go under that
// clan's id, through the loaders its own rating page uses, so a player's marks
// here are the marks on that page.
//
// A READ THAT FAILS THROWS, ALL THE WAY OUT. One clan missing changes every
// player's share, and a stored number is not corrected by the next page load.
// The job fails, and the month keeps its last good ranking.

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSeasonBoards, loadSeasonView, ratingFor } from "@/lib/cwl-season";
import { loadGamesMonth } from "@/lib/games-rating-data";
import { loadRaidMonth } from "@/lib/raid-rating-data";
import type { RatingKind } from "@/lib/rating";
import { loadWarMonth } from "@/lib/war-rating-data";
import { seasonByName } from "@/repositories/cwl";
import { membersForClan } from "@/repositories/members";
import {
  SEGMENT_WINDOW_DAYS,
  donationReadings,
  donationSegments,
} from "@/repositories/season-donations";
import { donationMarks, playerRatings, type PlayerRating } from "@/services/player-rating";
import {
  seasonDonations,
  seasonForMonth,
  seasonResets,
  seasonsFrom,
  type DonationSegment,
  type Season,
} from "@/services/season-donations";

const DAY = 86_400_000;

interface Clan {
  id: string;
  tag: string;
}

export interface Family {
  clans: Clan[];
  /** Every current member, and the clan they are in now. */
  clanOf: Map<string, string>;
  segments: DonationSegment[];
  seasons: Season[];
}

/** What every month of a run shares, read once. */
export async function loadFamily(
  supabase: SupabaseClient,
  clans: Clan[],
  now: Date,
): Promise<Family> {
  const clanOf = new Map<string, string>();
  for (const clan of clans) {
    for (const member of await membersForClan(supabase, clan.id)) {
      clanOf.set(member.playerId, clan.id);
    }
  }

  const segments = await donationSegments(
    supabase,
    clans.map((c) => c.id),
    new Date(now.getTime() - SEGMENT_WINDOW_DAYS * DAY),
  );

  return { clans, clanOf, segments, seasons: seasonsFrom(seasonResets(segments)) };
}

/**
 * The month's season, or null when it cannot be rated: a season that began
 * before our readings has only part of its donations, and ranking on those
 * would quietly favour whoever gave late.
 */
export function ratedSeason(family: Family, month: string, now: Date): Season | null {
  const season = seasonForMonth(family.seasons, month, now);
  return season?.start ? season : null;
}

function add(marks: Map<string, number>, players: ReadonlyArray<{ playerId: string; marks: number }>) {
  for (const player of players) {
    marks.set(player.playerId, (marks.get(player.playerId) ?? 0) + player.marks);
  }
}

/** Null when nobody in the family has a mark this month, so there is nothing to rank. */
export async function familyMonthRatings(
  supabase: SupabaseClient,
  family: Family,
  month: string,
  season: Season,
  now: Date,
): Promise<PlayerRating[] | null> {
  const marks: Record<RatingKind, Map<string, number>> = {
    donations: new Map(),
    war: new Map(),
    cwl: new Map(),
    games: new Map(),
    raids: new Map(),
  };

  // One clan at a time, on purpose. This is a background job on a small
  // database, and nobody is waiting on it.
  for (const clan of family.clans) {
    add(marks.war, (await loadWarMonth(supabase, clan, month)).rating.players);
    add(marks.raids, (await loadRaidMonth(supabase, clan, month)).rating.players);
    add(marks.games, (await loadGamesMonth(supabase, clan, month)).rating.players);

    const cwl = await seasonByName(supabase, clan.id, month);
    if (cwl) {
      // withPlayers, or the view has no rosters and every CWL mark comes out 0.
      const view = await loadSeasonView(supabase, clan, cwl, { withPlayers: true });
      const boards = await loadSeasonBoards(supabase, clan, view);
      add(marks.cwl, ratingFor(view, boards).players);
    }
  }

  // The same reach as the Season donations page: its own readings, a few days
  // before (a stay straddling its start), and ten after (the missed tail).
  const readings = await donationReadings(
    supabase,
    family.clans.map((c) => c.id),
    new Date(Date.parse(season.start!) - 3 * DAY),
    new Date(season.end ? Date.parse(season.end) + 10 * DAY : now.getTime() + DAY),
  );
  for (const row of seasonDonations(family.segments, readings, season).rows) {
    marks.donations.set(row.playerId, donationMarks(row));
  }

  const ratings = playerRatings([...family.clanOf.keys()], marks);
  const anyMarks = ratings.some((r) => Object.values(r.marks).some((value) => value !== 0));
  return anyMarks ? ratings : null;
}
