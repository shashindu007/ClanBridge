// 052 — season donations across clan moves. Pure: no database.
//
// The ways this can be confidently wrong, none of which raises an error:
//
//   1. a clan move read as a new season, halving a member's month
//   2. donations given in a clan outside the family credited as if given here
//   3. the hour missed before leaving lost, when the player never left the family
//   4. a K computed from the wrong stay at a reset boundary, inventing donations
//   5. achievements that count different units trusted anyway

import { describe, expect, it } from "vitest";
import {
  chooseFormula,
  seasonDonations,
  seasonKey,
  seasonResets,
  seasonsFrom,
  type CounterReading,
  type DonationSegment,
  type Season,
} from "@/services/season-donations";

const X = "clan-x";
const Y = "clan-y";
const A = "player-a";

const SEPTEMBER: Season = { start: "2026-09-01T05:00:00.000Z", end: "2026-09-29T05:00:00.000Z" };

function stay(
  clanId: string,
  startedAt: string,
  endedAt: string,
  given: number,
  startReason: DonationSegment["startReason"] = "clan",
  playerId = A,
): DonationSegment {
  return { playerId, clanId, startedAt, endedAt, startReason, given, received: Math.floor(given / 2) };
}

/** A daily reading. `lifetime` is the achievement total, all in troops for simplicity. */
function reading(clanId: string, capturedAt: string, lifetime: number, clanDonations: number, playerId = A): CounterReading {
  return { playerId, clanId, capturedAt, troops: lifetime, spells: 0, sieges: 0, clanDonations };
}

describe("seasonDonations", () => {
  // The worked example: X, then a clan outside the family, then Y.
  //   Sept 1   joins the season in X, lifetime 120,000
  //   Sept 10  leaves X having given 900 (our last reading saw 880)
  //   ...      gives 600 in an outside clan
  //   Sept 18  joins Y, lifetime 121,500
  //   Sept 28  last reading in Y: 1,200
  const away: DonationSegment[] = [
    stay(X, "2026-09-01T05:17:00Z", "2026-09-10T14:17:00Z", 880, "drop"),
    stay(Y, "2026-09-18T10:17:00Z", "2026-09-28T22:17:00Z", 1200),
  ];
  const awayReadings = [
    reading(X, "2026-09-05T06:11:00Z", 120_300, 300),
    reading(X, "2026-09-08T06:11:00Z", 120_700, 700),
    reading(Y, "2026-09-20T06:11:00Z", 121_900, 400),
  ];

  it("keeps each clan's share when a member moves (risk 1)", () => {
    const [row] = seasonDonations(away, awayReadings, SEPTEMBER).rows;
    expect(row!.byClan).toEqual([
      { clanId: X, given: 880, received: 440 },
      { clanId: Y, given: 1200, received: 600 },
    ]);
  });

  it("reports what was given away from the family as `other`, not as ours (risk 2)", () => {
    const [row] = seasonDonations(away, awayReadings, SEPTEMBER).rows;
    // 121,500 - 120,000 - 880: the 600 outside plus the 20 missed before
    // leaving, which cannot be told apart once the player went elsewhere.
    expect(row!.other).toBe(620);
    // And the total is exact: 122,700 lifetime at the end minus 120,000.
    expect(row!.total).toBe(2700);
  });

  it("credits the missed hour to the clan when the player never left the family (risk 3)", () => {
    const moved = [
      stay(X, "2026-09-01T05:17:00Z", "2026-09-10T14:17:00Z", 880, "drop"),
      stay(Y, "2026-09-10T15:17:00Z", "2026-09-28T22:17:00Z", 1200),
    ];
    const readings = [
      reading(X, "2026-09-05T06:11:00Z", 120_300, 300),
      // Gave 20 more in X, left, joined Y: Y's counter starts from zero.
      reading(Y, "2026-09-20T06:11:00Z", 120_900 + 400, 400),
    ];
    const [row] = seasonDonations(moved, readings, SEPTEMBER).rows;
    expect(row!.byClan.find((s) => s.clanId === X)!.given).toBe(900);
    expect(row!.other).toBe(0);
    expect(row!.total).toBe(2100);
  });

  it("finds last season's missed tail through this season's first stay", () => {
    const stays = [
      stay(X, "2026-09-01T05:17:00Z", "2026-09-29T04:17:00Z", 1000, "drop"),
      // The reset at 05:00: same clan, counter back to zero, no time away.
      stay(X, "2026-09-29T05:17:00Z", "2026-10-03T12:17:00Z", 50, "drop"),
    ];
    const readings = [
      reading(X, "2026-09-20T06:11:00Z", 100_600, 600),
      // Gave 30 in the last 43 minutes of September.
      reading(X, "2026-10-02T06:11:00Z", 101_030 + 40, 40),
    ];
    const [row] = seasonDonations(stays, readings, SEPTEMBER).rows;
    expect(row!.byClan).toEqual([{ clanId: X, given: 1030, received: 500 }]);
  });

  it("says nothing about `other` without a usable reading, rather than zero", () => {
    const [row] = seasonDonations(away, [], SEPTEMBER).rows;
    expect(row!.other).toBeNull();
    expect(row!.total).toBe(2080);
  });

  it("does not trust a stay whose K moves (risk 5)", () => {
    const readings = [
      reading(X, "2026-09-05T06:11:00Z", 120_300, 300),
      reading(X, "2026-09-08T06:11:00Z", 120_900, 700), // K 120,000 then 120,200
      reading(Y, "2026-09-20T06:11:00Z", 121_900, 400),
    ];
    const [row] = seasonDonations(away, readings, SEPTEMBER).rows;
    // X has no trusted K, so there is no pair to difference.
    expect(row!.other).toBe(0);
    expect(row!.total).toBe(2080);
  });

  it("skips a reading that could belong to either side of a reset (risk 4)", () => {
    const stays = [
      stay(X, "2026-09-01T05:17:00Z", "2026-09-29T04:17:00Z", 1000, "drop"),
      stay(X, "2026-09-29T05:17:00Z", "2026-10-03T12:17:00Z", 50, "drop"),
    ];
    // Taken at 04:50, within the slack of BOTH stays. Its counter is from the
    // old one; matched to the new one, it would invent ~1,000 donations.
    const readings = [reading(X, "2026-09-29T04:50:00Z", 101_000, 1000)];
    const [row] = seasonDonations(stays, readings, SEPTEMBER).rows;
    expect(row!.other).toBeNull();
    expect(row!.total).toBe(1000);
  });

  it("leaves out an absence that spans the season boundary", () => {
    const stays = [
      stay(X, "2026-09-01T05:17:00Z", "2026-09-20T10:17:00Z", 500, "drop"),
      stay(Y, "2026-10-05T10:17:00Z", "2026-10-10T10:17:00Z", 100),
    ];
    const readings = [
      reading(X, "2026-09-10T06:11:00Z", 10_200, 200),
      reading(Y, "2026-10-07T06:11:00Z", 11_000 + 60, 60),
    ];
    const [row] = seasonDonations(stays, readings, SEPTEMBER).rows;
    // 500 of the 1,000 between the two stays happened somewhere unknown, on an
    // unknown side of the boundary. Credited to neither month.
    expect(row!.other).toBe(0);
    expect(row!.total).toBe(500);
  });

  it("lists only players with a stay ending in the season, most given first", () => {
    const stays = [
      stay(X, "2026-09-02T05:17:00Z", "2026-09-20T10:17:00Z", 300, "first", "b"),
      stay(X, "2026-09-02T05:17:00Z", "2026-09-20T10:17:00Z", 900, "first", "c"),
      stay(X, "2026-10-02T05:17:00Z", "2026-10-20T10:17:00Z", 999, "first", "d"),
    ];
    const { rows } = seasonDonations(stays, [], SEPTEMBER);
    expect(rows.map((r) => r.playerId)).toEqual(["c", "b"]);
  });
});

