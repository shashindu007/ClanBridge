// T11B.3 — the generated game data, checked against a real account.
//
// fixtures/player.json is a real scrubbed TH17 capture, which makes it the one
// independent witness these numbers have: a real account can never be above
// the cap for its own Town Hall, so any unit that is means the data is wrong.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { playerSchema } from "@/integration/coc-schemas";
import { mapPlayerProgress } from "@/integration/mappers";
import {
  BUILDER_HALLS,
  HOME_HALLS,
  buildingByExportId,
  capAt,
  findUnit,
  resolveUnit,
  unitByExportId,
  type UnitSource,
} from "./index";
import unitsFile from "./units.json";
import buildingsFile from "./buildings.json";

const progress = mapPlayerProgress(
  playerSchema.parse(JSON.parse(readFileSync(join(process.cwd(), "fixtures", "player.json"), "utf8"))),
);

const everyUnit: Array<[UnitSource, (typeof progress)["troops"]]> = [
  ["heroes", progress.heroes],
  ["equipment", progress.equipment],
  ["troops", progress.troops],
  ["spells", progress.spells],
];

describe("game data (T11B.3)", () => {
  it("covers every hall level", () => {
    expect(HOME_HALLS).toBeGreaterThanOrEqual(17);
    expect(BUILDER_HALLS).toBe(10);
    for (const u of unitsFile.units) {
      expect(u.caps).toHaveLength(u.village === "home" ? HOME_HALLS : BUILDER_HALLS);
    }
  });

  it("gives every unit and building a unique export id", () => {
    const units = unitsFile.units.map((u) => u.exportId);
    const buildings = buildingsFile.buildings.map((b) => b.exportId);
    expect(new Set(units).size).toBe(units.length);
    expect(new Set(buildings).size).toBe(buildings.length);
  });

  it("puts no unit of a real TH17 / BH10 account above its hall cap", () => {
    const over: string[] = [];
    for (const [, units] of everyUnit) {
      for (const unit of units) {
        const data = findUnit(unit.name, unit.village);
        if (!data) continue; // newer than the data — covered by the fallback test
        const hall = unit.village === "home" ? progress.thLevel : progress.bhLevel;
        const cap = capAt(data.caps, hall)!;
        if (unit.level > cap) over.push(`${unit.name} ${unit.level} > ${cap}`);
      }
    }
    expect(over).toEqual([]);
  });

  it("knows almost every unit the real account has", () => {
    const unknown = everyUnit.flatMap(([, units]) =>
      units.filter((u) => !findUnit(u.name, u.village)).map((u) => u.name),
    );
    // A handful of units newer than the pinned data is expected and handled.
    // Dozens means a pin is badly out of date, or the name key broke.
    expect(unknown.length).toBeLessThanOrEqual(5);
  });

  // The specific numbers the plan was built on, pinned.
  it("caps a TH17 Barbarian King at 100 and a BH10 Raged Barbarian at 20", () => {
    expect(capAt(findUnit("Barbarian King", "home")!.caps, 17)).toBe(100);
    expect(capAt(findUnit("Raged Barbarian", "builder")!.caps, 10)).toBe(20);
  });

  it("tells pets, siege machines and super troops apart from troops", () => {
    expect(findUnit("L.A.S.S.I", "home")!.group).toBe("pet");
    expect(findUnit("Wall Wrecker", "home")!.group).toBe("siege");
    expect(findUnit("Super Barbarian", "home")!.group).toBe("superTroop");
    expect(findUnit("Hog Rider", "home")!.group).toBe("darkTroop");
    expect(findUnit("Baby Dragon", "builder")!.group).toBe("builderTroop");
    expect(findUnit("Spiky Ball", "home")!.hero).toBe("Barbarian King");
  });

  it("resolves the export's numeric ids", () => {
    expect(unitByExportId(4000000)!.name).toBe("Barbarian");
    expect(unitByExportId(28000000)!.name).toBe("Barbarian King");
    expect(buildingByExportId(1000001)!.name).toBe("Town Hall");
  });
});

describe("resolveUnit", () => {
  const king = { name: "Barbarian King", level: 100, apiMax: 110, village: "home" as const };

  it("uses the Town Hall cap, not the game maximum", () => {
    const resolved = resolveUnit(king, "heroes", 17);
    expect(resolved).toMatchObject({ group: "hero", cap: 100, capKnown: true });
  });

  it("falls back to the game maximum for a unit newer than the data", () => {
    const resolved = resolveUnit(
      { name: "Some Future Troop", level: 3, apiMax: 9, village: "home" },
      "troops",
      17,
    );
    expect(resolved).toMatchObject({ group: "elixirTroop", cap: 9, capKnown: false });
  });

  it("falls back when the hall level is unknown", () => {
    expect(resolveUnit(king, "heroes", undefined)).toMatchObject({ cap: 110, capKnown: false });
  });

  // A player above the data's cap proves the data is stale. Showing 105% would
  // be wrong and showing 100% would hide it; the game maximum plus a flag is honest.
  it("falls back when the player is above the data's cap", () => {
    const resolved = resolveUnit({ ...king, level: 104 }, "heroes", 17);
    expect(resolved).toMatchObject({ cap: 110, capKnown: false });
  });
});
