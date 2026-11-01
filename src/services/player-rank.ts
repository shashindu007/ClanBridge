// What to tell a player about their rank. Pure, so every state can be tested.
//
// THE NUMBER ITSELF COMES FROM THE DATABASE (075). This file only chooses which
// month to lead with and how to word it.
//
// FOUR DIFFERENT ANSWERS, because each needs a different sentence:
//
//   ranked       they have a place, in a named month
//   no-marks     the month is ranked, and nothing of theirs has counted
//   not-ranked   no ranking holds them yet
//   failed       the read failed, which says nothing about the player
//
// WHICH MONTH. On the 2nd of a month almost nobody has marks, so leading with it
// would hide a whole finished month behind "no marks yet". A month still open
// with no marks of theirs is skipped in favour of the last one that has. A closed
// month is never skipped: having no marks in it is the truth about that month.

import { hasMarks, monthOf, openMonths, type RatingKind } from "@/lib/rating";
import type { RatingMonth } from "@/repositories/player-ratings";

export type Standing =
  | { kind: "failed" }
  | { kind: "not-ranked" }
  | { kind: "no-marks"; month: string; open: boolean }
  | {
      kind: "ranked";
      month: string;
      /** The numbers can still change. */
      open: boolean;
      familyRank: number;
      familySize: number;
      tied: boolean;
      clanRank: number;
      clanSize: number;
      clanName: string;
      rating: number;
      shares: Record<RatingKind, number>;
      computedAt: string;
      /** "Up 3 from September". Null while the month is open, or with nothing to compare. */
      movement: string | null;
    };

export interface RankHistoryRow {
  month: string;
  open: boolean;
  familyRank: number;
  familySize: number;
  tied: boolean;
  rating: number;
}

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });

function monthBefore(month: string): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return monthOf(new Date(Date.UTC(year, number - 2, 1)));
}

/**
 * Against the month just before only: a rank from a gap of months ago says little
 * about how this one went.
 */
function movement(current: RatingMonth, history: readonly RatingMonth[]): string | null {
  const previous = history.find((row) => row.month === monthBefore(current.month));
  if (!previous?.placed || !current.placed || !hasMarks(previous.placed.marks)) return null;

  const change = previous.placed.familyRank - current.placed.familyRank;
  const name = monthName(previous.month);
  if (change === 0) return `Same as ${name}`;
  return `${change > 0 ? "Up" : "Down"} ${Math.abs(change)} from ${name}`;
}

/** @param history newest first. Null means the read failed. */
export function standingOf(history: readonly RatingMonth[] | null, now: Date): Standing {
  if (history === null) return { kind: "failed" };

  const open = new Set(openMonths(now));
  // A month nobody has marks in tells nobody anything.
  const placed = history.filter((row) => row.ratedPlayers > 0 && row.placed !== null);
  const newest = placed[0];
  if (!newest?.placed) return { kind: "not-ranked" };

  const head = placed.find((row) => !open.has(row.month) || hasMarks(row.placed!.marks)) ?? newest;
  const place = head.placed!;
  const isOpen = open.has(head.month);

  if (!hasMarks(place.marks)) return { kind: "no-marks", month: head.month, open: isOpen };

  return {
    kind: "ranked",
    month: head.month,
    open: isOpen,
    familyRank: place.familyRank,
    familySize: head.familySize,
    tied: place.tied,
    clanRank: place.clanRank,
    clanSize: place.clanSize,
    clanName: place.clanName,
    rating: place.rating,
    shares: place.shares,
    computedAt: place.computedAt,
    movement: isOpen ? null : movement(head, history),
  };
}

/** The months a player has a place in, newest first, for the profile's list. */
export function rankHistory(history: readonly RatingMonth[] | null, now: Date): RankHistoryRow[] {
  if (!history) return [];
  const open = new Set(openMonths(now));

  return history.flatMap((row) =>
    row.placed && hasMarks(row.placed.marks)
      ? [
          {
            month: row.month,
            open: open.has(row.month),
            familyRank: row.placed.familyRank,
            familySize: row.familySize,
            tied: row.placed.tied,
            rating: row.placed.rating,
          },
        ]
      : [],
  );
}
