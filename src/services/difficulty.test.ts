// The difficulty weight: the league and enemy Town Hall tables the club agreed,
// and that a minus is never shrunk.

import { describe, expect, it } from "vitest";
import {
  averageTh,
  dayWeight,
  leagueWeight,
  thWeight,
  warWeight,
  weighPlus,
  weightLabel,
  weightedMonth,
} from "@/services/difficulty";

describe("leagueWeight", () => {
  it("is 0.1 for Bronze League III and 0.1 more for each league up", () => {
    expect(leagueWeight("Bronze League III")).toBe(0.1);
    expect(leagueWeight("Bronze League II")).toBe(0.2);
    expect(leagueWeight("Silver League I")).toBe(0.6);
    expect(leagueWeight("Crystal League III")).toBe(1);
    expect(leagueWeight("Champion League I")).toBe(1.8);
    expect(leagueWeight("Titan League I")).toBe(2.1);
    expect(leagueWeight("Legend League")).toBe(2.2);
  });

  it("reads a name however it reached us, and knows nothing of a name that is not a league", () => {
    expect(leagueWeight("champion i")).toBe(1.8);
    expect(leagueWeight("Master III")).toBe(1.3);
    expect(leagueWeight("Unranked")).toBeNull();
    expect(leagueWeight(null)).toBeNull();
  });
});

describe("thWeight", () => {
  it("is 1.85 at the top hall and 0.15 less for each level below, never under 1", () => {
    expect(thWeight(18, 18)).toBe(1.85);
    expect(thWeight(17, 18)).toBe(1.7);
    expect(thWeight(16.07, 18)).toBe(1.56);
    expect(thWeight(14, 18)).toBe(1.25);
    expect(thWeight(12, 18)).toBe(1);
    expect(thWeight(11, 18)).toBe(1);
  });

  it("counts an unknown lineup as an easy one, and moves with a new top hall", () => {
    expect(thWeight(null)).toBe(1);
    expect(thWeight(18, 19)).toBe(1.7);
  });
});

describe("averageTh", () => {
  it("is the mean of the levels that are known, not the highest", () => {
    expect(averageTh([17, 12, 12, 12])).toBe(13.25);
    expect(averageTh([18, null, 16])).toBe(17);
    expect(averageTh([])).toBeNull();
  });
});

describe("a war's and a day's weight", () => {
  it("is the enemy Town Hall for a war", () => {
    expect(warWeight([18, 18, 17])).toBe(1.8);
    expect(warWeight([])).toBe(1);
  });

  it("is the league times the enemy Town Hall for a CWL day", () => {
    expect(dayWeight("Champion League I", [17, 17])).toBe(3.06);
    expect(dayWeight("Silver League II", [12, 12])).toBe(0.5);
    // Half a hall up still counts a little: 12.5 is 1.03, so 0.515.
    expect(dayWeight("Silver League II", [12, 13])).toBe(0.52);
    // No league recorded: neither help nor harm.
    expect(dayWeight(null, [18])).toBe(1.85);
  });
});

describe("weighPlus", () => {
  it("multiplies a plus and leaves a minus alone", () => {
    expect(weighPlus(10, 1.5)).toBe(15);
    expect(weighPlus(-10, 1.5)).toBe(-10);
    expect(weighPlus(0, 1.5)).toBe(0);
  });
});

describe("weightedMonth", () => {
  const unit = (share: number, marks: number) => ({ share, marks });

  it("adds up the counted units, each by its own weight", () => {
    const month = weightedMonth([unit(10, 5), unit(-4, -2), null, unit(20, 8)], [2, 2, 1, 1], [true, true, true, false]);
    // 10 × 2 + (−4, not weighed); the fourth is not counted yet.
    expect(month.rating).toBe(16);
    expect(month.marks).toBe(8);
    expect(month.perUnit).toBe(8);
    expect(month.averageWeight).toBe(2);
  });

  it("is nothing before the first counted unit", () => {
    expect(weightedMonth([null], [1], [true])).toEqual({ rating: 0, marks: 0, perUnit: null, averageWeight: null });
  });

  it("puts a minnow clan's work below a max clan's for the same share", () => {
    const minnow = weightedMonth([unit(10, 7)], [dayWeight("Silver League II", [12])], [true]);
    const max = weightedMonth([unit(10, 7)], [dayWeight("Champion League I", [17])], [true]);
    expect(minnow.rating).toBe(5);
    expect(max.rating).toBe(30.6);
  });
});

describe("weightLabel", () => {
  it("reads as a multiplier", () => {
    expect(weightLabel(1.56)).toBe("×1.56");
    expect(weightLabel(null)).toBe("—");
  });
});
