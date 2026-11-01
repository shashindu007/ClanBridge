import { describe, expect, it } from "vitest";
import type { Placement, RatingMonth } from "@/repositories/player-ratings";
import { rankHistory, standingOf } from "./player-rank";

const NONE = { donations: 0, war: 0, cwl: 0, games: 0, raids: 0 };
const SOME = { ...NONE, war: 5 };

function placed(over: Partial<Placement> = {}): Placement {
  return {
    familyRank: 12,
    tied: false,
    clanRank: 3,
    clanSize: 45,
    clanTag: "#2PP0JCCL",
    clanName: "Dark Hell",
    marks: SOME,
    shares: { ...NONE, war: 2.5 },
    rating: 0.5,
    computedAt: "2026-10-31T06:00:00Z",
    ...over,
  };
}

function month(name: string, place: Placement | null = placed(), ratedPlayers = 100): RatingMonth {
  return { playerId: "p", month: name, ratedPlayers, familySize: 195, placed: place };
}

const MID_NOVEMBER = new Date("2026-11-20T12:00:00Z");
const NOVEMBER_2ND = new Date("2026-11-02T12:00:00Z");

describe("standingOf", () => {
  it("tells a failed read apart from having no rank", () => {
    expect(standingOf(null, MID_NOVEMBER)).toEqual({ kind: "failed" });
    expect(standingOf([], MID_NOVEMBER)).toEqual({ kind: "not-ranked" });
  });

  it("is not ranked when absent from every month", () => {
    expect(standingOf([month("2026-11", null)], MID_NOVEMBER)).toEqual({ kind: "not-ranked" });
  });

  it("ignores a month nobody has marks in", () => {
    const standing = standingOf(
      [month("2026-11", placed({ marks: NONE }), 0), month("2026-10")],
      MID_NOVEMBER,
    );
    expect(standing).toMatchObject({ kind: "ranked", month: "2026-10" });
  });

  it("leads with the running month once the player has marks in it", () => {
    const standing = standingOf([month("2026-11"), month("2026-10")], MID_NOVEMBER);
    expect(standing).toMatchObject({ kind: "ranked", month: "2026-11", open: true });
  });

  it("falls back to the last month with marks while the running one has none of theirs", () => {
    const standing = standingOf(
      [month("2026-11", placed({ marks: NONE })), month("2026-10", placed({ familyRank: 7 }))],
      MID_NOVEMBER,
    );
    expect(standing).toMatchObject({ kind: "ranked", month: "2026-10", familyRank: 7 });
  });

  it("says no marks when no month has any", () => {
    expect(standingOf([month("2026-11", placed({ marks: NONE }))], MID_NOVEMBER)).toEqual({
      kind: "no-marks",
      month: "2026-11",
      open: true,
    });
  });

  it("never skips a closed month: no marks is the truth about it", () => {
    const standing = standingOf(
      [month("2026-10", placed({ marks: NONE })), month("2026-09")],
      MID_NOVEMBER,
    );
    expect(standing).toEqual({ kind: "no-marks", month: "2026-10", open: false });
  });

  it("uses marks, not the rating: a negative rating is still a rank", () => {
    const standing = standingOf(
      [month("2026-10", placed({ rating: -1.2, marks: { ...NONE, donations: -4 } }))],
      MID_NOVEMBER,
    );
    expect(standing).toMatchObject({ kind: "ranked", rating: -1.2 });
  });

  it("keeps last month open until the 10th, and final after", () => {
    const history = [month("2026-10")];
    expect(standingOf(history, new Date("2026-11-10T12:00:00Z"))).toMatchObject({ open: true });
    expect(standingOf(history, new Date("2026-11-11T12:00:00Z"))).toMatchObject({ open: false });
  });

  it("words the movement against the month before", () => {
    const standing = (now: number, before: number) =>
      standingOf(
        [month("2026-10", placed({ familyRank: now })), month("2026-09", placed({ familyRank: before }))],
        MID_NOVEMBER,
      );
    expect(standing(12, 15)).toMatchObject({ movement: "Up 3 from September" });
    expect(standing(15, 12)).toMatchObject({ movement: "Down 3 from September" });
    expect(standing(12, 12)).toMatchObject({ movement: "Same as September" });
  });

  it("hides movement while the month can still change", () => {
    expect(standingOf([month("2026-11"), month("2026-10")], MID_NOVEMBER)).toMatchObject({ movement: null });
  });

  it("does not compare across a gap, or against a month with no marks", () => {
    expect(standingOf([month("2026-10"), month("2026-08")], MID_NOVEMBER)).toMatchObject({ movement: null });
    expect(
      standingOf([month("2026-10"), month("2026-09", placed({ marks: NONE }))], MID_NOVEMBER),
    ).toMatchObject({ movement: null });
  });

  it("wraps the year when comparing", () => {
    const standing = standingOf(
      [month("2027-01", placed({ familyRank: 5 })), month("2026-12", placed({ familyRank: 6 }))],
      new Date("2027-02-20T12:00:00Z"),
    );
    expect(standing).toMatchObject({ movement: "Up 1 from December" });
  });

  it("names a rank from an older month rather than passing it off as current", () => {
    const standing = standingOf([month("2026-11", null), month("2026-10")], NOVEMBER_2ND);
    expect(standing).toMatchObject({ kind: "ranked", month: "2026-10", open: true });
  });
});

describe("rankHistory", () => {
  it("lists only months with a place and marks, newest first as given", () => {
    const rows = rankHistory(
      [month("2026-11", null), month("2026-10"), month("2026-09", placed({ marks: NONE }))],
      MID_NOVEMBER,
    );
    expect(rows.map((r) => r.month)).toEqual(["2026-10"]);
  });

  it("is empty after a failed read", () => {
    expect(rankHistory(null, MID_NOVEMBER)).toEqual([]);
  });
});
