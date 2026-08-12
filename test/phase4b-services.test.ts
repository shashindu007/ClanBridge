// T4B.4 / T4B.11-T4B.13 — the derived values, as pure functions.
//
// Two of these carry rules that the rest of the system depends on being right:
//
//   nonResponders   the list the leader chases. It cannot come from
//                   poll_responses, because the people on it have no row there.
//
//   planVsReality   R12. Selected-and-played / selected-and-absent /
//                   played-but-never-selected. The third group is the one nobody
//                   expects and the reason this is a three-way split.

import { describe, expect, it } from "vitest";
import type { Poll, PollOption, PollResponse } from "@/repositories/polls";
import type { RosterMember } from "@/repositories/rosters";
import type { CwlAttack, CwlRosterEntry } from "@/repositories/cwl";
import {
  isOpen,
  openWarAvailabilityPoll,
  optionShare,
  pollBreakdown,
  nonResponders,
  type EligibleMember,
} from "@/services/polls";
import {
  allocationList,
  contributionReport,
  nextAwardOrder,
  planVsReality,
  type SeasonWarData,
} from "@/services/rosters";

function member(n: number): EligibleMember {
  return { playerId: `p${n}`, tag: `#P${n}`, name: `Player ${n}` };
}

function response(playerId: string, optionId: string, over: Partial<PollResponse> = {}): PollResponse {
  return {
    id: `r-${playerId}`,
    pollId: "poll",
    playerId,
    optionId,
    note: null,
    respondedAt: "2026-08-01T10:00:00Z",
    updatedAt: null,
    ...over,
  };
}

const OPTIONS: PollOption[] = [
  { id: "in", pollId: "poll", label: "In", sortOrder: 1 },
  { id: "out", pollId: "poll", label: "Out", sortOrder: 2 },
];

describe("T4B.4 — poll breakdown", () => {
  const eligible = [member(1), member(2), member(3)];

  it("puts everyone who did not answer on the chase list", () => {
    const result = pollBreakdown(eligible, [response("p1", "in")], OPTIONS);
    expect(result.answered.map((a) => a.playerId)).toEqual(["p1"]);
    expect(result.notAnswered.map((m) => m.playerId)).toEqual(["p2", "p3"]);
    expect(result.totalEligible).toBe(3);
  });

  it("resolves the option label rather than showing an id", () => {
    const result = pollBreakdown(eligible, [response("p2", "out")], OPTIONS);
    expect(result.answered[0]!.optionLabel).toBe("Out");
  });

  it("surfaces a changed answer, so a late flip is visible (T4B.3)", () => {
    const result = pollBreakdown(
      eligible,
      [response("p1", "out", { updatedAt: "2026-08-02T09:00:00Z" })],
      OPTIONS,
    );
    expect(result.answered[0]!.changedAt).toBe("2026-08-02T09:00:00Z");
  });

  it("reports everyone when nobody has answered", () => {
    expect(nonResponders(eligible, [])).toHaveLength(3);
  });

  it("reports nobody once everyone has", () => {
    const all = eligible.map((m) => response(m.playerId, "in"));
    expect(nonResponders(eligible, all)).toHaveLength(0);
  });

  // A response from someone no longer eligible — they left the clan after
  // answering — must not resurrect them into the list.
  it("ignores a response from someone not on the eligible list", () => {
    const result = pollBreakdown(eligible, [response("p1", "in"), response("p99", "in")], OPTIONS);
    expect(result.answered).toHaveLength(1);
    expect(result.totalEligible).toBe(3);
  });
});

describe("isOpen — mirrors the insert policy", () => {
  const now = new Date("2026-08-02T12:00:00Z");
  const poll = (over: Partial<Poll> = {}): Poll => ({
    id: "poll",
    scope: "clan",
    clanId: "clan",
    season: null,
    pollType: "cwl_availability",
    title: "t",
    question: null,
    opensAt: null,
    closesAt: null,
    status: "open",
    createdBy: "u",
    createdAt: "2026-08-01T00:00:00Z",
    ...over,
  });

  it("is open with no window set", () => {
    expect(isOpen(poll(), now)).toBe(true);
  });
  it("is closed past closes_at", () => {
    expect(isOpen(poll({ closesAt: "2026-08-02T11:00:00Z" }), now)).toBe(false);
  });
  it("is closed before opens_at", () => {
    expect(isOpen(poll({ opensAt: "2026-08-03T00:00:00Z" }), now)).toBe(false);
  });
  it("is closed when the status says so, whatever the dates", () => {
    expect(isOpen(poll({ status: "closed" }), now)).toBe(false);
  });
});

