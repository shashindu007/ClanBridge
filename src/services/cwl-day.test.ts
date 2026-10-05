import { describe, expect, it } from "vitest";
import type { CwlAttack, CwlRosterEntry, GroupWar } from "@/repositories/cwl";
import { baseNumbers } from "./cwl";
import { dayBoard } from "./cwl-day";
import type { ScoutWarMember } from "./cwl-scouting";

const US = "#US";
const FOE = "#FOE";
const WAR = "#W1";

function member(n: number, mapPosition: number | null = n): CwlRosterEntry {
  return { playerId: `p${n}`, tag: `#U${n}`, name: `Us ${n}`, mapPosition, thLevel: 18 };
}

function attack(n: number, defenderTag: string, stars: number, destruction: number): CwlAttack {
  // defenderPosition is the API's mapPosition, kept as stored — never shown.
  return { playerId: `p${n}`, attackOrder: 1, stars, destruction, defenderTag, defenderPosition: 99 };
}

function slot(
  clanTag: string,
  tag: string,
  mapPosition: number,
  hit?: [stars: number, destruction: number, defender: string],
  order: number | null = null,
): ScoutWarMember {
  return {
    warTag: WAR,
    clanTag,
    tag,
    name: `Name ${tag.slice(1)}`,
    thLevel: 17,
    mapPosition,
    attackStars: hit?.[0] ?? null,
    attackDestruction: hit?.[1] ?? null,
    attackDefenderTag: hit?.[2] ?? null,
    attackOrder: order,
  };
}

describe("baseNumbers", () => {
  it("numbers a CWL lineup 1 to N whatever the API's positions were", () => {
    // A real day: fifteen enemy bases, positions running to 19 with gaps.
    const api = [1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 13, 15, 16, 18, 19];
    const numbers = baseNumbers(api.map((mapPosition) => ({ tag: `#E${mapPosition}`, mapPosition })));
    expect([...numbers.values()]).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(numbers.get("#E19")).toBe(15);
    expect(numbers.get("#E4")).toBe(3);
  });

  it("does not depend on the order the rows arrive in", () => {
    const numbers = baseNumbers([
      { tag: "#C", mapPosition: 18 },
      { tag: "#A", mapPosition: 2 },
      { tag: "#B", mapPosition: 7 },
    ]);
    expect(Object.fromEntries(numbers)).toEqual({ "#A": 1, "#B": 2, "#C": 3 });
  });

  it("leaves out a member with no position instead of guessing one", () => {
    const numbers = baseNumbers([
      { tag: "#A", mapPosition: 3 },
      { tag: "#B", mapPosition: null },
    ]);
    expect(numbers.get("#A")).toBe(1);
    expect(numbers.has("#B")).toBe(false);
  });
});

