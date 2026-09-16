// T11B.7 — services/progress.ts.
//
// Pure functions, tested with hand-built units where the arithmetic has to be
// checked exactly, and with the real TH17 fixture run through the same path the
// sync job uses where "does this hold for a real account" is the question.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { playerSchema } from "@/integration/coc-schemas";
import { mapPlayerProgress } from "@/integration/mappers";
import {
  behindPreviousHall,
  groupProgress,
  overallProgress,
  tally,
  upgradesBetween,
  type StoredUnit,
} from "@/services/progress";
import { progressRow } from "../scripts/sync/players";

function unit(overrides: Partial<StoredUnit> & Pick<StoredUnit, "name">): StoredUnit {
  return {
    level: 1,
    apiMax: 10,
    village: "home",
    group: "elixirTroop",
    cap: 10,
    capKnown: true,
    ...overrides,
  };
}

const real = progressRow(
  { id: "p", tag: "#PY0LQGRJ", clanId: null },
  mapPlayerProgress(
    playerSchema.parse(
      JSON.parse(readFileSync(join(process.cwd(), "fixtures", "player.json"), "utf8")),
    ),
  ),
);

describe("tally", () => {
  it("sums levels against caps rather than counting maxed units", () => {
    const result = tally([
      unit({ name: "A", level: 9, cap: 10 }),
      unit({ name: "B", level: 1, cap: 10 }),
    ]);
    expect(result).toEqual({ done: 10, total: 20, pct: 50 });
  });

  it("floors, so 100% only ever means everything is capped", () => {
    const result = tally([unit({ name: "A", level: 9999, cap: 10000 })]);
    expect(result.pct).toBe(99.9);
  });

  it("does not count a super troop twice over its base troop", () => {
    const result = tally([
      unit({ name: "Barbarian", level: 5, cap: 10 }),
      unit({ name: "Super Barbarian", level: 1, cap: 5, group: "superTroop" }),
    ]);
    expect(result).toEqual({ done: 5, total: 10, pct: 50 });
  });

  it("clamps a level above its cap instead of passing 100%", () => {
    expect(tally([unit({ name: "A", level: 12, cap: 10 })]).pct).toBe(100);
  });

  it("reads 100% with nothing to count, rather than dividing by zero", () => {
    expect(tally([])).toEqual({ done: 0, total: 0, pct: 100 });
  });
});

describe("groupProgress", () => {
  it("splits by village and keeps display order", () => {
    const groups = groupProgress(
      [
        unit({ name: "Spell", group: "elixirSpell" }),
        unit({ name: "King", group: "hero" }),
        unit({ name: "Machine", group: "builderHero", village: "builder" }),
      ],
      "home",
    );
    expect(groups.map((g) => g.group)).toEqual(["hero", "elixirSpell"]);
  });

  it("counts maxed units and units whose cap is only the game maximum", () => {
    const [group] = groupProgress(
      [
        unit({ name: "A", level: 10, cap: 10 }),
        unit({ name: "B", level: 3, cap: 9, capKnown: false }),
      ],
      "home",
    );
    expect(group).toMatchObject({ maxed: 1, capUnknown: 1, label: "Elixir troops" });
  });

  it("lists equipment by hero so a hero's kit reads together", () => {
    const [group] = groupProgress(
      [
        unit({ name: "Z", group: "equipment", hero: "Archer Queen" }),
        unit({ name: "B", group: "equipment", hero: "Barbarian King" }),
        unit({ name: "A", group: "equipment", hero: "Archer Queen" }),
      ],
      "home",
    );
    expect(group!.units.map((u) => u.name)).toEqual(["A", "Z", "B"]);
  });
});

describe("the real TH17 account", () => {
  const units = real.units;

  it("is below 100% at home, because 110 is not its King's cap", () => {
    const home = overallProgress(units, "home");
    expect(home.pct).toBeGreaterThan(50);
    expect(home.pct).toBeLessThan(100);
  });

  it("scores its maxed Builder Base Battle Machine as maxed", () => {
    const heroes = groupProgress(units, "builder").find((g) => g.group === "builderHero")!;
    const machine = heroes.units.find((u) => u.name === "Battle Machine")!;
    expect(machine).toMatchObject({ level: 35, cap: 35 });
  });

  it("stores a locked-but-available unit as level 0 and never a super troop", () => {
    // Equipment the account never acquired is not "locked".
    expect(units.some((u) => u.group === "equipment" && u.level === 0)).toBe(false);
    expect(units.some((u) => u.group === "superTroop" && u.level === 0)).toBe(false);
  });
});

describe("behindPreviousHall", () => {
  const king = (level: number) =>
    unit({ name: "Barbarian King", group: "hero", level, cap: 100, apiMax: 110 });

  it("lists a unit below the previous Town Hall's cap", () => {
    // The TH16 King cap is 95.
    const result = behindPreviousHall([king(80)], "home", 17);
    expect(result).toEqual([
      { group: "hero", label: "Heroes", units: [{ name: "Barbarian King", level: 80, previousCap: 95 }] },
    ]);
  });

  it("says nothing about a unit at or above it", () => {
    expect(behindPreviousHall([king(95)], "home", 17)).toEqual([]);
  });

  it("has nothing to say at hall 1, or with no hall", () => {
    expect(behindPreviousHall([king(1)], "home", 1)).toEqual([]);
    expect(behindPreviousHall([king(1)], "home", undefined)).toEqual([]);
  });

  it("ignores equipment and units the data does not know", () => {
    expect(
      behindPreviousHall(
        [
          unit({ name: "Spiky Ball", group: "equipment", level: 1, cap: 27 }),
          unit({ name: "Some Future Troop", level: 1, cap: 9 }),
        ],
        "home",
        17,
      ),
    ).toEqual([]);
  });
});

describe("upgradesBetween", () => {
  it("lists what went up, including a newly unlocked unit from 0", () => {
    const older = [unit({ name: "Archer", level: 9 }), unit({ name: "Barbarian", level: 5 })];
    const newer = [
      unit({ name: "Archer", level: 10 }),
      unit({ name: "Barbarian", level: 5 }),
      unit({ name: "Healer", level: 1 }),
    ];
    expect(upgradesBetween(older, newer).map((u) => [u.name, u.from, u.to])).toEqual([
      ["Archer", 9, 10],
      ["Healer", 0, 1],
    ]);
  });

  it("does not confuse the two Baby Dragons", () => {
    const older = [
      unit({ name: "Baby Dragon", level: 10 }),
      unit({ name: "Baby Dragon", level: 20, village: "builder", group: "builderTroop" }),
    ];
    const newer = [
      unit({ name: "Baby Dragon", level: 10 }),
      unit({ name: "Baby Dragon", level: 20, village: "builder", group: "builderTroop" }),
    ];
    expect(upgradesBetween(older, newer)).toEqual([]);
  });
});
