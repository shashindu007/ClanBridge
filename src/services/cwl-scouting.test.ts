import { describe, expect, it } from "vitest";
import type { GroupWar } from "@/repositories/cwl";
import {
  clanScout,
  nextLineup,
  weakPointsFor,
  type ScoutSeason,
  type ScoutWarMember,
} from "./cwl-scouting";

const US = "#US";
const FOE = "#FOE";
const OTHER = "#OTHER";

function war(warTag: string, day: number, state: string, clanTag: string, opponentTag: string): GroupWar {
  return {
    warTag,
    dayNumber: day,
    state,
    teamSize: 3,
    clanTag,
    opponentTag,
    clanStars: null,
    opponentStars: null,
    clanDestruction: null,
    opponentDestruction: null,
    clanAttacks: null,
    opponentAttacks: null,
  };
}

function slot(
  warTag: string,
  clanTag: string,
  tag: string,
  position: number,
  th: number,
  attack?: [stars: number, destruction: number, defender: string],
): ScoutWarMember {
  return {
    warTag,
    clanTag,
    tag,
    name: tag.slice(1),
    thLevel: th,
    mapPosition: position,
    attackStars: attack?.[0] ?? null,
    attackDestruction: attack?.[1] ?? null,
    attackDefenderTag: attack?.[2] ?? null,
  };
}

const WARS = [
  war("#D1", 1, "warEnded", FOE, OTHER),
  war("#D2", 2, "warEnded", US, FOE),
  war("#D3", 3, "preparation", FOE, US),
];

const SEASON: ScoutSeason = {
  roster: [
    { clanTag: FOE, tag: "#F1", name: "F1", thLevel: 18 },
    { clanTag: FOE, tag: "#F2", name: "F2", thLevel: 17 },
    { clanTag: FOE, tag: "#F3", name: "F3", thLevel: 15 },
    { clanTag: FOE, tag: "#F4", name: "Bench", thLevel: 17 },
    { clanTag: US, tag: "#U1", name: "U1", thLevel: 18 },
  ],
  lineups: [
    // Day 1, against OTHER: F3 misses, F1 triples.
    slot("#D1", FOE, "#F1", 1, 18, [3, 100, "#O1"]),
    slot("#D1", FOE, "#F2", 2, 17, [1, 55, "#O2"]),
    slot("#D1", FOE, "#F3", 3, 15),
    slot("#D1", OTHER, "#O1", 1, 18, [3, 100, "#F3"]),
    slot("#D1", OTHER, "#O2", 2, 17, [2, 80, "#F2"]),
    // Day 2, against us.
    slot("#D2", FOE, "#F1", 1, 18, [2, 90, "#U1"]),
    slot("#D2", FOE, "#F2", 2, 17, [1, 40, "#U2"]),
    slot("#D2", FOE, "#F3", 3, 15, [3, 100, "#U3"]),
    slot("#D2", US, "#U1", 1, 18, [3, 100, "#F3"]),
    slot("#D2", US, "#U2", 2, 17, [3, 100, "#F1"]),
    // Day 3 in preparation: nothing counts yet.
    slot("#D3", FOE, "#F1", 1, 18),
    slot("#D3", FOE, "#F4", 2, 17),
    slot("#D3", US, "#U1", 1, 18),
  ],
  villages: [
    {
      clanTag: FOE,
      tag: "#F2",
      name: "F2",
      thLevel: 17,
      heroes: [{ short: "BK", name: "Barbarian King", level: 70, cap: 100 }],
      heroPct: 70,
      petPct: 50,
      equipmentPct: 60,
      offencePct: 80,
      maxPct: 75,
      warStars: 900,
      capturedAt: "2026-10-03T06:00:00.000Z",
    },
    {
      clanTag: FOE,
      tag: "#F1",
      name: "F1",
      thLevel: 18,
      heroes: [],
      heroPct: 98,
      petPct: 100,
      equipmentPct: 90,
      offencePct: 95,
      maxPct: 96,
      warStars: 1500,
      capturedAt: "2026-10-03T07:00:00.000Z",
    },
  ],
};

