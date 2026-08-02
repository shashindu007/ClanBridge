// T4.3/T4.8 — the derived CWL values, and the freshness indicator.
//
// Pure functions, so these are fast and exact. They matter because the two most
// consequential numbers on the CWL pages are both derivations rather than
// columns: a missed attack is the ABSENCE of a row (002_cwl.sql:76-78), and
// "updated N minutes ago" is a subtraction whose thresholds decide whether
// anyone ever notices a dead sync job.

import { describe, expect, it } from "vitest";
import type { CwlAttack, CwlRosterEntry, CwlWar } from "@/repositories/cwl";
import type { SyncRun } from "@/repositories/sync-log";
import { missedAttacks, seasonContribution, seasonTotals, warRecord } from "@/services/cwl";
import { ago, freshness } from "@/services/freshness";

function member(n: number): CwlRosterEntry {
  return {
    playerId: `p${n}`,
    tag: `#PLAYER${n}`,
    name: `Player ${n}`,
    mapPosition: n,
    thLevel: 15,
  };
}

function attack(playerId: string, stars: number, destruction = 100): CwlAttack {
  return {
    playerId,
    attackOrder: 1,
    stars,
    destruction,
    defenderTag: "#DEF",
    defenderPosition: 1,
  };
}

function war(overrides: Partial<CwlWar> = {}): CwlWar {
  return {
    id: "w1",
    warTag: "#W1",
    dayNumber: 1,
    opponentName: "Them",
    opponentTag: "#T1",
    teamSize: 15,
    state: "warEnded",
    ourStars: 30,
    theirStars: 20,
    ourDestruction: 90,
    theirDestruction: 80,
    result: "win",
    endTime: null,
    ...overrides,
  };
}

describe("warRecord / missedAttacks — a miss is an absent row, not a zero", () => {
  const roster = [member(1), member(2), member(3)];
  const attacks = [attack("p1", 3), attack("p3", 2, 55)];

  it("keeps a rostered player who never attacked", () => {
    const record = warRecord(roster, attacks);
    expect(record).toHaveLength(3);
    expect(record.find((m) => m.playerId === "p2")?.missed).toBe(true);
  });

  it("does not flag a player who attacked", () => {
    const record = warRecord(roster, attacks);
    expect(record.find((m) => m.playerId === "p1")?.missed).toBe(false);
    expect(record.find((m) => m.playerId === "p1")?.stars).toBe(3);
  });

  // Driving from the attacks instead of the roster is the obvious shortcut, and
  // it makes exactly the people the leader is looking for invisible.
  it("returns only the non-attackers from missedAttacks", () => {
    expect(missedAttacks(roster, attacks).map((m) => m.playerId)).toEqual(["p2"]);
  });

  it("treats a genuine zero-star attack as an attack, not a miss", () => {
    const record = warRecord([member(1)], [attack("p1", 0, 12)]);
    expect(record[0]!.missed).toBe(false);
    expect(record[0]!.stars).toBe(0);
  });

  it("ignores an attack from someone not on the roster", () => {
    const record = warRecord([member(1)], [attack("p1", 3), attack("p99", 3)]);
    expect(record).toHaveLength(1);
  });

  it("reports everyone missing when nobody attacked", () => {
    expect(missedAttacks(roster, [])).toHaveLength(3);
  });
});

describe("seasonTotals", () => {
  it("counts wins, losses and ties", () => {
    const totals = seasonTotals([
      war({ result: "win", ourStars: 30, theirStars: 20 }),
      war({ result: "lose", ourStars: 10, theirStars: 25 }),
      war({ result: "tie", ourStars: 15, theirStars: 15 }),
    ]);
    expect(totals).toMatchObject({ warsPlayed: 3, wins: 1, losses: 1, ties: 1 });
    expect(totals.stars).toBe(55);
    expect(totals.starsAgainst).toBe(60);
  });

  // A war in preparation has not happened. Scoring it as anything is a lie.
  it("ignores a war with no result yet", () => {
    const totals = seasonTotals([war({ result: null, state: "preparation" })]);
    expect(totals.warsPlayed).toBe(0);
    expect(totals.stars).toBe(0);
  });
});

describe("seasonContribution", () => {
  it("accumulates across wars and ranks by stars then misses", () => {
    const ranked = seasonContribution([
      { roster: [member(1), member(2)], attacks: [attack("p1", 3)] },
      { roster: [member(1), member(2)], attacks: [attack("p1", 2), attack("p2", 3)] },
    ]);

    expect(ranked[0]).toMatchObject({ playerId: "p1", warsRostered: 2, attacksUsed: 2, stars: 5, missed: 0 });
    expect(ranked[1]).toMatchObject({ playerId: "p2", warsRostered: 2, attacksUsed: 1, stars: 3, missed: 1 });
  });
});

describe("freshness — T4.8", () => {
  const now = new Date("2026-08-01T12:00:00Z");
  const run = (over: Partial<SyncRun> = {}): SyncRun => ({
    jobType: "cwl",
    status: "success",
    startedAt: "2026-08-01T11:00:00Z",
    finishedAt: "2026-08-01T11:00:00Z",
    skipReason: null,
    error: null,
    recordsWritten: 9,
    ...over,
  });

  it("is fresh within the job's window", () => {
    expect(freshness(run(), now)).toMatchObject({ level: "fresh", minutesAgo: 60 });
  });

  it("is stale past it", () => {
    // cwl allows 3h; this is 4.
    expect(freshness(run({ finishedAt: "2026-08-01T08:00:00Z" }), now).level).toBe("stale");
  });

  it("reports a failure as failed regardless of age", () => {
    expect(freshness(run({ status: "failed" }), now).level).toBe("failed");
  });

  // R10 — "not in CWL" is the correct outcome for three weeks of every month.
  // An indicator that is red most of the year is one nobody reads in the week
  // that matters.
  it("treats a skipped run as fresh and surfaces the reason", () => {
    const result = freshness(run({ status: "skipped", skipReason: "noCwlGroup" }), now);
    expect(result.level).toBe("fresh");
    expect(result.skipReason).toBe("noCwlGroup");
  });

  it("distinguishes never-run from stale", () => {
    expect(freshness(null, now).level).toBe("never");
    expect(freshness(run({ finishedAt: null }), now).level).toBe("never");
  });

  it.each([
    [0, "just now"],
    [1, "1 minute ago"],
    [30, "30 minutes ago"],
    [60, "1 hour ago"],
    [150, "2 hours ago"],
    [1440, "1 day ago"],
    [4320, "3 days ago"],
  ])("phrases %i minutes as %s", (minutes, expected) => {
    expect(ago(minutes)).toBe(expected);
  });
});
