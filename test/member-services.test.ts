// T3B.3 — the derived member values.
//
// These matter because both headline numbers in the directory are derivations
// over a counter that resets every month, and both have an obvious wrong
// implementation that looks right on a single month of data:
//
//   - a season total is the LAST reading before the reset, not the sum of the
//     deltas we happened to observe;
//   - a reset is not activity, even though every counter changes at one.
//
// Neither shows up until a month boundary passes, by which point the numbers
// have been on a leader's screen for weeks.

import { describe, expect, it } from "vitest";
import type { SnapshotPoint } from "@/repositories/members";
import {
  donationRatio,
  donationSeasons,
  lastActivityAt,
  LOW_RATIO_THRESHOLD,
  memberActivity,
  needsAttention,
  QUIET_DAYS,
  type AttentionInput,
} from "@/services/members";

/** Snapshots are hourly, so an index is an hour. */
function at(hour: number): string {
  return new Date(Date.UTC(2026, 6, 1, hour)).toISOString();
}

function point(
  hour: number,
  donations: number | null,
  received: number | null,
  trophies: number | null = 5000,
): SnapshotPoint {
  return {
    playerId: "p1",
    capturedAt: at(hour),
    donations,
    donationsReceived: received,
    trophies,
    thLevel: 15,
    role: "member",
  };
}

describe("donationRatio", () => {
  it("divides given by received", () => {
    expect(donationRatio(500, 250)).toBe(2);
  });

  it("is null when nothing was received, rather than Infinity", () => {
    // Infinity would sort this member above everyone who actually donated more,
    // on the strength of having received nothing.
    expect(donationRatio(500, 0)).toBeNull();
  });

  it("is null when either side was never recorded", () => {
    expect(donationRatio(null, 250)).toBeNull();
    expect(donationRatio(500, null)).toBeNull();
  });

  it("treats zero given as a real ratio, not a missing one", () => {
    expect(donationRatio(0, 400)).toBe(0);
  });
});

describe("donationSeasons — the counter is cumulative, so a season total is its last reading", () => {
  it("returns the newest value for a single ongoing season", () => {
    const seasons = donationSeasons([
      point(0, 100, 50),
      point(1, 300, 90),
      point(2, 450, 120),
    ]);

    expect(seasons).toHaveLength(1);
    expect(seasons[0]!.given).toBe(450);
    expect(seasons[0]!.received).toBe(120);
    expect(seasons[0]!.complete).toBe(false);
  });

  it("splits at the reset and takes the value BEFORE it as the season total", () => {
    const seasons = donationSeasons([
      point(0, 400, 100),
      point(1, 900, 300),
      point(2, 20, 5), // reset: a new month began between hour 1 and hour 2
      point(3, 150, 40),
    ]);

    expect(seasons).toHaveLength(2);
    expect(seasons[0]!.given).toBe(900);
    expect(seasons[0]!.received).toBe(300);
    expect(seasons[0]!.complete).toBe(true);
    expect(seasons[1]!.given).toBe(150);
    expect(seasons[1]!.complete).toBe(false);
  });

  it("does not undercount a season we started observing late", () => {
    // THE BUG THIS FILE EXISTS FOR. Our first snapshot of the month already
    // reads 800 — the player donated that before the sync first saw them.
    // Summing observed deltas would report 1200 - 800 = 400. The real total is
    // 1200, because the game has been counting since the reset regardless of
    // when we started looking.
    const seasons = donationSeasons([
      point(0, 800, 200),
      point(1, 1000, 260),
      point(2, 1200, 300),
      point(3, 30, 10), // reset
    ]);

    expect(seasons[0]!.given).toBe(1200);
    expect(seasons[0]!.given).not.toBe(400);
  });

  it("survives a gap in the snapshots without inventing a reset", () => {
    // The sync was down between hour 1 and hour 9. The counter kept climbing,
    // so there is no drop and therefore no reset — one season, not two.
    const seasons = donationSeasons([point(0, 100, 20), point(1, 200, 40), point(9, 700, 150)]);

    expect(seasons).toHaveLength(1);
    expect(seasons[0]!.given).toBe(700);
  });

  it("detects a reset from received alone", () => {
    // Contrived but possible: a player who donates nothing all month still has
    // their received counter zeroed, and that is the only visible signal.
    const seasons = donationSeasons([point(0, 0, 500), point(1, 0, 12)]);
    expect(seasons).toHaveLength(2);
    expect(seasons[0]!.received).toBe(500);
  });

  it("ignores points with no reading rather than reading them as zero", () => {
    // A null treated as 0 would look like a reset, splitting one season in two
    // and reporting the first half as a completed month.
    const seasons = donationSeasons([point(0, 100, 20), point(1, null, null), point(2, 300, 60)]);

    expect(seasons).toHaveLength(1);
    expect(seasons[0]!.given).toBe(300);
  });

  it("returns nothing for a player who has never been recorded", () => {
    expect(donationSeasons([])).toEqual([]);
    expect(donationSeasons([point(0, null, null)])).toEqual([]);
  });

  it("handles a single snapshot as one ongoing season", () => {
    const seasons = donationSeasons([point(0, 75, 25)]);
    expect(seasons).toHaveLength(1);
    expect(seasons[0]!.given).toBe(75);
    expect(seasons[0]!.complete).toBe(false);
  });
});

