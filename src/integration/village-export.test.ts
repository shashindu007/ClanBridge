// T11B.11 — the village export parser and the arithmetic over it.
//
// ⚠ THE EXPORTS HERE ARE BUILT INLINE, NOT READ FROM fixtures/. fixtures/README.md
// forbids inventing a captured shape by hand, and these are not captures: they
// use only the field names two production parsers read (see the header of
// village-export.ts) and small invented values. A real, scrubbed export from a
// member belongs in fixtures/ as soon as one is available — that is listed as
// outstanding in IMPLEMENTATION.md.

import { describe, expect, it } from "vitest";
import { MAX_EXPORT_BYTES, parseVillageExport } from "./village-export";
import {
  buildingGroups,
  buildingTally,
  capTrusted,
  formatDuration,
} from "@/services/village";
import { groupProgress } from "@/services/progress";
import type { ExportedVillage } from "@/types/village";

const EXPORTED_AT = 1_789_000_000; // unix seconds
const NOW = new Date((EXPORTED_AT + 3_600) * 1000); // one hour after the export

/** A small TH17 village: two cannon rows, walls at two levels, one upgrade running. */
function sampleExport(overrides: Record<string, unknown> = {}) {
  return {
    tag: "#py0lqgrj",
    timestamp: EXPORTED_AT,
    buildings: [
      { data: 1000001, lvl: 17, weapon: 4 }, // Town Hall
      { data: 1000008, lvl: 21, cnt: 5 }, // Cannon x5, maxed
      { data: 1000008, lvl: 20, cnt: 1, timer: 7_200 }, // Cannon upgrading, 2h left at export
      { data: 1000010, lvl: 17, cnt: 200 }, // Wall
      { data: 1000010, lvl: 16, cnt: 125 },
      { data: 1000009, lvl: 21, cnt: 1, gear_up: 1 }, // Archer Tower, geared
      { data: 1009999, lvl: 3 }, // an id newer than the data
    ],
    traps: [{ data: 12000000, lvl: 13, cnt: 6 }], // Bomb
    heroes: [{ data: 28000000, lvl: 95, timer: 86_400 }], // Barbarian King, 1 day left
    pets: [{ data: 73000000, lvl: 15 }],
    units: [{ data: 4000000, lvl: 12 }],
    spells: [{ data: 26000000, lvl: 11 }],
    siege_machines: [{ data: 4000051, lvl: 5 }],
    equipment: [{ data: 90000000, lvl: 18 }],
    buildings2: [
      { data: 1000034, lvl: 10 }, // Builder Hall
      { data: 1000044, lvl: 10, cnt: 2 }, // Cannon (Builder Base)
    ],
    heroes2: [{ data: 28000003, lvl: 35 }], // Battle Machine
    ...overrides,
  };
}

function parse(value: unknown = sampleExport()): ExportedVillage {
  const result = parseVillageExport(JSON.stringify(value), NOW);
  if (!result.ok) throw new Error(result.error);
  return result.village;
}

describe("parseVillageExport — refusing what is not an export", () => {
  it("explains invalid JSON", () => {
    const result = parseVillageExport("{not json", NOW);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("not valid JSON") });
  });

  it("explains JSON that is not a village export, and says where to find one", () => {
    // The official API's player JSON, which is the likeliest wrong paste.
    const result = parseVillageExport(JSON.stringify({ tag: "#PY0LQGRJ", name: "x", troops: [] }), NOW);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Data Export") });
  });

  it("refuses a paste far too large to be an export, before parsing it", () => {
    const result = parseVillageExport("x".repeat(MAX_EXPORT_BYTES + 1), NOW);
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("too long") });
  });

  it("refuses a tag that could not be real", () => {
    const result = parseVillageExport(JSON.stringify(sampleExport({ tag: "#AAAA" })), NOW);
    expect(result.ok).toBe(false);
  });

  it("tolerates fields it has never heard of (looseObject)", () => {
    expect(() => parse(sampleExport({ house_parts: [1, 2], boosts: {} }))).not.toThrow();
  });
});

