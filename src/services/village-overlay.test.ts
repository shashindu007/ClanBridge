// The overlay: a saved export plus tracked timers, as the village stands now.

import { describe, expect, it } from "vitest";
import { parseVillageExport } from "@/integration/village-export";
import { applyTracked, markUpgraded, type TrackedUpgrade } from "@/services/village-overlay";
import { exportSummary, workshops } from "@/services/village";
import type { ExportedVillage } from "@/types/village";

const EXPORTED_AT = 1_789_000_000;
const AT_EXPORT = new Date(EXPORTED_AT * 1000);
const hours = (n: number) => new Date(AT_EXPORT.getTime() + n * 3_600_000);

/** TH17, five builders, two Cannons at 19 (one upgrading for 2h), walls, a lab and a King. */
function village(extra: Record<string, unknown> = {}): ExportedVillage {
  const parsed = parseVillageExport(
    JSON.stringify({
      tag: "#PY0LQGRJ",
      timestamp: EXPORTED_AT,
      buildings: [
        { data: 1000001, lvl: 17 },
        { data: 1000015, lvl: 1, cnt: 5 },
        { data: 1000007, lvl: 14 },
        { data: 1000008, lvl: 19 },
        { data: 1000008, lvl: 19, timer: 7_200 },
        { data: 1000010, lvl: 16, cnt: 100 },
        { data: 1000009, lvl: 21, cnt: 4 },
      ],
      heroes: [{ data: 28000000, lvl: 90 }],
      ...extra,
    }),
    AT_EXPORT,
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.village;
}

let n = 0;
function tracked(over: Partial<TrackedUpgrade>): TrackedUpgrade {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    village: "home",
    subjectType: "building",
    subject: "Cannon",
    fromLevel: 19,
    workshop: "builders",
    boostPct: 0,
    startedAt: AT_EXPORT.toISOString(),
    endsAt: hours(1).toISOString(),
    ...over,
  };
}

const cannon = (v: ExportedVillage) => v.buildings.find((b) => b.name === "Cannon")!;

describe("applyTracked — the export's own timers", () => {
  it("levels up an exported upgrade once its timer has run out", () => {
    const o = applyTracked(village(), [], hours(3));
    expect(cannon(o.village).levels).toEqual({ 19: 1, 20: 1 });
    expect(cannon(o.village).upgrading).toBe(0);
    expect(o.village.upgrades).toEqual([]);
    expect(o.village.appliedSince).toBe(1);
    expect(o.levelledUp).toEqual([{ name: "Cannon", village: "home", toLevel: 20, source: "export" }]);
    expect(o.changed).toBe(true);
  });

  it("leaves a running export timer alone", () => {
    const o = applyTracked(village(), [], hours(1));
    expect(cannon(o.village).levels).toEqual({ 19: 2 });
    expect(o.village.upgrades).toHaveLength(1);
    expect(o.changed).toBe(false);
  });

  it("counts the levels it applied as finished since the export, on Home too", () => {
    const o = applyTracked(village(), [], hours(3));
    expect(exportSummary(o.village, hours(3)).finishedSince).toBe(1);
  });
});

describe("applyTracked — timers started here", () => {
  it("shows a running timer as a busy builder, but never stores it in the export", () => {
    const o = applyTracked(village(), [tracked({ endsAt: hours(5).toISOString() })], hours(1));

    const running = o.village.upgrades.find((u) => u.source === "tracked");
    expect(running).toMatchObject({ name: "Cannon", fromLevel: 19, workshop: "builders" });
    expect(workshops(o.village, "home", hours(1)).find((w) => w.key === "builders")?.busy).toBe(2);

    expect(o.stored.upgrades.some((u) => u.source === "tracked")).toBe(false);
    expect(o.foldIds).toEqual([]);
  });

  it("levels up a finished timer and hands it to the fold", () => {
    const t = tracked({ endsAt: hours(1).toISOString() });
    const o = applyTracked(village(), [t], hours(1.5));
    expect(cannon(o.stored).levels).toEqual({ 19: 1, 20: 1 });
    expect(o.foldIds).toEqual([t.id]);
    expect(o.ignored).toEqual([]);
  });

  it("drops a timer the export contradicts rather than inventing a level", () => {
    // Nothing is at level 18, so "18 → 19" cannot have happened here.
    const t = tracked({ fromLevel: 18 });
    // Before the export's own 2h Cannon timer ends, so nothing else moves.
    const o = applyTracked(village(), [t], hours(1.5));
    expect(cannon(o.stored).levels).toEqual({ 19: 2 });
    expect(o.ignored).toEqual([t.id]);
    expect(o.foldIds).toEqual([t.id]);
  });

  it("applies chained timers in finish order", () => {
    const first = tracked({ endsAt: hours(1).toISOString() });
    const second = tracked({ fromLevel: 20, endsAt: hours(2).toISOString() });
    const o = applyTracked(village(), [second, first], hours(2.5));
    // The export's own timer also finished at 2h.
    expect(cannon(o.stored).levels).toEqual({ 20: 1, 21: 1 });
  });

  it("levels a hero and the Town Hall weapon", () => {
    const o = applyTracked(
      village({ buildings: [{ data: 1000001, lvl: 17, weapon: 2 }] }),
      [
        tracked({ subjectType: "unit", subject: "Barbarian King", fromLevel: 90 }),
        tracked({ subjectType: "weapon", subject: "Inferno Artillery", fromLevel: 2 }),
      ],
      hours(2),
    );
    expect(o.stored.units.find((u) => u.name === "Barbarian King")?.level).toBe(91);
    expect(o.stored.thWeapon).toBe(3);
  });

  it("builds a merged building from what it consumes", () => {
    const o = applyTracked(
      village(),
      [tracked({ subject: "Multi-Archer Tower", fromLevel: 0 })],
      hours(2),
    );
    expect(o.stored.buildings.find((b) => b.name === "Multi-Archer Tower")?.levels).toEqual({ 1: 1 });
    const towers = o.stored.buildings.find((b) => b.name === "Archer Tower")!;
    expect(towers.count).toBe(2);
    expect(towers.levels).toEqual({ 21: 2 });
  });

  it("does not change the export it was given", () => {
    const v = village();
    const before = JSON.stringify(v);
    applyTracked(v, [tracked({})], hours(3));
    expect(JSON.stringify(v)).toBe(before);
  });
});

