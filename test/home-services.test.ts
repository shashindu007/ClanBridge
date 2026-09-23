// T12.10 — needsYou(): which things the home page asks a member to do, and in
// what order. The order is the design, so it is what most of these pin.

import { describe, expect, it } from "vitest";
import { countsByClan, needsYou, timeUntil, type HomeClan } from "@/services/home";

const NOW = new Date("2026-09-22T12:00:00Z");
const IN_5H = "2026-09-22T17:00:00Z";
const IN_2D = "2026-09-24T12:00:00Z";

const ME = "p-me";
const OTHER = "p-other";

function clan(over: Partial<HomeClan> = {}): HomeClan {
  return {
    id: "c1",
    tag: "#2PP0JCCL",
    name: "Dark Hell",
    role: "member",
    war: null,
    warRecord: [],
    openPolls: [],
    memberCount: 10,
    ...over,
  };
}

const battle = { state: "inWar", endTime: IN_5H, startTime: null };

function kinds(items: ReturnType<typeof needsYou>) {
  return items.map((i) => i.kind);
}

describe("needsYou", () => {
  it("is empty when nothing needs doing", () => {
    expect(needsYou({ clans: [], myPlayers: [], unread: 0, waitingAccounts: 0, now: NOW })).toEqual([]);
  });

  it("asks for your own unused attacks on battle day, with the time left", () => {
    const items = needsYou({
      clans: [
        clan({
          war: battle,
          warRecord: [
            { playerId: ME, attacksRemaining: 2 },
            { playerId: OTHER, attacksRemaining: 1 },
          ],
        }),
      ],
      myPlayers: [{ id: ME, clanId: "c1" }],
      unread: 0,
      waitingAccounts: 0,
      now: NOW,
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "war-attacks",
      title: "You have 2 attacks left",
      meta: "War ends in 5h",
      href: "/%232PP0JCCL/war",
      actionLabel: "Attack",
    });
  });

  // Somebody else's unused attacks are the leader's business, not a member's.
  it("counts only YOUR villages toward your attacks", () => {
    const items = needsYou({
      clans: [clan({ war: battle, warRecord: [{ playerId: OTHER, attacksRemaining: 2 }] })],
      myPlayers: [{ id: ME, clanId: "c1" }],
      unread: 0,
      waitingAccounts: 0,
      now: NOW,
    });
    expect(items).toEqual([]);
  });

  it("asks you to answer an open poll, and stops once you have", () => {
    const poll = { id: "poll1", title: "CWL October", closesAt: IN_2D, responders: [] as string[] };
    const input = {
      clans: [clan({ openPolls: [poll] })],
      myPlayers: [{ id: ME, clanId: "c1" }],
      unread: 0,
      waitingAccounts: 0,
      now: NOW,
    };
    expect(needsYou(input)[0]).toMatchObject({
      kind: "poll",
      title: "Answer: CWL October",
      meta: "Closes in 2d",
      href: "/%232PP0JCCL/polls/poll1",
    });

    poll.responders = [ME];
    expect(needsYou(input)).toEqual([]);
  });

  it("does not ask you about a poll in a clan you have no village in", () => {
    const items = needsYou({
      clans: [clan({ openPolls: [{ id: "p", title: "T", closesAt: null, responders: [] }] })],
      myPlayers: [{ id: ME, clanId: "another-clan" }],
      unread: 0,
      waitingAccounts: 0,
      now: NOW,
    });
    expect(items).toEqual([]);
  });

  it("gives leader tasks to leadership only", () => {
    const shared = {
      war: battle,
      warRecord: [{ playerId: OTHER, attacksRemaining: 2 }],
      openPolls: [{ id: "p", title: "CWL", closesAt: null, responders: [OTHER] }],
      memberCount: 5,
    };

    const asMember = needsYou({
      clans: [clan({ ...shared, role: "elder" })],
      myPlayers: [],
      unread: 0,
      waitingAccounts: 0,
      now: NOW,
    });
    expect(asMember).toEqual([]);

    const asColeader = needsYou({
      clans: [clan({ ...shared, role: "co-leader" })],
      myPlayers: [],
      unread: 0,
      waitingAccounts: 0,
      now: NOW,
    });
    expect(kinds(asColeader)).toEqual(["lead-attacks", "lead-poll"]);
    expect(asColeader[0]!.title).toBe("2 attacks still unused");
    expect(asColeader[1]!.title).toBe("4 members haven't answered CWL");
  });

  it("orders by urgency: your attacks, polls, leader tasks, approvals, unread", () => {
    const items = needsYou({
      clans: [
        clan({
          role: "leader",
          war: battle,
          warRecord: [
            { playerId: ME, attacksRemaining: 1 },
            { playerId: OTHER, attacksRemaining: 2 },
          ],
          openPolls: [{ id: "p", title: "CWL", closesAt: null, responders: [] }],
          memberCount: 3,
        }),
      ],
      myPlayers: [{ id: ME, clanId: "c1" }],
      unread: 4,
      waitingAccounts: 2,
      now: NOW,
    });
    expect(kinds(items)).toEqual([
      "war-attacks",
      "poll",
      "lead-attacks",
      "lead-poll",
      "approvals",
      "unread",
    ]);
  });

  it("mentions preparation day, ranked below an unanswered poll", () => {
    const items = needsYou({
      clans: [
        clan({
          war: { state: "preparation", endTime: null, startTime: IN_5H },
          warRecord: [{ playerId: ME, attacksRemaining: 2 }],
          openPolls: [{ id: "p", title: "CWL", closesAt: null, responders: [] }],
        }),
      ],
      myPlayers: [{ id: ME, clanId: "c1" }],
      unread: 0,
      waitingAccounts: 0,
      now: NOW,
    });
    expect(kinds(items)).toEqual(["poll", "war-soon"]);
    expect(items[1]!.meta).toBe("Battle day starts in 5h");
  });

  it("says nothing about a war that has ended", () => {
    const items = needsYou({
      clans: [
        clan({
          role: "leader",
          war: { state: "warEnded", endTime: null, startTime: null },
          warRecord: [{ playerId: ME, attacksRemaining: 2 }],
        }),
      ],
      myPlayers: [{ id: ME, clanId: "c1" }],
      unread: 0,
      waitingAccounts: 0,
      now: NOW,
    });
    expect(items).toEqual([]);
  });
});

describe("countsByClan", () => {
  it("counts clan items and ignores platform-wide ones", () => {
    const items = needsYou({
      clans: [
        clan({ openPolls: [{ id: "p", title: "A", closesAt: null, responders: [] }] }),
        clan({ id: "c2", tag: "#8QUCLJY0", openPolls: [] }),
      ],
      myPlayers: [{ id: ME, clanId: "c1" }],
      unread: 3,
      waitingAccounts: 1,
      now: NOW,
    });
    const counts = countsByClan(items);
    expect(counts.get("c1")).toBe(1);
    expect(counts.has("c2")).toBe(false);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("timeUntil", () => {
  it("rounds to the unit a person would say", () => {
    expect(timeUntil("2026-09-22T12:40:00Z", NOW)).toBe("in 40m");
    expect(timeUntil(IN_5H, NOW)).toBe("in 5h");
    expect(timeUntil(IN_2D, NOW)).toBe("in 2d");
  });

  it("is null once the moment has passed, or when there is none", () => {
    expect(timeUntil("2026-09-22T11:00:00Z", NOW)).toBeNull();
    expect(timeUntil(null, NOW)).toBeNull();
  });
});