describe("dayBoard", () => {
  // Our three bases sit at API positions 1, 2 and 18; theirs at 4, 9 and 19.
  const roster = [member(1), member(2), member(3, 18)];
  const lineup = [
    slot(US, "#U1", 1),
    slot(US, "#U2", 2),
    slot(US, "#U3", 18),
    slot(FOE, "#F4", 4, [2, 80, "#U3"]),
    slot(FOE, "#F9", 9, [3, 100, "#U3"]),
    slot(FOE, "#F19", 19),
  ];
  const attacks = [attack(1, "#F19", 3, 100), attack(3, "#F4", 1, 55)];

  const board = dayBoard({ roster, attacks, lineup, ourTag: US, teamSize: 3 });

  it("numbers both sides as the war map does", () => {
    expect(board.bases.map((b) => [b.tag, b.base])).toEqual([
      ["#U1", 1],
      ["#U2", 2],
      ["#U3", 3],
    ]);
    // The base at API position 19 is the third and last on a 3-base map.
    expect(board.bases[0]!.attack?.target).toMatchObject({ tag: "#F19", base: 3, name: "Name F19" });
    expect(board.bases[2]!.attack?.target).toMatchObject({ tag: "#F4", base: 1 });
  });

  it("gives each base its owner's attack, or none", () => {
    expect(board.bases[0]!.attack).toMatchObject({ stars: 3, destruction: 100 });
    expect(board.bases[1]!.attack).toBeNull();
  });

  it("lists the enemy's attacks on a base, the one that scores first", () => {
    expect(board.bases[2]!.defences).toEqual([
      { stars: 3, destruction: 100, by: { tag: "#F9", base: 2, name: "Name F9", thLevel: 17 } },
      { stars: 2, destruction: 80, by: { tag: "#F4", base: 1, name: "Name F4", thLevel: 17 } },
    ]);
    expect(board.bases[0]!.defences).toEqual([]);
  });

  it("counts attacks used on both sides", () => {
    expect(board.ours).toEqual({ used: 2, of: 3 });
    expect(board.theirs).toEqual({ used: 2, of: 3 });
    expect(board.basesHit).toBe(1);
    expect(board.basesTripled).toBe(1);
    expect(board.enemyKnown).toBe(true);
  });

  describe("a day whose lineup was never recorded", () => {
    const groupWar: GroupWar = {
      warTag: WAR,
      dayNumber: 1,
      state: "warEnded",
      teamSize: 3,
      clanTag: FOE,
      opponentTag: US,
      clanStars: 5,
      opponentStars: 4,
      clanDestruction: 70,
      opponentDestruction: 60,
      clanAttacks: 3,
      opponentAttacks: 2,
    };

    it("says the enemy is not known rather than numbering their bases", () => {
      const old = dayBoard({ roster, attacks, lineup: [], ourTag: US, teamSize: 3 });
      expect(old.enemyKnown).toBe(false);
      expect(old.bases[0]!.attack?.target).toEqual({ tag: "#F19", base: null, name: null, thLevel: null });
      expect(old.bases.every((b) => b.defences.length === 0)).toBe(true);
      expect(old.theirs).toEqual({ used: null, of: 3 });
      // Our own bases are still numbered, from the roster.
      expect(old.bases.map((b) => b.base)).toEqual([1, 2, 3]);
    });

    it("still takes the enemy's attack count from the group table, whichever side they are", () => {
      const asOpponent = dayBoard({ roster, attacks, lineup: [], ourTag: US, teamSize: 3, groupWar });
      expect(asOpponent.theirs).toEqual({ used: 3, of: 3 });

      const asClan = dayBoard({
        roster,
        attacks,
        lineup: [],
        ourTag: US,
        teamSize: 3,
        groupWar: { ...groupWar, clanTag: US, opponentTag: FOE },
      });
      expect(asClan.theirs).toEqual({ used: 2, of: 3 });
    });
  });
});

describe("what an attack found already taken (062)", () => {
  // Us 1 and Us 2 both hit their #1; Us 3 hits their #2 alone.
  const roster = [member(1), member(2), member(3)];
  const foe = [slot(FOE, "#F1", 1), slot(FOE, "#F2", 2)];
  const attacks = [attack(1, "#F1", 2, 80), attack(2, "#F1", 3, 100), attack(3, "#F2", 1, 40)];
  const ours = (orders: [number | null, number | null, number | null]) => [
    slot(US, "#U1", 1, [2, 80, "#F1"], orders[0]),
    slot(US, "#U2", 2, [3, 100, "#F1"], orders[1]),
    slot(US, "#U3", 3, [1, 40, "#F2"], orders[2]),
  ];
  const taken = (orders: [number | null, number | null, number | null]) =>
    dayBoard({ roster, attacks, lineup: [...ours(orders), ...foe], ourTag: US, teamSize: 3 }).bases.map(
      (b) => b.attack?.alreadyTaken,
    );

  it("is the best result clanmates had taken before it, by the order of attacks", () => {
    // Us 1 went first with two stars, so Us 2's three found two already taken.
    expect(taken([4, 9, 1])).toEqual([0, 2, 0]);
    // The other way round, Us 1's two stars came after the base was tripled.
    expect(taken([9, 4, 1])).toEqual([3, 0, 0]);
  });

  it("is not known for a base hit twice when the order was never recorded", () => {
    expect(taken([null, null, null])).toEqual([null, null, 0]);
    // One of the two missing is enough: there is no telling who was first.
    expect(taken([4, null, 1])).toEqual([null, null, 0]);
  });

  it("is nothing for the only attack on a base, even with no lineup at all", () => {
    const board = dayBoard({ roster, attacks: [attack(3, "#F2", 1, 40)], lineup: [], ourTag: US, teamSize: 3 });
    expect(board.bases[2]!.attack?.alreadyTaken).toBe(0);
  });
});