describe("markUpgraded — instant upgrades and ones done without a timer", () => {
  it("moves that many walls up a level", () => {
    const next = markUpgraded(village(), { village: "home", subjectType: "building", subject: "Wall", fromLevel: 16 }, 30)!;
    expect(next.buildings.find((b) => b.name === "Wall")?.levels).toEqual({ 16: 70, 17: 30 });
    expect(next.appliedSince).toBe(30);
  });

  it("refuses more than there are", () => {
    expect(
      markUpgraded(village(), { village: "home", subjectType: "building", subject: "Wall", fromLevel: 16 }, 101),
    ).toBeNull();
  });
});

describe("applyTracked — the API confirms a unit upgrade early (Phase E)", () => {
  const king = (over: Partial<TrackedUpgrade> = {}) =>
    tracked({ subjectType: "unit", subject: "Barbarian King", fromLevel: 90, endsAt: hours(5).toISOString(), ...over });
  const reading = (level: number, capturedAt = hours(0.5)) => ({
    capturedAt: capturedAt.toISOString(),
    units: [{ name: "Barbarian King", village: "home" as const, level }],
  });

  it("finishes a running timer when the reading shows the next level", () => {
    const t = king();
    const o = applyTracked(village(), [t], hours(1), reading(91));
    expect(o.stored.units.find((u) => u.name === "Barbarian King")?.level).toBe(91);
    expect(o.levelledUp).toContainEqual({ name: "Barbarian King", village: "home", toLevel: 91, source: "api" });
    expect(o.foldIds).toEqual([t.id]);
    expect(o.village.upgrades.some((u) => u.source === "tracked")).toBe(false);
  });

  it("leaves the timer running without a reading, or while the reading is still the old level", () => {
    const t = king();
    expect(applyTracked(village(), [t], hours(1)).foldIds).toEqual([]);
    expect(applyTracked(village(), [t], hours(1), reading(90)).foldIds).toEqual([]);
    expect(applyTracked(village(), [t], hours(1), null).village.upgrades.some((u) => u.source === "tracked")).toBe(true);
  });

  it("ignores a reading taken before the timer started", () => {
    // The sync read level 91 an hour before this upgrade began: that was an earlier one.
    const t = king({ startedAt: hours(1).toISOString() });
    expect(applyTracked(village(), [t], hours(2), reading(91, hours(0.5))).foldIds).toEqual([]);
  });

  it("does not use the API for buildings, which it cannot see", () => {
    const t = tracked({ endsAt: hours(5).toISOString() });
    const o = applyTracked(village(), [t], hours(1), {
      capturedAt: hours(0.5).toISOString(),
      units: [{ name: "Cannon", village: "home", level: 20 }],
    });
    expect(o.foldIds).toEqual([]);
  });
});

describe("exportSummary — what Home says about builders and the lab", () => {
  it("names the upgrade that frees the next builder when all of them are busy", () => {
    const busy = village({
      buildings: [
        { data: 1000001, lvl: 17 },
        { data: 1000015, lvl: 1, cnt: 2 },
        { data: 1000007, lvl: 14 },
        { data: 1000008, lvl: 19, timer: 7_200 },
        { data: 1000009, lvl: 20, timer: 3_600 },
      ],
    });
    const s = exportSummary(busy, hours(0.5));
    expect(s.builders).toEqual({ busy: 2, total: 2 });
    expect(s.nextBuilderFree).toMatchObject({ name: "Archer Tower", secondsLeft: 1_800 });
  });

  it("says nothing about the next builder while one is free", () => {
    expect(exportSummary(village(), hours(0.5)).nextBuilderFree).toBeNull();
  });

  it("reports the lab as free, or busy with what and for how long", () => {
    expect(exportSummary(village(), hours(0.5)).lab).toEqual({ busy: false, secondsLeft: 0, name: null });

    const brewing = village({ units: [{ data: 4000000, lvl: 11, timer: 5_400 }] });
    expect(exportSummary(brewing, hours(0.5)).lab).toEqual({ busy: true, secondsLeft: 3_600, name: "Barbarian" });
  });
});
