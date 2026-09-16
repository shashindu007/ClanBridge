// T11.11 — everything one village's report is built from, in one place.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// [clanTag]/player/[tag] had assembled this bundle inline since T3B.4, which was
// right while it was the only page that wanted it. T11.12 adds a second — a
// member's own base, reached without a clan role — and two copies of a
// six-read batch plus five derivations is two pages that will eventually disagree
// about what "missed" means.
//
// That is not hypothetical in this repo. It is the failure §0 keeps recording: a
// "Not built yet" panel three sections below a working link, and the hint lines
// lib/clan-nav.ts exists to stop being written twice. WAR_WINDOW's own comment —
// "the same window /war/report uses, so the two pages never show different
// totals" — becomes MORE true with a third caller, and that is the argument for
// moving it here rather than copying it.
//
// A REPOSITORY, not a service, because it is queries. src/services/README.md
// draws the line at "anything that is a calculation rather than a query", and the
// calculations are still where they were: this file calls them, it does not
// reimplement them. Not in members.ts, which would double in size while importing
// five sibling repositories.
//
// T11C.3 — CWL IS THE ONE FAMILY-WIDE READ. A village's CWL record comes from
// every platform clan through familyCwlHistory() (037), because members move
// between the family's clans and play CWL in whichever one fields a roster —
// SK FLASH's whole record is in DH CWL ONLY while it lives in Dark Hell, and the
// per-clan read reported it as having none. The other five reads stay confined to
// `clanId`; 037's header is where the exception and its limits are argued.
//
// R3 — clanId stays an EXPLICIT PARAMETER rather than being resolved in here, so
// the filter is visible at every call site. Both callers reach it from something
// that already authorised the clan: requireClanByTag() on the profile, and the
// member's own clan_roles on /account/bases. A function that resolved the clan
// itself would move that decision out of the page and into a place nobody reads
// when reviewing for R3.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { gamesForPlayer } from "@/repositories/clan-games";
import { familyCwlHistory, type FamilySeasonTotals } from "@/repositories/cwl";
import { clanMovement, snapshotHistory } from "@/repositories/members";
import { seasonsForPlayer } from "@/repositories/raids";
import { attacksForWar, membersOfWar, targetsForWar, warsForClan } from "@/repositories/war";
import { playerGamesSummary, type PlayerGamesSummary } from "@/services/clan-games";
import {
  donationSeasons,
  lastActivityAt,
  type DonationSeason,
} from "@/services/members";
import { playerRaidSummary, type PlayerRaidSummary } from "@/services/raids";
import { warContribution, type WarContribution } from "@/services/war";

/** Six months, because that is the window objective O4 names. */
export const HISTORY_DAYS = 182;

/** The same window /war/report uses, so no two pages show different totals. */
export const WAR_WINDOW = 10;

/** Where a player has been. Clan IDS — the caller resolves names it may see. */
export interface MovementRow {
  clanId: string;
  firstSeen: string;
  lastSeen: string;
}

export interface CwlTotals {
  warsRostered: number;
  attacksUsed: number;
  stars: number;
}

export interface PlayerReport {
  /**
   * Per-season CWL record from EVERY platform clan, newest first, each naming the
   * clan it was played in (T11C.3).
   */
  cwlSeasons: FamilySeasonTotals[];
  /** Summed across those seasons and clans, so the header and the table cannot disagree. */
  cwlTotals: CwlTotals;
  /**
   * Donation months, OLDEST FIRST as services/members.ts produces them.
   *
   * Deliberately not reversed here. The display order is a reading decision (a
   * leader wants the current month at the top) and belongs with the markup; a
   * repository that returned data newest-first would be making that decision for
   * every future caller, including one that wants to chart it.
   */
  donations: DonationSeason[];
  /** When a counter was last seen to RISE, not when a row was last written. */
  lastSeen: string | null;
  movement: MovementRow[];
  raids: PlayerRaidSummary;
  games: PlayerGamesSummary;
  /** Null when this member has no war record in this clan at all. */
  war: WarContribution | null;
}

/**
 * The whole report for one village in one clan.
 *
 * SEVEN READS IN TWO WAVES, which is what keeps objective O4's thirty seconds
 * honest. The first wave is six independent reads issued together; the second is
 * the war window, which cannot start until warsForClan() has said which wars
 * there are, and then issues all 3N of its own at once. Ten wars at three
 * sequential reads each was thirty round trips to a database in another region.
 *
 * @param historyDays overridable only so a caller can narrow the window; the
 * default is the one objective O4 names and no caller should widen it casually,
 * because member_snapshots is hourly and the row count grows with it.
 */
export async function playerReport(
  supabase: SupabaseClient,
  clanId: string,
  playerId: string,
  options: { historyDays?: number; warWindow?: number } = {},
): Promise<PlayerReport> {
  const historyDays = options.historyDays ?? HISTORY_DAYS;
  const warWindow = options.warWindow ?? WAR_WINDOW;

  const since = new Date(Date.now() - historyDays * 86_400_000);

  const [cwlHistory, snapshots, movement, raidHistory, gamesHistory, recentWars] =
    await Promise.all([
      // Family-wide — see the T11C.3 note in the header.
      familyCwlHistory(supabase, [playerId]),
      snapshotHistory(supabase, clanId, playerId, since),
      clanMovement(supabase, playerId),
      seasonsForPlayer(supabase, clanId, playerId),
      gamesForPlayer(supabase, clanId, playerId),
      warsForClan(supabase, clanId, warWindow),
    ]);

  // Wave two. Every war's three reads go at once, and so do all the wars.
  const perWar = await Promise.all(
    recentWars.map(async (war) => {
      const [members, attacks, targets] = await Promise.all([
        membersOfWar(supabase, war.id),
        attacksForWar(supabase, war.id),
        targetsForWar(supabase, war.id),
      ]);
      return { members, attacks, targets };
    }),
  );

  // The SHARED derivation, not a second count. /war/report computes its table
  // from the same function over the same window, which is why the two pages
  // cannot disagree about what a missed attack is.
  const war = warContribution(perWar).find((c) => c.playerId === playerId) ?? null;

  const cwlSeasons = cwlHistory.get(playerId) ?? [];

  const cwlTotals = cwlSeasons.reduce<CwlTotals>(
    (sum, s) => ({
      warsRostered: sum.warsRostered + s.warsRostered,
      attacksUsed: sum.attacksUsed + s.attacksUsed,
      stars: sum.stars + s.stars,
    }),
    { warsRostered: 0, attacksUsed: 0, stars: 0 },
  );

  return {
    cwlSeasons,
    cwlTotals,
    donations: donationSeasons(snapshots),
    lastSeen: lastActivityAt(snapshots),
    movement,
    raids: playerRaidSummary(raidHistory),
    games: playerGamesSummary(gamesHistory),
    war,
  };
}
