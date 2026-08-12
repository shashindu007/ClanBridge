// T7.5 — the Clan Games derivations.
//
// One rule dominates, and it is the same one T6.10 gets right about war targets:
//
//   "NOT MEASURED" IS NOT ZERO.
//
// A Clan Games score is a DIFFERENCE — a snapshot of the "Games Champion"
// achievement at the end of the period minus one from the start. A member with
// no opening reading has nothing to subtract from, and no amount of later
// syncing repairs it: the achievement is a lifetime total, so using it raw would
// credit someone who joined on the 25th with every point they have ever earned.
//
// Collapsing that into 0 puts a member who joined mid-period at the bottom of a
// leaderboard beside a member who did nothing, and the leader's bonus decisions
// get made off that table. Same failure T6.10 refuses when it keeps "cannot tell
// yet" separate from "ignored their target".

import { describe, expect, it } from "vitest";
import type { ClanGamesRow, ClanGamesScoreRow } from "@/repositories/clan-games";
import {
  gamesTotals,
  isSettled,
  leaderboard,
  playerGamesSummary,
  statusOf,
} from "@/services/clan-games";

function games(over: Partial<ClanGamesRow> = {}): ClanGamesRow {
  return {
    id: "g1",
    season: "2026-08",
    startTime: "2026-08-22T08:00:00Z",
    endTime: "2026-08-28T08:00:00Z",
    settledAt: "2026-08-28T09:00:00Z",
    ...over,
  };
}

const RUNNING = games({ settledAt: null });

function score(id: string, over: Partial<ClanGamesScoreRow> = {}): ClanGamesScoreRow {
  return {
    playerId: id,
    tag: `#${id.toUpperCase()}`,
    name: `Player ${id}`,
    startValue: 21_000,
    endValue: 23_500,
    points: 2_500,
    ...over,
  };
}