describe("mapVillageExport", () => {
  const village = parse();

  it("normalises the tag and reads both halls from their buildings", () => {
    expect(village.tag).toBe("#PY0LQGRJ");
    expect(village.thLevel).toBe(17);
    expect(village.bhLevel).toBe(10);
    expect(village.exportedAt).toBe(new Date(EXPORTED_AT * 1000).toISOString());
  });

  it("aggregates instances of one building across rows and counts levels", () => {
    const cannon = village.buildings.find((b) => b.name === "Cannon" && b.village === "home")!;
    expect(cannon).toMatchObject({ count: 6, levels: { 20: 1, 21: 5 }, upgrading: 1, cap: 21 });

    const walls = village.buildings.find((b) => b.kind === "Wall" && b.village === "home")!;
    expect(walls.count).toBe(325);
    expect(walls.levels).toEqual({ 16: 125, 17: 200 });
  });

  it("keeps the two villages' Cannons apart", () => {
    const builderCannon = village.buildings.find((b) => b.name === "Cannon" && b.village === "builder")!;
    expect(builderCannon).toMatchObject({ count: 2, cap: 10 });
  });

  it("counts geared-up buildings", () => {
    expect(village.buildings.find((b) => b.name === "Archer Tower")!.geared).toBe(1);
  });

  it("shows an id newer than the data by number, and counts it", () => {
    expect(village.buildings.some((b) => b.name === "Unknown #1009999")).toBe(true);
    expect(village.unknownIds).toBe(1);
  });

  // The timer is seconds left AT EXPORT. Pasted an hour later, an hour is gone.
  it("counts upgrade time down from the export's timestamp, soonest first", () => {
    expect(village.upgrades.map((u) => [u.name, u.fromLevel, u.remainingSeconds])).toEqual([
      ["Cannon", 20, 3_600],
      ["Barbarian King", 95, 82_800],
    ]);
  });

  it("treats an upgrade that finished since the export as done, not negative", () => {
    const later = parseVillageExport(JSON.stringify(sampleExport()), new Date((EXPORTED_AT + 10 * 86_400) * 1000));
    expect(later.ok && later.village.upgrades.every((u) => u.remainingSeconds === 0)).toBe(true);
  });

  it("resolves units with the same Town Hall caps the sync job uses", () => {
    const king = village.units.find((u) => u.name === "Barbarian King")!;
    expect(king).toMatchObject({ group: "hero", level: 95, cap: 100, capKnown: true });

    const machine = village.units.find((u) => u.name === "Battle Machine")!;
    expect(machine).toMatchObject({ village: "builder", group: "builderHero", cap: 35 });

    const heroes = groupProgress(village.units, "home").find((g) => g.group === "hero")!;
    expect(heroes.pct).toBe(95);
  });
});

describe("services/village", () => {
  const village = parse();

  it("sums levels per instance against the cap", () => {
    const cannon = village.buildings.find((b) => b.name === "Cannon" && b.village === "home")!;
    // 5 × 21 + 1 × 20 of 6 × 21.
    expect(buildingTally([cannon])).toEqual({ done: 125, total: 126, pct: 99.2 });
  });

  it("groups by kind, leaves the halls out, and counts what it cannot measure", () => {
    const groups = buildingGroups(village, "home");
    expect(groups.map((g) => g.key)).toEqual(["defenses", "traps", "walls", "army"]);
    expect(groups.flatMap((g) => g.buildings).some((b) => b.name === "Town Hall")).toBe(false);
    // The unknown id lands under "army", uncounted.
    expect(groups.find((g) => g.key === "army")!.uncounted).toBe(1);
  });

  it("does not trust a cap an instance is above", () => {
    const stale = { ...village.buildings[0]!, cap: 10, levels: { 12: 1 } };
    expect(capTrusted(stale)).toBe(false);
    expect(buildingTally([stale])).toEqual({ done: 0, total: 0, pct: 100 });
  });

  it.each([
    [0, "done"],
    [30, "under a minute"],
    [45 * 60, "45m"],
    [5 * 3_600 + 12 * 60, "5h 12m"],
    [3 * 3_600, "3h"],
    [3 * 86_400 + 4 * 3_600 + 59 * 60, "3d 4h"],
    [2 * 86_400, "2d"],
  ])("formats %i seconds as %s", (seconds, text) => {
    expect(formatDuration(seconds)).toBe(text);
  });
});
