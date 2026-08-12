// T9.1 — the cross-clan participation report. Objective O3.
//
// Three things here are worth more than the rest:
//
//   1. MEDIAN, NOT MEAN. One member donating 40,000 drags a clan's mean ratio
//      far above what a typical member there is doing, and the leader reads
//      that as "this clan is fine" while most of it donates nothing.
//
//   2. FLAGGED MEMBERS SORT FIRST. The page exists to answer "who has stopped
//      turning up", so the answer has to be at the top rather than behind a
//      sort the leader has to know to apply.
//
//   3. UNKNOWN IS NOT ZERO. A member the sync has not reached has no reading,
//      and reporting that as 0 is indistinguishable from genuinely having
//      donated nothing — which is the difference between "new" and "inactive".

import { describe, expect, it } from "vitest";
import { clanSummaries, participation, type ClanInput } from "@/services/cross-clan";
import type { MemberRow, SnapshotPoint } from "@/repositories/members";

const NOW = new Date("2026-08-11T12:00:00.000Z");

function member(over: Partial<MemberRow> & { playerId: string; name: string }): MemberRow {
  return {
    tag: `#${over.playerId.toUpperCase()}`,
    thLevel: 15,
    clanRole: "member",
    verified: true,
    leftAt: null,
    ...over,
  };
}

function point(over: Partial<SnapshotPoint> & { playerId: string }): SnapshotPoint {
  return {
    capturedAt: NOW.toISOString(),
    donations: 1000,
    donationsReceived: 1000,
    trophies: 5000,
    thLevel: 15,
    role: "member",
    ...over,
  };
}

/** One clan, with latest readings and no history unless given. */
function clan(
  id: string,
  name: string,
  members: MemberRow[],
  latest: SnapshotPoint[] = [],
  history: Array<[string, SnapshotPoint[]]> = [],
): ClanInput {
  return {
    clanId: id,
    clanTag: `#${id.toUpperCase()}`,
    clanName: name,
    members,
    latest: new Map(latest.map((p) => [p.playerId, p])),
    history: new Map(history),
  };
}

describe("participation — every member of every clan in one list", () => {
  it("flattens members across clans and carries which clan each came from", () => {
    const rows = participation(
      [
        clan("a", "Clan A", [member({ playerId: "p1", name: "Ann" })]),
        clan("b", "Clan B", [member({ playerId: "p2", name: "Bob" })]),
      ],
      NOW,
    );

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.clanName).sort()).toEqual(["Clan A", "Clan B"]);
  });

  // The whole reason the page is sorted rather than alphabetical.
  it("puts flagged members first, then alphabetical within each group", () => {
    const rows = participation(
      [
        clan(
          "a",
          "Clan A",
          [
            member({ playerId: "p1", name: "Zoe" }),
            member({ playerId: "p2", name: "Ann" }),
            member({ playerId: "p3", name: "Bob" }),
          ],
          [
            // Zoe's ratio is bad, so she is flagged despite sorting last.
            point({ playerId: "p1", donations: 10, donationsReceived: 5000 }),
            point({ playerId: "p2", donations: 2000, donationsReceived: 1000 }),
            point({ playerId: "p3", donations: 2000, donationsReceived: 1000 }),
          ],
        ),
      ],
      NOW,
    );

    expect(rows.map((r) => r.name)).toEqual(["Zoe", "Ann", "Bob"]);
    expect(rows[0]!.flags.length).toBeGreaterThan(0);
  });

  // T3B.5 — reasons, never a bare score. A leader who cannot see why somebody
  // was flagged cannot defend the decision to them.
  it("carries the reasons rather than only a count", () => {
    const rows = participation(
      [
        clan(
          "a",
          "Clan A",
          [member({ playerId: "p1", name: "Ann" })],
          [point({ playerId: "p1", donations: 10, donationsReceived: 5000 })],
        ),
      ],
      NOW,
    );

    expect(rows[0]!.flags[0]).toMatch(/ratio/i);
  });

  it("leaves a member with no snapshot unflagged and unknown, not zero", () => {
    const rows = participation(
      [clan("a", "Clan A", [member({ playerId: "p1", name: "New" })])],
      NOW,
    );

    // Unknown is not inactive. Flagging it would list the entire clan on day one.
    expect(rows[0]!.activity.donations).toBeNull();
    expect(rows[0]!.activity.ratio).toBeNull();
    expect(rows[0]!.flags).toEqual([]);
  });

  it("uses the history it is given, so last-activity flags can fire at all", () => {
    const older = new Date(NOW.getTime() - 41 * 86_400_000).toISOString();
    const old = new Date(NOW.getTime() - 40 * 86_400_000).toISOString();

    const rows = participation(
      [
        clan(
          "a",
          "Clan A",
          [member({ playerId: "p1", name: "Quiet" })],
          [point({ playerId: "p1", capturedAt: old, donations: 1000 })],
          // lastActivityAt is the newest reading where a counter ROSE, not the
          // newest reading. Two identical points mean nothing moved and it stays
          // null — which is why this pair has to show a rise, 40 days ago.
          [
            [
              "p1",
              [
                point({ playerId: "p1", capturedAt: older, donations: 900 }),
                point({ playerId: "p1", capturedAt: old, donations: 1000 }),
              ],
            ],
          ],
        ),
      ],
      NOW,
    );

    expect(rows[0]!.activity.lastActivityAt).toBe(old);
    expect(rows[0]!.flags.join(" ")).toMatch(/donations or trophy movement/i);
  });

  it("returns nothing for clans with no members rather than throwing", () => {
    expect(participation([clan("a", "Clan A", [])], NOW)).toEqual([]);
    expect(participation([], NOW)).toEqual([]);
  });
});

