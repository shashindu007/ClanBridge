// The Clan Games rating: each player's points for the month turned into marks,
// and the marks into that player's share of their clan's marks.
//
// The clan set these rules; this file is the one place they are written down.
// GAMES_MARKS holds every number, and the page that explains the rating prints
// from the same constants, so the explanation cannot drift from the sums.
//
//   MARKS    +1.00 for every 1,000 points, in proportion (7,500 is +7.50), up
//            to the 10,000 a player can score in one month. Anything over the
//            cap counts as 10,000 — the readings are a difference of two
//            achievement values, so an excess is a reading problem, not effort.
//
//   SHARE    a player's marks ÷ every scored member's marks in their OWN clan
//            that month, as a %: 7 marks of a clan's 100 is 7%. Shares in one
//            clan add up to 100, as the raid, war and CWL ratings.
//
// SETTLED MONTHS ONLY. Points exist once the end-of-period snapshot has run
// (clan_games.settled_at); until then there is nothing to rate, and the page
// says the games are still running rather than ranking everyone at zero.
//
// NOT MEASURED IS NOT ZERO. A member with no opening reading (joined mid-period,
// or the start pass missed them) has no score, and is kept out of both the
// ranking and the clan's total — services/clan-games.ts argues it in full.
//
// DERIVED, NEVER STORED, like the other ratings: a reading of the scores
// already kept, and a stored copy would be a second source that could disagree.

import type { ClanGamesRow, ClanGamesScoreRow } from "@/repositories/clan-games";
import { isSettled, statusOf } from "@/services/clan-games";
import { round2 } from "@/services/raid-rating";

export const GAMES_MARKS = {
  /** `marks` for every `per` points, in proportion. */
  per: 1_000,
  marks: 1,
  /** The most points one player can score in a month; anything above counts as this. */
  cap: 10_000,
} as const;

/** One month's points as marks: 7,500 is 7.5, 12,000 is the cap's 10. */
export function gamesMarks(points: number): number {
  const counted = Math.min(Math.max(points, 0), GAMES_MARKS.cap);
  return round2((counted / GAMES_MARKS.per) * GAMES_MARKS.marks);
}

export interface PlayerGamesRating {
  playerId: string;
  tag: string;
  name: string;
  /** The points as measured, before the cap. */
  points: number;
  /** The points the marks were worked out from — `points`, capped. */
  counted: number;
  marks: number;
  /** % of the clan's marks this month. */
  share: number;
}

export interface MonthGamesRating {
  /** False while the games are running: nothing is rated until they end. */
  settled: boolean;
  /** Every scored member's marks, added up — the whole a share is of. */
  totalMarks: number;
  /** Scored members, highest share first. Empty until the month is settled. */
  players: PlayerGamesRating[];
  /** Members with no score this month. Never ranked, never in the total. */
  unmeasured: ClanGamesScoreRow[];
}

/** One clan's month. `games` null means the clan has no Clan Games that month. */
export function monthGamesRating(
  scores: ClanGamesScoreRow[],
  games: ClanGamesRow | null,
): MonthGamesRating {
  if (!games || !isSettled(games)) {
    return { settled: false, totalMarks: 0, players: [], unmeasured: [] };
  }

  const scored: ClanGamesScoreRow[] = [];
  const unmeasured: ClanGamesScoreRow[] = [];
  for (const score of scores) {
    (statusOf(score, games) === "scored" ? scored : unmeasured).push(score);
  }

  const marked = scored.map((score) => {
    const points = score.points ?? 0;
    return {
      playerId: score.playerId,
      tag: score.tag,
      name: score.name,
      points,
      counted: Math.min(points, GAMES_MARKS.cap),
      marks: gamesMarks(points),
    };
  });
  const totalMarks = round2(marked.reduce((t, p) => t + p.marks, 0));

  const players = marked
    // A month everyone scored nothing in is 0% each, not a division by zero.
    .map((p) => ({ ...p, share: totalMarks > 0 ? (p.marks / totalMarks) * 100 : 0 }))
    .sort((a, b) => b.share - a.share || b.points - a.points || a.name.localeCompare(b.name));

  return {
    settled: true,
    totalMarks,
    players,
    unmeasured: unmeasured.sort((a, b) => a.name.localeCompare(b.name)),
  };
}
