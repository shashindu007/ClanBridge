// The shared war-day vocabulary. The colour a tab wears is the whole message on
// the CWL page, so the mapping from (result, state) to tone is pinned here.

import { describe, expect, it } from "vitest";
import { dayTone, formatRemaining, ordinal } from "@/lib/war-status";

describe("dayTone", () => {
  it("lets a result win over the state", () => {
    expect(dayTone("win", "warEnded")).toBe("win");
    expect(dayTone("lose", "warEnded")).toBe("loss");
    expect(dayTone("tie", "warEnded")).toBe("tie");
    // A result is only ever set once a day is over; if both exist, the result is the truth.
    expect(dayTone("win", "inWar")).toBe("win");
  });

  it("reads a running day as live and a preparation day as prep", () => {
    expect(dayTone(null, "inWar")).toBe("live");
    expect(dayTone(null, "preparation")).toBe("prep");
  });

  it("falls back to pending when nothing is known", () => {
    expect(dayTone(null, null)).toBe("pending");
    expect(dayTone(undefined, "notInWar")).toBe("pending");
  });
});

describe("formatRemaining", () => {
  it("shows days and hours when more than a day is left", () => {
    expect(formatRemaining((2 * 86_400 + 4 * 3600 + 59) * 1000)).toBe("2d 4h");
  });

  it("shows seconds inside the last day", () => {
    expect(formatRemaining((5 * 3600 + 12 * 60 + 8) * 1000)).toBe("5h 12m 08s");
    expect(formatRemaining((12 * 60 + 8) * 1000)).toBe("12m 08s");
    expect(formatRemaining(45_400)).toBe("45s");
  });

  it("never goes negative", () => {
    expect(formatRemaining(-5000)).toBe("0s");
    expect(formatRemaining(Number.NaN)).toBe("0s");
  });
});

describe("ordinal", () => {
  it("handles the teens", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal)).toEqual([
      "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd",
    ]);
  });
});