describe("clanSummaries — comparing clans against each other", () => {
  // The finding this test exists for: a mean would report ~13.4 here and make
  // a clan where three of four members donate nothing look healthy.
  it("uses the median, so one huge donor cannot hide a quiet clan", () => {
    const [summary] = clanSummaries(
      participation(
        [
          clan(
            "a",
            "Clan A",
            [
              member({ playerId: "p1", name: "Whale" }),
              member({ playerId: "p2", name: "Ann" }),
              member({ playerId: "p3", name: "Bob" }),
            ],
            [
              point({ playerId: "p1", donations: 40000, donationsReceived: 1000 }), // 40.0
              point({ playerId: "p2", donations: 100, donationsReceived: 1000 }), //  0.1
              point({ playerId: "p3", donations: 200, donationsReceived: 1000 }), //  0.2
            ],
          ),
        ],
        NOW,
      ),
    );

    expect(summary!.medianRatio).toBeCloseTo(0.2, 5);
  });

  it("counts members, low ratios and flagged members per clan", () => {
    const summaries = clanSummaries(
      participation(
        [
          clan(
            "a",
            "Clan A",
            [
              member({ playerId: "p1", name: "Ann" }),
              member({ playerId: "p2", name: "Bob" }),
            ],
            [
              point({ playerId: "p1", donations: 10, donationsReceived: 5000 }),
              point({ playerId: "p2", donations: 5000, donationsReceived: 1000 }),
            ],
          ),
          clan("b", "Clan B", [member({ playerId: "p3", name: "Cid" })]),
        ],
        NOW,
      ),
    );

    const a = summaries.find((s) => s.clanName === "Clan A")!;
    expect(a.members).toBe(2);
    expect(a.lowRatio).toBe(1);
    expect(a.needsAttention).toBe(1);

    const b = summaries.find((s) => s.clanName === "Clan B")!;
    expect(b.members).toBe(1);
    expect(b.medianRatio).toBeNull(); // nobody has a known ratio
  });

  it("orders clans by name, so the report reads the same way every time", () => {
    const summaries = clanSummaries(
      participation(
        [
          clan("z", "Zulu", [member({ playerId: "p1", name: "Ann" })]),
          clan("a", "Alpha", [member({ playerId: "p2", name: "Bob" })]),
        ],
        NOW,
      ),
    );

    expect(summaries.map((s) => s.clanName)).toEqual(["Alpha", "Zulu"]);
  });

  it("returns nothing when there are no members at all", () => {
    expect(clanSummaries([])).toEqual([]);
  });
});