// The regression test for a bug that shipped and was invisible for exactly this
// reason: the lineup page did `polls.find(p => p.pollType === "war_availability")`
// with no open check at all, and pollsForClan filters on deleted_at alone. After
// one war it therefore sized the NEXT war from the LAST war's answers, with
// nothing on screen admitting the count was days old.
describe("T6.7 — openWarAvailabilityPoll", () => {
  const now = new Date("2026-08-02T12:00:00Z");
  const poll = (over: Partial<Poll> = {}): Poll => ({
    id: "poll",
    scope: "clan",
    clanId: "clan",
    season: null,
    pollType: "war_availability",
    title: "War availability",
    question: null,
    opensAt: null,
    closesAt: null,
    status: "open",
    createdBy: "u",
    createdAt: "2026-08-01T00:00:00Z",
    ...over,
  });

  it("finds the open one", () => {
    expect(openWarAvailabilityPoll([poll()], now)?.id).toBe("poll");
  });

  it("does NOT return last war's closed poll", () => {
    expect(openWarAvailabilityPoll([poll({ status: "closed" })], now)).toBeNull();
  });

  it("does NOT return one whose closes_at has passed", () => {
    const expired = poll({ closesAt: "2026-08-02T11:00:00Z" });
    expect(openWarAvailabilityPoll([expired], now)).toBeNull();
  });

  it("does NOT return one that has not opened yet", () => {
    const early = poll({ opensAt: "2026-08-03T00:00:00Z" });
    expect(openWarAvailabilityPoll([early], now)).toBeNull();
  });

  // The exact shape pollsForClan hands over after a couple of wars: newest
  // first, most of them closed.
  it("skips past closed ones to the open one", () => {
    const polls = [
      poll({ id: "war-3", status: "closed" }),
      poll({ id: "war-2", status: "open" }),
      poll({ id: "war-1", status: "closed" }),
    ];
    expect(openWarAvailabilityPoll(polls, now)?.id).toBe("war-2");
  });

  it("ignores open polls of other types", () => {
    const cwl = poll({ id: "cwl", pollType: "cwl_availability" });
    const general = poll({ id: "gen", pollType: "general" });
    expect(openWarAvailabilityPoll([cwl, general], now)).toBeNull();
  });

  // Two open at once is a leader who opened a second by mistake. Newest wins,
  // because that is the one people are answering.
  it("takes the first of several open ones, the list being newest-first", () => {
    const polls = [poll({ id: "newer" }), poll({ id: "older" })];
    expect(openWarAvailabilityPoll(polls, now)?.id).toBe("newer");
  });

  it("returns null for an empty list", () => {
    expect(openWarAvailabilityPoll([], now)).toBeNull();
  });
});