describe("lastActivityAt", () => {
  it("is the last hour a counter rose", () => {
    const points = [point(0, 100, 20), point(1, 150, 20), point(2, 150, 20)];
    expect(lastActivityAt(points)).toBe(at(1));
  });

  it("counts trophies moving in either direction", () => {
    // Losing trophies is still playing.
    const points = [point(0, 100, 20, 5000), point(1, 100, 20, 4900)];
    expect(lastActivityAt(points)).toBe(at(1));
  });

  it("counts donations received, not just given", () => {
    const points = [point(0, 100, 20), point(1, 100, 60)];
    expect(lastActivityAt(points)).toBe(at(1));
  });

  it("does NOT count the monthly reset as activity", () => {
    // Every member's counters change at a reset whether they logged in or not.
    // Counting it would show the entire clan as active on the 1st of the month.
    const points = [point(0, 900, 300, 5000), point(1, 0, 0, 5000)];
    expect(lastActivityAt(points)).toBeNull();
  });

  it("is null for a player who has done nothing since we started watching", () => {
    const points = [point(0, 100, 20), point(1, 100, 20), point(2, 100, 20)];
    expect(lastActivityAt(points)).toBeNull();
  });

  it("is null with fewer than two snapshots — one proves existence, not activity", () => {
    expect(lastActivityAt([])).toBeNull();
    expect(lastActivityAt([point(0, 100, 20)])).toBeNull();
  });
});

describe("memberActivity", () => {
  it("reads this season straight off the newest snapshot", () => {
    const activity = memberActivity("p1", point(5, 600, 200), []);
    expect(activity.donations).toBe(600);
    expect(activity.ratio).toBe(3);
    expect(activity.lowRatio).toBe(false);
  });

  it("flags a member below the threshold", () => {
    const activity = memberActivity("p1", point(5, 100, 1000), []);
    expect(activity.ratio).toBe(0.1);
    expect(activity.lowRatio).toBe(true);
    expect(activity.ratio!).toBeLessThan(LOW_RATIO_THRESHOLD);
  });

  it("does not flag a member whose ratio is unknown", () => {
    // Unknown is not low. Flagging it would put every never-synced member on the
    // leader's needs-attention list on day one.
    expect(memberActivity("p1", point(5, 100, 0), []).lowRatio).toBe(false);
    expect(memberActivity("p1", undefined, []).lowRatio).toBe(false);
  });

  it("copes with a player who has no snapshot at all", () => {
    const activity = memberActivity("p1", undefined, []);
    expect(activity.donations).toBeNull();
    expect(activity.ratio).toBeNull();
    expect(activity.lastActivityAt).toBeNull();
  });
});

