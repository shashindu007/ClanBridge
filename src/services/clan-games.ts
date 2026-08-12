// T7.5 — the Clan Games derivations, as pure functions.
//
// No SQL, no clock beyond what is passed in, no Supabase import.
//
// ─────────────────────────────────────────────────────────────────────────────
// THREE STATES, NOT TWO, AND THE THIRD IS THE ONE THAT MATTERS
//
// A member on a Clan Games leaderboard is in exactly one of:
//
//   scored      points is a number, including 0 — they were measured, and this
//               is what they got. Zero is a real answer.
//   pending     the period is still running. There is a start_value and no
//               end_value yet, so nothing can be said about them at all.
//   unmeasured  no row, or a row with no start_value. They joined mid-period,
//               or the opening snapshot missed them. NOT zero.
//
// Collapsing `unmeasured` into zero is the failure this file exists to prevent,
// and it is the same mistake T6.10 refuses to make when it keeps "cannot tell
// yet" separate from "ignored their target". A member who joined on the 25th
// listed alongside a member who did nothing, both showing 0, is a report that
// accuses the first of the second's behaviour — and it is the leader's bonus
// decisions that get made off it.
//
// The reason it cannot be repaired later is worth stating: the score is a
// DIFFERENCE between two readings. Without the opening one there is no
// subtraction to perform, and the achievement is a lifetime total, so using it
// raw would credit a new member with every point they have ever earned.
// ─────────────────────────────────────────────────────────────────────────────

import type { ClanGamesRow, ClanGamesScoreRow } from "@/repositories/clan-games";

export type GamesStatus = "scored" | "pending" | "unmeasured";

export interface GamesEntry extends ClanGamesScoreRow {
  status: GamesStatus;
}

/** Has the end snapshot run? Until it has, every score on the month is provisional. */
export function isSettled(games: ClanGamesRow): boolean {
  return games.settledAt !== null;
}

/**
 * Which of the three a single row is in.
 *
 * `null` for the row itself means the member was never snapshotted — the
 * unmeasured case, reached from gamesForPlayer where a month with no row still
 * appears in the history.
 */
export function statusOf(
  score: ClanGamesScoreRow | null,
  games: ClanGamesRow,
): GamesStatus {
  if (!score || score.startValue === null) return "unmeasured";
  if (score.points === null || score.endValue === null) {
    // No closing reading yet. If the month is settled and this row still has
    // none, the member was dropped from the end pass — unmeasured, not pending,
    // because nothing further is coming.
    return isSettled(games) ? "unmeasured" : "pending";
  }
  return "scored";
}

/**
 * The leaderboard: everyone who was measured, highest first.
 *
 * Unmeasured members sort last and keep their status, so the page can render
 * them under a separate heading rather than at the bottom of a ranked list where
 * they read as the worst performers. A zero belongs in the ranking; an unknown
 * does not.
 */
export function leaderboard(
  scores: ClanGamesScoreRow[],
  games: ClanGamesRow,
): GamesEntry[] {
  return scores
    .map((score) => ({ ...score, status: statusOf(score, games) }))
    .sort(
      (a, b) =>
        rank(a.status) - rank(b.status) ||
        (b.points ?? 0) - (a.points ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

function rank(status: GamesStatus): number {
  return status === "scored" ? 0 : status === "pending" ? 1 : 2;
}

export interface GamesTotals {
  /** Summed across measured members only. */
  points: number;
  scored: number;
  pending: number;
  unmeasured: number;
  /** Highest single score, or null when nobody has one yet. */
  best: number | null;
}

/**
 * One month, summed.
 *
 * `points` counts only members who were actually measured, and the three counts
 * are reported alongside it so the page can never present a partial total as a
 * complete one. "48,000 across 22 members, 3 not measured" is honest; "48,000"
 * on its own implies the whole clan and is not.
 */
export function gamesTotals(entries: GamesEntry[]): GamesTotals {
  let points = 0;
  let scored = 0;
  let pending = 0;
  let unmeasured = 0;
  let best: number | null = null;

  for (const e of entries) {
    if (e.status === "scored") {
      scored += 1;
      points += e.points ?? 0;
      if (best === null || (e.points ?? 0) > best) best = e.points ?? 0;
    } else if (e.status === "pending") {
      pending += 1;
    } else {
      unmeasured += 1;
    }
  }

  return { points, scored, pending, unmeasured, best };
}

export interface PlayerGamesSummary {
  monthsAvailable: number;
  monthsScored: number;
  totalPoints: number;
  /** Mean across months they were measured in, rounded. Null when none. */
  averagePoints: number | null;
}

/**
 * One member's record across the months this clan has (T7.5, linked from the
 * player profile).
 *
 * The average divides by months MEASURED, not by months available. Dividing by
 * the whole history would score a member who joined last month against a year
 * they were not here for — the arithmetic version of the same mistake the
 * unmeasured status exists to prevent.
 */
export function playerGamesSummary(
  history: Array<{ games: ClanGamesRow; score: ClanGamesScoreRow | null }>,
): PlayerGamesSummary {
  let monthsScored = 0;
  let totalPoints = 0;

  for (const { games, score } of history) {
    if (statusOf(score, games) !== "scored") continue;
    monthsScored += 1;
    totalPoints += score?.points ?? 0;
  }

  return {
    monthsAvailable: history.length,
    monthsScored,
    totalPoints,
    averagePoints: monthsScored === 0 ? null : Math.round(totalPoints / monthsScored),
  };
}