describe("clanScout", () => {
  const scout = clanScout(FOE, SEASON, WARS);
  const player = (tag: string) => scout.players.find((p) => p.tag === tag)!;

  it("gives the registered roster's Town Hall mix, and the fielded one", () => {
    expect(scout.roster.levels).toEqual([
      { level: 18, count: 1 },
      { level: 17, count: 2 },
      { level: 15, count: 1 },
    ]);
    // F4 has only been in a lineup that has not started.
    expect(scout.fielded.total).toBe(3);
  });

  it("counts attacks over started days only, and a miss only on an ended day", () => {
    expect(scout.attacks).toBe(5);
    expect(scout.missed).toBe(1);
    expect(player("#F3").missed).toBe(1);
    expect(scout.threeStars).toBe(2);
    expect(scout.threeStarRate).toBe(40);
    expect(scout.avgStars).toBe(2);
  });

  it("derives defence from the other side's attacks", () => {
    expect(scout.defences).toBe(4);
    expect(scout.tripledAgainst).toBe(3);
    expect(player("#F3")).toMatchObject({ defences: 2, tripled: 2 });
  });

  it("averages village progress over the villages read", () => {
    expect(scout.scouted).toBe(2);
    expect(scout.avgHeroPct).toBe(84);
    expect(scout.capturedAt).toBe("2026-10-03T07:00:00.000Z");
  });

  it("lists players strongest base first, with stars per started day", () => {
    expect(scout.players.map((p) => p.tag)).toEqual(["#F1", "#F2", "#F4", "#F3"]);
    expect(player("#F3").byDay).toEqual([
      { day: 1, stars: null, fielded: true },
      { day: 2, stars: 3, fielded: true },
    ]);
  });

  it("flags the weak points, most flags first", () => {
    expect(scout.weakPoints[0]!.tag).toBe("#F3");
    expect(player("#F3").flags.map((f) => f.kind)).toEqual(["missed", "tripled", "lowTh"]);
    expect(player("#F2").flags.map((f) => f.kind)).toEqual(["heroes", "lowStars"]);
    expect(player("#F1").flags).toEqual([]);
  });
});

describe("weakPointsFor", () => {
  const base = {
    thLevel: 17,
    heroPct: null,
    missed: 0,
    attacks: 0,
    avgStars: null,
    defences: 0,
    tripled: 0,
    daysFielded: 0,
  };

  it("names the number every flag is based on, and never says 'rushed'", () => {
    const flags = weakPointsFor(
      { ...base, heroPct: 72.4, missed: 2, attacks: 3, avgStars: 1.3, defences: 3, tripled: 2, daysFielded: 3, thLevel: 15 },
      17,
    );
    expect(flags.map((f) => f.label)).toEqual([
      "Heroes 72% of TH15 max",
      "Missed 2 attacks",
      "Averages 1.3★ per attack",
      "Base 3-starred 2 of 3 times",
      "TH15 in a TH17 lineup",
    ]);
    expect(flags.some((f) => /rush/i.test(f.label))).toBe(false);
  });

  it("does not judge one bad attack, or an unread village", () => {
    expect(weakPointsFor({ ...base, attacks: 1, avgStars: 0 }, 17)).toEqual([]);
  });
});

describe("nextLineup", () => {
  it("is the war in preparation, both sides by map position", () => {
    const next = nextLineup(US, WARS, SEASON.lineups)!;
    expect(next).toMatchObject({ warTag: "#D3", day: 3, state: "preparation", enemyTag: FOE });
    expect(next.theirs.map((s) => s.tag)).toEqual(["#F1", "#F4"]);
    expect(next.ours.map((s) => s.tag)).toEqual(["#U1"]);
  });

  it("is null once the week is over", () => {
    expect(nextLineup(US, WARS.slice(0, 2), SEASON.lineups)).toBeNull();
  });
});