describe("services/clan-games", () => {
  describe("isSettled", () => {
    it("is true only once the closing snapshot has run", () => {
      expect(isSettled(games())).toBe(true);
      expect(isSettled(RUNNING)).toBe(false);
    });
  });

  describe("statusOf — three states, not two", () => {
    it("is scored when both readings exist", () => {
      expect(statusOf(score("a"), games())).toBe("scored");
    });

    // Zero is a REAL answer. They were measured and they got nothing, which is
    // exactly the fact a leader needs and must not be confused with an absence.
    it("treats a genuine zero as scored", () => {
      expect(statusOf(score("a", { endValue: 21_000, points: 0 }), games())).toBe("scored");
    });

    it("is pending while the period is still running", () => {
      expect(
        statusOf(score("a", { endValue: null, points: null }), RUNNING),
      ).toBe("pending");
    });

    // THE CASE THIS FILE EXISTS FOR. No opening reading means no subtraction is
    // possible, ever.
    it("is unmeasured when there is no opening reading", () => {
      expect(statusOf(score("a", { startValue: null }), games())).toBe("unmeasured");
    });

    it("is unmeasured when the member has no row at all", () => {
      expect(statusOf(null, games())).toBe("unmeasured");
    });

    // A settled month with no closing reading means the end pass dropped them.
    // Nothing further is coming, so calling it "pending" would promise a number
    // that will never arrive.
    it("is unmeasured, not pending, once the month is settled", () => {
      const dropped = score("a", { endValue: null, points: null });
      expect(statusOf(dropped, RUNNING)).toBe("pending");
      expect(statusOf(dropped, games())).toBe("unmeasured");
    });
  });

  describe("leaderboard", () => {
    it("ranks the measured by points, highest first", () => {
      const board = leaderboard(
        [
          score("low", { points: 500 }),
          score("high", { points: 4_000 }),
          score("mid", { points: 2_000 }),
        ],
        games(),
      );
      expect(board.map((e) => e.playerId)).toEqual(["high", "mid", "low"]);
    });

    // Unmeasured members sort last AND carry their status, so the page can pull
    // them out into their own section instead of leaving them at the bottom of
    // a ranked list where they read as the worst performers.
    it("puts unmeasured members last and keeps them identifiable", () => {
      const board = leaderboard(
        [
          score("nostart", { startValue: null, points: null, endValue: null }),
          score("zero", { endValue: 21_000, points: 0 }),
        ],
        games(),
      );
      expect(board.map((e) => e.playerId)).toEqual(["zero", "nostart"]);
      expect(board[1]!.status).toBe("unmeasured");
    });

    it("orders scored above pending above unmeasured", () => {
      const board = leaderboard(
        [
          score("unmeasured", { startValue: null }),
          score("pending", { endValue: null, points: null }),
          score("scored", { points: 10 }),
        ],
        RUNNING,
      );
      expect(board.map((e) => e.status)).toEqual(["scored", "pending", "unmeasured"]);
    });

    it("breaks ties on name", () => {
      const board = leaderboard(
        [score("b", { points: 100, name: "Bea" }), score("a", { points: 100, name: "Ann" })],
        games(),
      );
      expect(board.map((e) => e.name)).toEqual(["Ann", "Bea"]);
    });
  });

  describe("gamesTotals", () => {
    it("sums only the members who were measured", () => {
      const board = leaderboard(
        [
          score("a", { points: 2_000 }),
          score("b", { points: 1_000 }),
          score("c", { startValue: null, points: null, endValue: null }),
        ],
        games(),
      );
      const totals = gamesTotals(board);

      expect(totals.points).toBe(3_000);
      expect(totals.scored).toBe(2);
      expect(totals.unmeasured).toBe(1);
      expect(totals.best).toBe(2_000);
    });

    // The counts travel with the total so the page can never present a partial
    // sum as a complete one. "48,000 across 22, 3 not measured" is honest;
    // "48,000" alone implies the whole clan.
    it("reports pending and unmeasured counts alongside the total", () => {
      const board = leaderboard(
        [
          score("a", { points: 2_000 }),
          score("b", { endValue: null, points: null }),
          score("c", { startValue: null }),
        ],
        RUNNING,
      );
      const totals = gamesTotals(board);

      expect(totals).toMatchObject({ points: 2_000, scored: 1, pending: 1, unmeasured: 1 });
    });

    it("has no best score when nobody has one", () => {
      const board = leaderboard([score("a", { startValue: null })], games());
      expect(gamesTotals(board).best).toBeNull();
    });

    it("is all zeroes for an empty month", () => {
      expect(gamesTotals([])).toEqual({
        points: 0,
        scored: 0,
        pending: 0,
        unmeasured: 0,
        best: null,
      });
    });
  });

  describe("playerGamesSummary", () => {
    it("counts every month in the history, including ones they missed", () => {
      const summary = playerGamesSummary([
        { games: games({ id: "g1" }), score: score("a", { points: 3_000 }) },
        { games: games({ id: "g2" }), score: null },
        { games: games({ id: "g3" }), score: score("a", { points: 1_000 }) },
      ]);

      expect(summary.monthsAvailable).toBe(3);
      expect(summary.monthsScored).toBe(2);
      expect(summary.totalPoints).toBe(4_000);
    });

    // The average divides by months MEASURED, not by the whole history.
    // Dividing by three here would score a member against a month nobody has a
    // reading for — the arithmetic form of the same mistake.
    it("averages over months measured, not months available", () => {
      const summary = playerGamesSummary([
        { games: games({ id: "g1" }), score: score("a", { points: 3_000 }) },
        { games: games({ id: "g2" }), score: null },
        { games: games({ id: "g3" }), score: score("a", { points: 1_000 }) },
      ]);
      expect(summary.averagePoints).toBe(2_000);
    });

    it("counts a measured zero in the average", () => {
      const summary = playerGamesSummary([
        { games: games({ id: "g1" }), score: score("a", { endValue: 21_000, points: 0 }) },
        { games: games({ id: "g2" }), score: score("a", { points: 1_000 }) },
      ]);
      expect(summary.monthsScored).toBe(2);
      expect(summary.averagePoints).toBe(500);
    });

    it("has no average for a member never measured", () => {
      const summary = playerGamesSummary([
        { games: games({ id: "g1" }), score: null },
      ]);
      expect(summary.averagePoints).toBeNull();
      expect(summary.monthsScored).toBe(0);
    });

    it("is empty for a clan with no months at all", () => {
      expect(playerGamesSummary([])).toEqual({
        monthsAvailable: 0,
        monthsScored: 0,
        totalPoints: 0,
        averagePoints: null,
      });
    });
  });
});