describe("optionShare", () => {
  it("gives percentages", () => {
    const shares = optionShare([
      { optionId: "in", label: "In", sortOrder: 1, votes: 3 },
      { optionId: "out", label: "Out", sortOrder: 2, votes: 1 },
    ]);
    expect(shares.map((s) => s.share)).toEqual([75, 25]);
  });

  it("does not divide by zero on an unanswered poll", () => {
    const shares = optionShare([{ optionId: "in", label: "In", sortOrder: 1, votes: 0 }]);
    expect(shares[0]!.share).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
function selected(n: number, over: Partial<RosterMember> = {}): RosterMember {
  return {
    id: `rm-${n}`,
    rosterId: "roster",
    playerId: `p${n}`,
    position: n,
    addedAt: "2026-08-01T00:00:00Z",
    tag: `#P${n}`,
    name: `Player ${n}`,
    thLevel: 15,
    ...over,
  };
}

function apiEntry(n: number): CwlRosterEntry {
  return {
    playerId: `p${n}`,
    tag: `#P${n}`,
    name: `Player ${n}`,
    mapPosition: n,
    thLevel: 15,
  };
}

function attack(playerId: string, stars: number, destruction = 90): CwlAttack {
  return { playerId, attackOrder: 1, stars, destruction, defenderTag: "#D", defenderPosition: 1 };
}

describe("T4B.11 — plan versus reality (R12)", () => {
  it("separates played, absent, and never-selected", () => {
    const wars: SeasonWarData[] = [
      { apiRoster: [apiEntry(1), apiEntry(3)], attacks: [attack("p1", 3)] },
    ];
    // Selected: 1 and 2. Played: 1 and 3.
    const rows = planVsReality([selected(1), selected(2)], wars);
    const byId = new Map(rows.map((r) => [r.playerId, r]));

    expect(byId.get("p1")!.outcome).toBe("played");
    expect(byId.get("p2")!.outcome).toBe("absent");
    expect(byId.get("p3")!.outcome).toBe("unplanned");
  });

  // The group nobody expects: a co-leader adds someone in game who was never on
  // the roster, and without this they are invisible in every report while
  // consuming a slot somebody else was promised.
  it("catches a player who appeared without ever being selected", () => {
    const rows = planVsReality([], [{ apiRoster: [apiEntry(9)], attacks: [] }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ playerId: "p9", outcome: "unplanned", warsPlayed: 1 });
  });

  it("keeps a selected player who never appeared, rather than dropping them", () => {
    const rows = planVsReality([selected(1)], [{ apiRoster: [], attacks: [] }]);
    expect(rows[0]).toMatchObject({ outcome: "absent", warsPlayed: 0, attacksUsed: 0 });
  });

  it("counts appearances and stars across several wars", () => {
    const wars: SeasonWarData[] = [
      { apiRoster: [apiEntry(1)], attacks: [attack("p1", 3)] },
      { apiRoster: [apiEntry(1)], attacks: [attack("p1", 2)] },
      { apiRoster: [apiEntry(1)], attacks: [] },
    ];
    expect(planVsReality([selected(1)], wars)[0]).toMatchObject({
      warsPlayed: 3,
      attacksUsed: 2,
      stars: 5,
    });
  });

  it("sorts absent first — it is the group to act on", () => {
    const wars: SeasonWarData[] = [
      { apiRoster: [apiEntry(1), apiEntry(9)], attacks: [attack("p1", 3)] },
    ];
    const rows = planVsReality([selected(1), selected(2)], wars);
    expect(rows.map((r) => r.outcome)).toEqual(["absent", "unplanned", "played"]);
  });
});

describe("T4B.12 — contribution report", () => {
  const wars: SeasonWarData[] = [
    { apiRoster: [apiEntry(1), apiEntry(2)], attacks: [attack("p1", 3, 100), attack("p2", 1, 40)] },
    { apiRoster: [apiEntry(1), apiEntry(2)], attacks: [attack("p1", 2, 80)] },
  ];

  it("counts attacks against wars the player was actually placed in", () => {
    const rows = contributionReport(wars, []);
    const p2 = rows.find((r) => r.playerId === "p2")!;
    // In two wars, attacked in one — that is one miss, and it is the member's,
    // not the leader's.
    expect(p2).toMatchObject({ warsPlayed: 2, attacksUsed: 1, missed: 1 });
  });

  it("averages destruction over attacks made, not wars entered", () => {
    const p1 = contributionReport(wars, []).find((r) => r.playerId === "p1")!;
    expect(p1.averageDestruction).toBe(90); // (100 + 80) / 2
  });

  it("does not divide by zero for someone who never attacked", () => {
    const rows = contributionReport([{ apiRoster: [apiEntry(5)], attacks: [] }], []);
    expect(rows[0]!.averageDestruction).toBe(0);
    expect(rows[0]!.missed).toBe(1);
  });

  it("marks who already has a medal", () => {
    const rows = contributionReport(wars, [{ playerId: "p2", awardOrder: 1 }]);
    expect(rows.find((r) => r.playerId === "p2")!.hasBonus).toBe(true);
    expect(rows.find((r) => r.playerId === "p1")!.hasBonus).toBe(false);
  });
});

describe("T4B.13 — the leader's allocation order", () => {
  const rows = contributionReport(
    [{ apiRoster: [apiEntry(1), apiEntry(2), apiEntry(3)], attacks: [attack("p1", 3), attack("p2", 2)] }],
    [
      { playerId: "p3", awardOrder: 1 },
      { playerId: "p2", awardOrder: 2 },
    ],
  );

  // The whole point of the answer to T0.11: the order is the leader's, not a
  // formula's. p3 scored nothing and is still first, because that is what was
  // decided and recorded.
  it("keeps the awarded list in the leader's order, not by performance", () => {
    const { awarded } = allocationList(rows);
    expect(awarded.map((a) => a.playerId)).toEqual(["p3", "p2"]);
  });

  it("leaves everyone else as candidates in the default reading order", () => {
    const { candidates } = allocationList(rows);
    expect(candidates.map((c) => c.playerId)).toEqual(["p1"]);
  });

  it("suggests the next free position", () => {
    const { awarded } = allocationList(rows);
    expect(nextAwardOrder(awarded)).toBe(3);
    expect(nextAwardOrder([])).toBe(1);
  });
});
