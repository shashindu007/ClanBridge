// The medal table and the star rule. The numbers are the game's, so the tests
// pin the shape and the arithmetic, not the table itself.

import { describe, expect, it } from "vitest";
import {
  CWL_LEAGUES,
  CWL_MEDALS,
  bonusCount,
  canonicalLeague,
  leaguePayout,
  playerMedals,
  starShare,
} from "@/data/cwl-medals";

describe("CWL_MEDALS", () => {
  it("pays more for a better position in every league", () => {
    for (const name of CWL_LEAGUES) {
      const pay = CWL_MEDALS[name]!.byPosition;
      for (let i = 1; i < pay.length; i += 1) expect(pay[i - 1]!).toBeGreaterThan(pay[i]!);
    }
  });

  it("pays more in a higher league, position for position", () => {
    for (let i = 1; i < CWL_LEAGUES.length; i += 1) {
      const lower = CWL_MEDALS[CWL_LEAGUES[i - 1]!]!;
      const higher = CWL_MEDALS[CWL_LEAGUES[i]!]!;
      expect(higher.byPosition[0]).toBeGreaterThan(lower.byPosition[0]);
      expect(higher.bonusValue).toBeGreaterThan(lower.bonusValue);
    }
  });
});

describe("leaguePayout", () => {
  it("finds a league by its API name, and forgives spelling", () => {
    expect(leaguePayout("Master League III")?.byPosition[0]).toBe(304);
    expect(leaguePayout("master iii")?.byPosition[0]).toBe(304);
    expect(canonicalLeague("crystal league i")).toBe("Crystal League I");
  });

  it("returns null for nothing, unranked or nonsense", () => {
    expect(leaguePayout(null)).toBeNull();
    expect(leaguePayout("Unranked")).toBeNull();
    expect(leaguePayout("Wooden League")).toBeNull();
  });
});

describe("the star rule", () => {
  it("is 20% on the roster, +10% a star, full at 8", () => {
    expect(starShare(0)).toBeCloseTo(0.2);
    expect(starShare(5)).toBeCloseTo(0.7);
    expect(starShare(8)).toBe(1);
    expect(starShare(21)).toBe(1);
  });

  it("scales the placement payout", () => {
    const master3 = leaguePayout("Master League III")!;
    expect(playerMedals(master3, 1, 8)).toBe(304);
    expect(playerMedals(master3, 8, 0)).toBe(Math.round(269 * 0.2));
    expect(playerMedals(master3, 3, 4)).toBe(Math.round(294 * 0.6));
  });

  it("adds a bonus per war won", () => {
    expect(bonusCount(leaguePayout("Gold League I")!, 0)).toBe(2);
    expect(bonusCount(leaguePayout("Gold League I")!, 5)).toBe(7);
  });
});