describe("chooseFormula", () => {
  it("picks the sum that keeps K constant", () => {
    const stays = [stay(X, "2026-09-01T05:17:00Z", "2026-09-28T22:17:00Z", 500, "drop")];
    // The clan counter moves with troops + spells; sieges move on their own.
    const readings: CounterReading[] = [
      { playerId: A, clanId: X, capturedAt: "2026-09-05T06:11:00Z", troops: 1000, spells: 100, sieges: 10, clanDonations: 100 },
      { playerId: A, clanId: X, capturedAt: "2026-09-08T06:11:00Z", troops: 1150, spells: 150, sieges: 14, clanDonations: 300 },
    ];
    expect(chooseFormula(stays, readings)).toEqual({ formula: "troops+spells", checked: 1, consistent: 1 });
  });
});

describe("seasonResets", () => {
  it("finds the hour most of the family dropped together, and ignores one rejoin", () => {
    const stays: DonationSegment[] = [];
    for (let p = 0; p < 20; p += 1) {
      stays.push(stay(X, "2026-09-29T05:17:00Z", "2026-10-02T05:17:00Z", 10, "drop", `p${p}`));
    }
    // One player leaving and rejoining on the 15th.
    stays.push(stay(X, "2026-09-15T09:17:00Z", "2026-09-20T09:17:00Z", 10, "drop", "p0"));

    expect(seasonResets(stays)).toEqual(["2026-09-29T05:00:00.000Z"]);
  });
});

describe("seasonsFrom", () => {
  it("offers the running season, each complete one, then the partial one before", () => {
    expect(seasonsFrom(["2026-08-25T05:00:00.000Z", "2026-09-29T05:00:00.000Z"])).toEqual([
      { start: "2026-09-29T05:00:00.000Z", end: null },
      { start: "2026-08-25T05:00:00.000Z", end: "2026-09-29T05:00:00.000Z" },
      { start: null, end: "2026-08-25T05:00:00.000Z" },
    ]);
  });

  it("gives every season a distinct key for its link", () => {
    const keys = seasonsFrom(["2026-08-25T05:00:00.000Z", "2026-09-29T05:00:00.000Z"]).map(seasonKey);
    expect(new Set(keys).size).toBe(3);
  });

  it("offers everything as one stretch until a reset has been seen", () => {
    expect(seasonsFrom([])).toEqual([{ start: null, end: null }]);
  });
});
