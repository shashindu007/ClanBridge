import { describe, expect, it } from "vitest";
import type { CwlAttack, CwlRosterEntry } from "@/repositories/cwl";
import { auditDay, type AuditDayInput } from "./cwl-audit";
import { dayBoard } from "./cwl-day";
import { dayRating } from "./cwl-rating";
import type { ScoutWarMember } from "./cwl-scouting";

const US = "#US";
const FOE = "#FOE";

function member(n: number): CwlRosterEntry {
  return { playerId: `p${n}`, tag: `#U${n}`, name: `Us ${n}`, mapPosition: n, thLevel: 18 };
}

function attack(n: number, defenderTag: string, stars: number): CwlAttack {
  return { playerId: `p${n}`, attackOrder: 1, stars, destruction: stars === 3 ? 100 : 60, defenderTag, defenderPosition: 99 };
}

function slot(
  clanTag: string,
  tag: string,
  mapPosition: number,
  hit?: [stars: number, defender: string, order: number],
): ScoutWarMember {
  return {
    warTag: "#W",
    clanTag,
    tag,
    name: `Name ${tag.slice(1)}`,
    thLevel: 18,
    mapPosition,
    attackStars: hit?.[0] ?? null,
    attackDestruction: hit ? (hit[0] === 3 ? 100 : 60) : null,
    attackDefenderTag: hit?.[1] ?? null,
    attackOrder: hit?.[2] ?? null,
    seenAt: null,
  };
}

/** A clean 3-base day: we take 3 + 2, they take 3 + 1, one of ours does not attack. */
function day(change: Partial<Pick<AuditDayInput, "roster" | "attacks" | "lineup" | "war">> = {}): AuditDayInput {
  const roster = change.roster ?? [member(1), member(2), member(3)];
  const attacks = change.attacks ?? [attack(1, "#F1", 3), attack(2, "#F2", 2)];
  const lineup = change.lineup ?? [
    slot(US, "#U1", 1, [3, "#F1", 1]),
    slot(US, "#U2", 2, [2, "#F2", 3]),
    slot(US, "#U3", 3),
    slot(FOE, "#F1", 4, [3, "#U3", 2]),
    slot(FOE, "#F2", 9, [1, "#U1", 4]),
    slot(FOE, "#F3", 30),
  ];
  const war = change.war ?? { state: "warEnded", teamSize: 3, ourStars: 5, theirStars: 4 };
  const board = dayBoard({ roster: [...roster], attacks: [...attacks], lineup, ourTag: US, teamSize: war.teamSize });
  return { war, roster, attacks, lineup, ourTag: US, board, rated: dayRating(board, war.state) };
}

describe("auditDay", () => {
  it("finds nothing wrong with a clean day", () => {
    expect(auditDay(day())).toEqual([]);
  });

  it("finds a lineup that is not the war's team size", () => {
    const lineup = [...day().lineup, slot(FOE, "#GHOST", 6)];
    expect(auditDay(day({ lineup }))).toContain("the enemy lineup has 4 rows, not 3");
  });

  it("finds a roster of ours that is not the war's team size", () => {
    const issues = auditDay(day({ roster: [member(1), member(2), member(3), member(4)] }));
    expect(issues).toContain("our roster has 4 members for a 3-base war");
  });

  it("finds an attack on a base the enemy did not field", () => {
    const attacks = [attack(1, "#NOBODY", 3), attack(2, "#F2", 2)];
    const issues = auditDay(day({ attacks }));
    expect(issues).toContain("Us 1 attacked #NOBODY, who is not in the fielded enemy lineup");
  });

  it("finds an attack that cwl_attacks and the lineup row tell differently", () => {
    const attacks = [attack(1, "#F1", 2), attack(2, "#F2", 2)];
    expect(auditDay(day({ attacks }))).toContain("Us 1's attack differs between cwl_attacks and his lineup row");
  });

  it("finds an attack on a lineup row that cwl_attacks does not have", () => {
    const issues = auditDay(day({ attacks: [attack(1, "#F1", 3)] }));
    expect(issues).toContain("Us 2 attacked according to his lineup row, but cwl_attacks has nothing");
  });

  it("finds an enemy attack that lands on nobody of ours", () => {
    const lineup = day().lineup.map((m) => (m.tag === "#F2" ? { ...m, attackDefenderTag: "#STRANGER" } : m));
    expect(auditDay(day({ lineup }))).toContain("enemy Name F2 attacked #STRANGER, who is not one of our bases");
  });

  it("finds stars that do not add up to the war's own score", () => {
    const issues = auditDay(day({ war: { state: "warEnded", teamSize: 3, ourStars: 6, theirStars: 9 } }));
    expect(issues).toContain("our attacks add up to 5 stars; the war says 6");
    expect(issues).toContain("their attacks add up to 4 stars; the war says 9");
  });

  it("finds a base hit twice with no order to tell the attacks apart, only where it is rated", () => {
    const attacks = [attack(1, "#F1", 2), attack(2, "#F1", 3)];
    const lineup = [
      slot(US, "#U1", 1, [2, "#F1", 0]),
      slot(US, "#U2", 2, [3, "#F1", 0]),
      slot(US, "#U3", 3),
      slot(FOE, "#F1", 4),
      slot(FOE, "#F2", 9),
      slot(FOE, "#F3", 30),
    ].map((m) => ({ ...m, attackOrder: null }));
    const war = { state: "warEnded", teamSize: 3, ourStars: 3, theirStars: 0 };
    const unordered = auditDay(day({ attacks, lineup, war })).filter((i) => i.includes("order of the attacks"));
    expect(unordered).toHaveLength(2);
    // No enemy lineup: the day is not rated, and the order is not read.
    const ours = lineup.filter((m) => m.clanTag === US);
    expect(auditDay(day({ attacks, lineup: ours, war })).some((i) => i.includes("order of the attacks"))).toBe(false);
  });
});
