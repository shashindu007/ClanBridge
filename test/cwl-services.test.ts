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
import {
  missedAttacks,
  seasonContribution,
  seasonSpan,
  seasonTotals,
  warRecord,
} from "@/services/cwl";
import { ago, freshness, STALE_AFTER_MS } from "@/services/freshness";

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
    opponentBadgeUrl: null,
    teamSize: 15,
    state: "warEnded",
    ourStars: 30,
    theirStars: 20,
    ourDestruction: 90,
    theirDestruction: 80,
    result: "win",
    startTime: null,
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

  // ─────────────────────────────────────────────────────────────────────────
  // The drift this file exists to catch, and did not.
  //
  // Twice now a threshold here has fallen out of step with the schedule it
  // describes. T6.2 moved the war sync from 15-minutely to hourly and left
  // `war: 45 minutes` behind, so it read stale for the last quarter of every
  // hour. `clan-games` had no entry at all and would have fallen through to
  // the 3-hour default against a daily job — stale 21 hours out of 24.
  //
  // Both are the same failure: an indicator that cries wolf on a schedule is
  // one nobody reads on the day it means something. These two tests are the
  // tripwire, tied to health.ts's WATCHED list so a new scheduled job cannot
  // be added without a threshold.
  // ─────────────────────────────────────────────────────────────────────────
  describe("every watched job has a threshold matched to its schedule", () => {
    // Mirrors scripts/sync/health.ts's WATCHED. Not imported: that module
    // builds an admin Supabase client at import time and needs the service key.
    const WATCHED = ["clans", "cwl", "war", "raids", "clan-games", "players"] as const;

    it.each(WATCHED)("%s has an explicit entry, not the default", (jobType) => {
      expect(STALE_AFTER_MS[jobType]).toBeDefined();
    });

    // A job may be late by up to its own interval plus GitHub's habit of
    // delaying scheduled runs by twenty minutes. A threshold at or below the
    // interval guarantees a permanent amber.
    it.each([
      ["clans", 60],
      ["cwl", 120],
      ["war", 60],
      ["raids", 24 * 60],
      ["clan-games", 24 * 60],
      ["players", 24 * 60],
    ])("%s allows more than its %i-minute interval", (jobType, intervalMinutes) => {
      expect(STALE_AFTER_MS[jobType]!).toBeGreaterThan(intervalMinutes * 60 * 1000);
    });

    it("does not mark a daily job stale the morning after it ran", () => {
      const ranAt = "2026-07-31T05:41:00Z"; // sync-raids.yml's cron
      const nextMorning = new Date("2026-08-01T11:00:00Z"); // ~29h later
      for (const jobType of ["raids", "clan-games", "players"] as const) {
        expect(
          freshness(run({ jobType, finishedAt: ranAt }), nextMorning).level,
        ).toBe("fresh");
      }
    });
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


// ── T12.2 — when a season ran ────────────────────────────────────────────────
//
// The times were in cwl_wars from the first CWL sync and no query ever selected
// them, so the season page could not say when a day had run while the war board
// counted a regular war down to the minute. seasonSpan derives the season's
// extent from its days, and the `state` it returns is what decides whether the
// caller words the second date as a deadline or as history — getting that the
// wrong way round is how somebody reads "ends Friday" about last month.

describe("seasonSpan", () => {
  it("returns null when no day has a start time", () => {
    // A season row whose wars were never captured. The page has its own empty
    // state for this and must not print a span of nothing.
    expect(seasonSpan([])).toBeNull();
    expect(seasonSpan([war({ startTime: null, endTime: null })])).toBeNull();
  });

  it("spans the earliest start to the latest end", () => {
    const wars = [
      war({ id: "d2", startTime: "2026-09-04T06:00:00Z", endTime: "2026-09-05T06:00:00Z" }),
      war({ id: "d1", startTime: "2026-09-03T06:00:00Z", endTime: "2026-09-04T06:00:00Z" }),
      war({ id: "d3", startTime: "2026-09-05T06:00:00Z", endTime: "2026-09-06T06:00:00Z" }),
    ];
    expect(seasonSpan(wars)).toEqual({
      from: "2026-09-03T06:00:00Z",
      to: "2026-09-06T06:00:00Z",
      state: "ended",
    });
  });

  it("does not assume the days arrive in order", () => {
    // warsInSeason orders by day_number, which is nullable — so a season with a
    // day the API never numbered can arrive in any order at all.
    const wars = [
      war({ id: "late", dayNumber: null, startTime: "2026-09-07T06:00:00Z", endTime: "2026-09-08T06:00:00Z" }),
      war({ id: "early", dayNumber: 1, startTime: "2026-09-01T06:00:00Z", endTime: "2026-09-02T06:00:00Z" }),
    ];
    const span = seasonSpan(wars)!;
    expect(span.from).toBe("2026-09-01T06:00:00Z");
    expect(span.to).toBe("2026-09-08T06:00:00Z");
  });

  it("is running while any day has not ended", () => {
    const wars = [
      war({ id: "d1", state: "warEnded", startTime: "2026-09-03T06:00:00Z", endTime: "2026-09-04T06:00:00Z" }),
      war({ id: "d2", state: "inWar", startTime: "2026-09-04T06:00:00Z", endTime: "2026-09-05T06:00:00Z" }),
    ];
    expect(seasonSpan(wars)!.state).toBe("running");
  });

  it("counts a day still in preparation as running", () => {
    // Nobody has attacked in it yet, so the season is emphatically not over.
    const wars = [
      war({ id: "d1", state: "warEnded", startTime: "2026-09-03T06:00:00Z", endTime: "2026-09-04T06:00:00Z" }),
      war({ id: "d2", state: "preparation", startTime: "2026-09-04T06:00:00Z", endTime: null }),
    ];
    expect(seasonSpan(wars)!.state).toBe("running");
  });

  it("has a start and no end while the first day is still open", () => {
    const span = seasonSpan([
      war({ state: "inWar", startTime: "2026-09-03T06:00:00Z", endTime: null }),
    ])!;
    expect(span.from).toBe("2026-09-03T06:00:00Z");
    expect(span.to).toBeNull();
    expect(span.state).toBe("running");
  });

  it("ignores a day with no start when others have one", () => {
    const span = seasonSpan([
      war({ id: "d1", startTime: null, endTime: null }),
      war({ id: "d2", startTime: "2026-09-03T06:00:00Z", endTime: "2026-09-04T06:00:00Z" }),
    ])!;
    expect(span.from).toBe("2026-09-03T06:00:00Z");
  });
});
