// The Player rating's rules. Pure: no database.
//
// The ways this can be confidently wrong, none of which raises an error:
//
//   1. received or other-clan donations counted at the wrong rate or sign
//   2. a player's share taken of the wrong whole
//   3. weights that do not add up to 100, or are applied to the wrong section
//   4. a section nobody has marks in dividing by zero
//   5. a negative share pulling the whole down instead of only that player

import { describe, expect, it } from "vitest";
import type { RatingKind } from "@/lib/rating";
import {
  DONATION_MARKS,
  RATING_KINDS,
  RATING_WEIGHTS,
  donationMarks,
  playerRatings,
} from "./player-rating";

const given = (...amounts: number[]) => amounts.map((g, i) => ({ clanId: `clan-${i}`, given: g, received: 0 }));

function marks(partial: Partial<Record<RatingKind, Record<string, number>>>) {
  return Object.fromEntries(
    RATING_KINDS.map((kind) => [kind, new Map(Object.entries(partial[kind] ?? {}))]),
  ) as Record<RatingKind, Map<string, number>>;
}

describe("the clan's numbers", () => {
  it("are the ones agreed", () => {
    expect(DONATION_MARKS).toEqual({
      given: { per: 1_000, marks: 1 },
      received: { per: 2_000, marks: -1 },
      other: { per: 2_000, marks: 1 },
    });
    expect(RATING_WEIGHTS).toEqual({ donations: 20, war: 20, cwl: 30, games: 10, raids: 20 });
  });

  it("weigh to 100 (risk 3)", () => {
    expect(Object.values(RATING_WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe("donationMarks (risk 1)", () => {
  it("adds family donations, takes away receipts, and adds other clans at half", () => {
    expect(donationMarks({ byClan: given(12_000), received: 8_000, other: 4_000 })).toBe(10);
  });

  it("is in proportion, not whole blocks", () => {
    expect(donationMarks({ byClan: given(1_500), received: 0, other: 0 })).toBe(1.5);
    expect(donationMarks({ byClan: given(0), received: 500, other: 0 })).toBe(-0.25);
  });

  it("adds up every family clan a player gave in", () => {
    expect(donationMarks({ byClan: given(1_000, 2_000), received: 0, other: 0 })).toBe(3);
  });

  it("goes below zero for a player who takes more than they give", () => {
    expect(donationMarks({ byClan: given(1_000), received: 10_000, other: 0 })).toBe(-4);
  });

  it("reads no reading of other clans as none", () => {
    expect(donationMarks({ byClan: given(1_000), received: 0, other: null })).toBe(1);
  });
});

describe("playerRatings", () => {
  it("takes a share of every player's marks (risk 2), and weighs them", () => {
    const [ann, ben] = playerRatings(
      ["ann", "ben"],
      marks({
        donations: { ann: 30, ben: 10 },
        war: { ann: 10, ben: 10 },
        cwl: { ann: 40, ben: 10 },
        games: { ann: 10, ben: 30 },
        raids: { ann: 5, ben: 15 },
      }),
    );

    expect(ann!.shares).toEqual({ donations: 75, war: 50, cwl: 80, games: 25, raids: 25 });
    expect(ann!.rating).toBe(0.2 * 75 + 0.2 * 50 + 0.3 * 80 + 0.1 * 25 + 0.2 * 25);
    expect(ben!.shares).toEqual({ donations: 25, war: 50, cwl: 20, games: 75, raids: 75 });
    expect(ann!.rating + ben!.rating).toBeCloseTo(100);
  });

  it("works an example through: 10 marks of 2,000 is 0.50%, worth 0.10", () => {
    const rated = playerRatings(["a", "b"], marks({ donations: { a: 10, b: 1_990 } }));
    const a = rated.find((r) => r.playerId === "a")!;
    expect(a.shares.donations).toBe(0.5);
    expect(a.rating).toBe(0.1);
  });

  it("scores a section a player missed as 0, and leaves the weights where they are", () => {
    const [played, benched] = playerRatings(
      ["played", "benched"],
      marks({ cwl: { played: 10 }, war: { played: 10, benched: 10 } }),
    );
    expect(played!.rating).toBe(0.3 * 100 + 0.2 * 50);
    expect(benched!.shares.cwl).toBe(0);
    expect(benched!.rating).toBe(0.2 * 50);
  });

  it("gives everyone 0 in a section nobody has marks in (risk 4)", () => {
    const [only] = playerRatings(["only"], marks({ war: { only: 5 } }));
    expect(only!.shares.games).toBe(0);
    expect(only!.rating).toBe(20);
  });

  it("does not let a negative player change anybody else's share (risk 5)", () => {
    const rated = playerRatings(["a", "b", "c"], marks({ donations: { a: 30, b: 10, c: -20 } }));
    const shareOf = (id: string) => rated.find((r) => r.playerId === id)!.shares.donations;
    expect(shareOf("a")).toBe(75);
    expect(shareOf("b")).toBe(25);
    expect(shareOf("c")).toBe(-50);
  });

  it("stops a share at -100%", () => {
    const rated = playerRatings(["a", "b"], marks({ donations: { a: 1, b: -50 } }));
    expect(rated.find((r) => r.playerId === "b")!.shares.donations).toBe(-100);
  });

  it("counts nobody's marks but the players ranked", () => {
    const [ann] = playerRatings(["ann"], marks({ war: { ann: 10, departed: 90 } }));
    expect(ann!.shares.war).toBe(100);
  });

  it("ranks best first", () => {
    const rated = playerRatings(["low", "high"], marks({ war: { low: 1, high: 9 } }));
    expect(rated.map((r) => r.playerId)).toEqual(["high", "low"]);
  });
});
