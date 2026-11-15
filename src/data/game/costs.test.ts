// The generated price table (upgrade-costs.json), counts and merges.
//
// Spot values are the game's own, checked against coc.py and clashofclans.js at
// the pinned versions. The coverage test is the one that matters on a game
// update: a building or unit the caps say exists, with a level the table cannot
// price, means the generator dropped something.

import { describe, expect, it } from "vitest";
import costsFile from "./upgrade-costs.json";
import { buildingByName, countAt, findUnit, GROUP_ORDER } from "@/data/game";
import { upgradeStep, weaponAt } from "@/data/game/costs";
import buildingsFile from "./buildings.json";
import unitsFile from "./units.json";

describe("upgradeStep — the price of REACHING a level", () => {
  it("prices a building level as coc.py does", () => {
    expect(upgradeStep("building", "Cannon", "home", 1)).toEqual({
      level: 1,
      cost: [{ resource: "gold", amount: 250 }],
      seconds: 5,
    });
  });

  it("shifts a unit's price by one: reaching 2 is the cost of leaving 1", () => {
    // raw.json's first Barbarian King entry is level 1 → 2.
    expect(upgradeStep("unit", "Barbarian King", "home", 2)).toEqual({
      level: 2,
      cost: [{ resource: "dark", amount: 5_000 }],
      seconds: 7_200,
    });
    // A unit's level 1 comes with its building, never with an upgrade.
    expect(upgradeStep("unit", "Barbarian King", "home", 1)).toBeNull();
  });

  it("offers elixir for walls from level 5, and not before", () => {
    expect(upgradeStep("building", "Wall", "home", 4)?.alt).toBeUndefined();
    expect(upgradeStep("building", "Wall", "home", 5)?.alt).toEqual({ resource: "elixir", amount: 20_000 });
  });

  it("prices equipment in ores, leaving out the ones a level does not need", () => {
    const step = upgradeStep("unit", "Giant Gauntlet", "home", 3);
    expect(step?.cost).toEqual([
      { resource: "shiny", amount: 240 },
      { resource: "glowy", amount: 20 },
    ]);
    expect(step?.seconds).toBe(0);
  });

  it("knows the TH17 weapon and its levels", () => {
    expect(weaponAt(17)).toBe("Inferno Artillery");
    expect(weaponAt(16)).toBeNull();
    expect(upgradeStep("weapon", "Inferno Artillery", "home", 2)?.seconds).toBe(518_400);
  });

  it("keeps the Builder Base apart from the home village", () => {
    expect(upgradeStep("building", "Cannon", "builder", 1)?.cost).toEqual([{ resource: "builderGold", amount: 10_000 }]);
  });

  it("answers null, never a guess, for something it does not know", () => {
    expect(upgradeStep("building", "Not A Building", "home", 1)).toBeNull();
    expect(upgradeStep("building", "Cannon", "home", 99)).toBeNull();
  });
});

describe("coverage — every level the caps allow has a price", () => {
  const rows = costsFile.costs as Array<{ type: string; name: string; village: string; levels: unknown[] }>;
  const byKey = new Map(rows.map((r) => [`${r.type}:${r.village}:${r.name}`, r]));

  it("prices every building and trap level up to its highest cap", () => {
    const missing: string[] = [];
    for (const b of buildingsFile.buildings) {
      const max = Math.max(...b.caps);
      if (max < 1 || b.kind.startsWith("Town Hall")) continue;
      const row = byKey.get(`building:${b.village}:${b.name}`);
      for (let L = 1; L <= max; L++) if (!row?.levels[L - 1]) missing.push(`${b.name} ${L}`);
    }
    expect(missing).toEqual([]);
  });

  it("prices every unit level above the first one it can have", () => {
    const missing: string[] = [];
    for (const u of unitsFile.units) {
      const max = Math.max(...u.caps);
      if (u.group === "superTroop" || max < 2) continue;
      const row = byKey.get(`unit:${u.village}:${u.name}`);
      if (!row) {
        missing.push(u.name);
        continue;
      }
      // Builder Base troops unlocked late start high (Hog Glider at 15).
      const first = row.levels.findIndex((l) => l !== null);
      for (let L = first + 1; L <= max; L++) if (!row.levels[L - 1]) missing.push(`${u.name} ${L}`);
    }
    expect(missing).toEqual([]);
  });

  it("has a group for every unit it prices", () => {
    for (const r of rows.filter((r) => r.type === "unit")) {
      const unit = findUnit(r.name, r.village as "home" | "builder");
      expect(unit && GROUP_ORDER.includes(unit.group), r.name).toBeTruthy();
    }
  });
});

describe("counts and merges", () => {
  it("counts what each Town Hall allows, from its unlocks", () => {
    const cannon = buildingByName("Cannon", "home")!;
    expect(countAt(cannon, 9)).toBe(5);
    expect(countAt(cannon, 17)).toBe(7);
  });

  it("drops a building the Town Hall itself swallows", () => {
    // TH17 merges the Eagle Artillery into the Town Hall.
    expect(countAt(buildingByName("Eagle Artillery", "home")!, 16)).toBe(1);
    expect(countAt(buildingByName("Eagle Artillery", "home")!, 17)).toBe(0);
  });

  it("reads merges from the data, not from a list kept here", () => {
    expect(buildingByName("Ricochet Cannon", "home")?.merge).toEqual([{ name: "Cannon", n: 2, level: 21 }]);
    expect(buildingByName("Multi-Gear Tower", "home")?.merge).toEqual([
      { name: "Archer Tower", n: 1, level: 21 },
      { name: "Cannon", n: 1, level: 21 },
    ]);
  });

  it("has no count for traps, which the data does not count", () => {
    expect(buildingByName("Bomb", "home")?.counts).toBeUndefined();
  });
});
