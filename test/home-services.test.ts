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

  // The reported bug: one CWL poll, four rows. A family poll is one row in
  // `polls` that every clan's list carries.
  describe("a family poll across clans", () => {
    const family = (responders: string[] = []) => ({
      id: "cwl-oct",
      title: "CWL availability — October 2026",
      closesAt: IN_2D,
      responders,
      scope: "family" as const,
    });
    const three = (responders: string[] = [], over: Partial<HomeClan> = {}) => [
      clan({ id: "c1", tag: "#AAA", name: "Dark Heaven", openPolls: [family(responders)], ...over }),
      clan({ id: "c2", tag: "#BBB", name: "DH CWL ONLY", openPolls: [family(responders)], ...over }),
      clan({ id: "c3", tag: "#CCC", name: "DH v2", openPolls: [family(responders)], ...over }),
    ];
    const villages = [
      { id: "v1", clanId: "c1" },
      { id: "v2", clanId: "c2" },
      { id: "v3", clanId: "c3" },
    ];

    it("is one row naming every clan you owe an answer in", () => {
      const items = needsYou({ clans: three(), myPlayers: villages, unread: 0, waitingAccounts: 0, now: NOW });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kind: "poll",
        title: "Answer: CWL availability — October 2026",
        meta: "Closes in 2d · 3 villages to answer",
        href: "/%23AAA/polls/cwl-oct",
      });
      expect(items[0]!.clans.map((c) => c.name)).toEqual(["Dark Heaven", "DH CWL ONLY", "DH v2"]);
    });

    // The poll page asks each village; one answer does not answer for the rest.
    it("stays until every one of your villages has answered", () => {
      const items = needsYou({ clans: three(["v1"]), myPlayers: villages, unread: 0, waitingAccounts: 0, now: NOW });
      expect(items).toHaveLength(1);
      expect(items[0]!.clans.map((c) => c.id)).toEqual(["c2", "c3"]);
      expect(items[0]!.href).toBe("/%23BBB/polls/cwl-oct");

      const done = needsYou({
        clans: three(["v1", "v2", "v3"]),
        myPlayers: villages,
        unread: 0,
        waitingAccounts: 0,
        now: NOW,
      });
      expect(done).toEqual([]);
    });

    // Leadership sees every clan's answers, so memberCount − responders
    // subtracted the whole family's answers from one clan's roster.
    it("counts a leader's non-responders per clan, as one row", () => {
      const clans = [
        clan({ id: "c1", tag: "#AAA", name: "Dark Heaven", role: "leader", openPolls: [family(["a1", "b1", "b2"])], memberIds: ["a1", "a2", "a3"] }),
        clan({ id: "c2", tag: "#BBB", name: "DH CWL ONLY", role: "leader", openPolls: [family(["a1", "b1", "b2"])], memberIds: ["b1", "b2"] }),
        clan({ id: "c3", tag: "#CCC", name: "DH v2", role: "co-leader", openPolls: [family(["a1", "b1", "b2"])], memberIds: ["c1", "c2", "c3", "c4"] }),
      ];
      const items = needsYou({ clans, myPlayers: [], unread: 0, waitingAccounts: 0, now: NOW });
      expect(kinds(items)).toEqual(["lead-poll"]);
      expect(items[0]!.title).toBe("6 members haven't answered CWL availability — October 2026");
      expect(items[0]!.clans).toEqual([
        { id: "c1", name: "Dark Heaven", count: 2 },
        { id: "c3", name: "DH v2", count: 4 },
      ]);
      // The action goes where most of the chasing is.
      expect(items[0]!.href).toBe("/%23CCC/polls/cwl-oct");
    });

    it("badges every clan tab the row concerns", () => {
      const items = needsYou({ clans: three(), myPlayers: villages, unread: 0, waitingAccounts: 0, now: NOW });
      const counts = countsByClan(items);
      expect([counts.get("c1"), counts.get("c2"), counts.get("c3")]).toEqual([1, 1, 1]);
    });
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