describe("needsAttention — advisory, and it must show its working", () => {
  const NOW = new Date("2026-07-20T00:00:00.000Z");

  function input(overrides: Partial<AttentionInput> = {}): AttentionInput {
    return {
      playerId: "p1",
      name: "Player 1",
      activity: memberActivity("p1", point(0, 800, 400), [point(0, 800, 400)]),
      warsRostered: 0,
      attacksUsed: 0,
      ...overrides,
    };
  }

  it("says nothing about an active member with a healthy ratio", () => {
    expect(needsAttention([input()], NOW)).toEqual([]);
  });

  it("flags a long silence, and names the number of days", () => {
    // Last activity is 1 July 01:00; NOW is 20 July 00:00. That is 18 days and
    // 23 hours, and the count floors rather than rounds — a member is not "19
    // days quiet" until the 19th day has actually elapsed.
    const quiet = [point(0, 100, 50), point(1, 200, 60)];
    const flags = needsAttention(
      [input({ activity: memberActivity("p1", point(1, 200, 60), quiet) })],
      NOW,
    );

    expect(flags).toHaveLength(1);
    expect(flags[0]!.reasons[0]).toContain("18 days");
  });

  it("stays silent just inside the threshold", () => {
    const recent = [
      point(0, 100, 50),
      // Activity QUIET_DAYS - 1 ago, so it must not trip.
      {
        ...point(1, 200, 60),
        capturedAt: new Date(
          NOW.getTime() - (QUIET_DAYS - 1) * 86_400_000,
        ).toISOString(),
      },
    ];
    const flags = needsAttention(
      [input({ activity: memberActivity("p1", recent[1]!, recent) })],
      NOW,
    );
    expect(flags).toEqual([]);
  });

  it("does NOT flag a member with no snapshot at all", () => {
    // Unknown is not inactive. Flagging it would put the whole clan on the list
    // on day one, before the sync has reached anybody.
    const flags = needsAttention(
      [input({ activity: memberActivity("p1", undefined, []) })],
      NOW,
    );
    expect(flags).toEqual([]);
  });

  it("flags a low ratio and quotes the raw numbers behind it", () => {
    const flags = needsAttention(
      [input({ activity: memberActivity("p1", point(0, 50, 900), [point(0, 50, 900)]) })],
      NOW,
    );
    expect(flags[0]!.reasons.join(" ")).toContain("0.06");
    expect(flags[0]!.reasons.join(" ")).toContain("900");
  });

  it("flags a player who was rostered for CWL and attacked in none", () => {
    const flags = needsAttention([input({ warsRostered: 5, attacksUsed: 0 })], NOW);
    expect(flags[0]!.reasons[0]).toContain("5 CWL wars");
  });

  it("does not treat zero-of-zero as a missed war", () => {
    // The clan did not play CWL, or this member was not picked. Neither is
    // something the member did.
    expect(needsAttention([input({ warsRostered: 0, attacksUsed: 0 })], NOW)).toEqual([]);
  });

  it("does not flag a member who used every attack they were given", () => {
    expect(needsAttention([input({ warsRostered: 7, attacksUsed: 7 })], NOW)).toEqual([]);
  });

  it("ranks by how many reasons there are, then by name for stability", () => {
    const quiet = [point(0, 10, 900), point(1, 12, 900)];
    const flags = needsAttention(
      [
        input({ playerId: "p2", name: "Beta", warsRostered: 4, attacksUsed: 0 }),
        input({
          playerId: "p1",
          name: "Alpha",
          warsRostered: 4,
          attacksUsed: 0,
          activity: memberActivity("p1", point(1, 12, 900), quiet),
        }),
      ],
      NOW,
    );

    // Alpha has three reasons (quiet, low ratio, no attacks); Beta has one.
    expect(flags[0]!.name).toBe("Alpha");
    expect(flags[0]!.score).toBe(3);
    expect(flags[1]!.score).toBe(1);
  });
});
