import { describe, expect, it } from "vitest";
import type { ClanGamesRow, ClanGamesScoreRow } from "@/repositories/clan-games";
import { GAMES_MARKS, gamesMarks, monthGamesRating } from "./games-rating";

const SETTLED: ClanGamesRow = {
  id: "g1",
  season: "2026-09",
  startTime: "2026-09-22T08:00:00Z",
  endTime: "2026-09-28T08:00:00Z",
  settledAt: "2026-09-28T08:41:00Z",
};
const RUNNING: ClanGamesRow = { ...SETTLED, settledAt: null };

/** Player `n`, measured at both ends, with `points` for the month. */
function score(n: number, points: number, over: Partial<ClanGamesScoreRow> = {}): ClanGamesScoreRow {
  return {
    playerId: `p${n}`,
    tag: `#P${n}`,
    name: `Player ${n}`,
    points,
    startValue: 100_000,
    endValue: 100_000 + points,
    ...over,
  };
}

describe("marks", () => {
  it("gives +1.00 for every 1,000 points, in proportion", () => {
    expect(gamesMarks(7_000)).toBe(7);
    expect(gamesMarks(7_500)).toBe(7.5);
    expect(gamesMarks(1_234)).toBe(1.23);
    expect(gamesMarks(0)).toBe(0);
  });

  it("counts nothing above the cap", () => {
    expect(gamesMarks(GAMES_MARKS.cap)).toBe(10);
    expect(gamesMarks(12_000)).toBe(10);
  });
});

describe("one clan's month", () => {
  it("rates the agreed worked example: 7 marks of the clan's 100 is 7%", () => {
    // 7,000 + 9 × 10,000 + 3,000 = 100 marks in all.
    const scores = [
      score(1, 7_000),
      ...Array.from({ length: 9 }, (_, i) => score(i + 2, 10_000)),
      score(11, 3_000),
    ];
    const rating = monthGamesRating(scores, SETTLED);
    expect(rating.totalMarks).toBe(100);
    expect(rating.players.find((p) => p.name === "Player 1")?.share).toBeCloseTo(7);
  });

  it("shares out exactly 100% of the clan's marks, highest first", () => {
    const rating = monthGamesRating([score(1, 2_500), score(2, 4_000), score(3, 1_000)], SETTLED);
    expect(rating.players.map((p) => p.name)).toEqual(["Player 2", "Player 1", "Player 3"]);
    expect(rating.players.reduce((t, p) => t + p.share, 0)).toBeCloseTo(100);
  });

  it("works the share out from the capped points", () => {
    const rating = monthGamesRating([score(1, 15_000), score(2, 10_000)], SETTLED);
    expect(rating.players.map((p) => [p.counted, p.marks, p.share])).toEqual([
      [10_000, 10, 50],
      [10_000, 10, 50],
    ]);
    // Same share, the higher measured score breaks the tie.
    expect(rating.players[0]!.points).toBe(15_000);
  });

  it("keeps the unmeasured out of the ranking and the total", () => {
    const rating = monthGamesRating(
      [score(1, 4_000), score(2, 0, { points: null, startValue: null, endValue: null })],
      SETTLED,
    );
    expect(rating.players.map((p) => p.name)).toEqual(["Player 1"]);
    expect(rating.players[0]!.share).toBe(100);
    expect(rating.unmeasured.map((p) => p.name)).toEqual(["Player 2"]);
  });

  it("ranks a measured zero at 0%", () => {
    const rating = monthGamesRating([score(1, 4_000), score(2, 0)], SETTLED);
    expect(rating.players.map((p) => [p.name, p.share])).toEqual([
      ["Player 1", 100],
      ["Player 2", 0],
    ]);
  });

  it("does not divide by zero when nobody scored", () => {
    const rating = monthGamesRating([score(1, 0), score(2, 0)], SETTLED);
    expect(rating.totalMarks).toBe(0);
    expect(rating.players.map((p) => p.share)).toEqual([0, 0]);
  });

  it("rates nothing while the games are running", () => {
    const rating = monthGamesRating([score(1, 0, { points: null, endValue: null })], RUNNING);
    expect(rating).toEqual({ settled: false, totalMarks: 0, players: [], unmeasured: [] });
  });

  it("rates nothing for a month the clan has no games in", () => {
    expect(monthGamesRating([], null).settled).toBe(false);
  });
});
