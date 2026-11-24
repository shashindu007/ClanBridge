// A new Town Hall before the game data has every cap for it (TH19, while
// coc.py stops at TH18), saved exports read against newer data, and merges.
//
// The failure these pin is quiet: nothing crashes, the page just says "Maxed"
// and "100%" for a base whose caps nobody knows yet.

import { describe, expect, it } from "vitest";
import { parseVillageExport, refreshVillage } from "@/integration/village-export";
import { pendingCount, remainingUpgrades } from "@/services/upgrades";
import { applyTracked, markUpgraded, type TrackedUpgrade } from "@/services/village-overlay";
import { buildingTally, exportSummary } from "@/services/village";
import type { ExportedVillage } from "@/types/village";

const EXPORTED_AT = 1_789_000_000;
const AT_EXPORT = new Date(EXPORTED_AT * 1000);
const hours = (n: number) => new Date(AT_EXPORT.getTime() + n * 3_600_000);

const TOWN_HALL = 1000001;
const BUILDERS_HUT = 1000015;
const CANNON = 1000008;
const ARCHER_TOWER = 1000009;
const SQUAD_BARRACKS = 1000106;

function village(th: number, buildings: unknown[], extra: Record<string, unknown> = {}): ExportedVillage {
  const parsed = parseVillageExport(
    JSON.stringify({
      tag: "#PY0LQGRJ",
      timestamp: EXPORTED_AT,
      buildings: [{ data: TOWN_HALL, lvl: th }, { data: BUILDERS_HUT, lvl: 1, cnt: 6 }, ...buildings],
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
    fromLevel: 21,
    workshop: "builders",
    boostPct: 0,
    startedAt: AT_EXPORT.toISOString(),
    endsAt: hours(1).toISOString(),
    ...over,
  };
}

describe("a TH19 base while the data has only some TH19 caps", () => {
  const onlyCannons = village(19, [{ data: CANNON, lvl: 21, cnt: 7 }]);
  const withSquads = village(19, [
    { data: CANNON, lvl: 21, cnt: 7 },
    { data: SQUAD_BARRACKS, lvl: 3 },
  ]);

  it("marks a building whose TH19 cap is unknown as pending, never maxed", () => {
    const cannon = onlyCannons.buildings.find((b) => b.name === "Cannon")!;
    expect(cannon).toMatchObject({ cap: null, capPending: true });
    expect(buildingTally([cannon])).toMatchObject({ pct: null, pending: 1 });
  });

  it("says nothing is measured, rather than 100%, when nothing can be", () => {
    const summary = exportSummary(onlyCannons, hours(1));
    expect(summary.buildingsPct).toBeNull();
    expect(summary.buildingsPending).toBeGreaterThan(0);
  });

  it("still measures what the data does know at TH19", () => {
    expect(withSquads.buildings.find((b) => b.name === "Squad Barracks")).toMatchObject({ cap: 12 });
    const summary = exportSummary(withSquads, hours(1));
    expect(summary.buildingsPct).toBe(25); // 3 of 12
    expect(summary.buildingsPending).toBeGreaterThan(0);
  });

  it("does not offer upgrades against a cap it does not know, and counts them instead", () => {
    const items = remainingUpgrades(onlyCannons, "home", hours(1));
    expect(items.some((i) => i.name === "Cannon")).toBe(false);
    expect(pendingCount(onlyCannons, "home")).toBeGreaterThan(0);
    // A TH18 base the data fully knows has nothing pending.
    expect(pendingCount(village(18, [{ data: CANNON, lvl: 21, cnt: 7 }]), "home")).toBe(0);
  });

  it("knows the TH19 hero caps", () => {
    const v = village(19, [], { heroes: [{ data: 28000000, lvl: 112 }] });
    expect(v.units.find((u) => u.name === "Barbarian King")).toMatchObject({ cap: 115, capKnown: true });
  });
});

describe("refreshVillage — a saved export read against newer game data", () => {
  it("names what was saved as unknown, and re-reads every cap", () => {
    const fresh = village(19, [{ data: SQUAD_BARRACKS, lvl: 3, timer: 3_600 }], {
      heroes: [{ data: 28000000, lvl: 108 }],
    });
    // As it was saved before the data knew TH19 or the Squad Barracks.
    const saved: ExportedVillage = {
      ...fresh,
      buildings: fresh.buildings.map((b) =>
        b.name === "Squad Barracks" ? { ...b, name: `Unknown #${SQUAD_BARRACKS}`, kind: "Other", cap: null, capPending: true } : b,
      ),
      units: fresh.units.map((u) => (u.name === "Barbarian King" ? { ...u, cap: 110, apiMax: 110, capKnown: false } : u)),
      upgrades: fresh.upgrades.map((u) => ({ ...u, name: `Unknown #${SQUAD_BARRACKS}` })),
      unknownIds: 1,
    };

    const read = refreshVillage(saved);
    expect(read.buildings.find((b) => b.name === "Squad Barracks")).toMatchObject({ kind: "Army", cap: 12 });
    expect(read.buildings.find((b) => b.name === "Squad Barracks")?.capPending).toBeUndefined();
    expect(read.upgrades[0]?.name).toBe("Squad Barracks");
    expect(read.units.find((u) => u.name === "Barbarian King")).toMatchObject({ cap: 115, capKnown: true });
    expect(read.unknownIds).toBe(0);
  });

  it("is idempotent and keeps the member's counts and levels", () => {
    const v = village(18, [{ data: CANNON, lvl: 20, cnt: 3 }]);
    expect(refreshVillage(refreshVillage(v))).toEqual(refreshVillage(v));
    expect(refreshVillage(v).buildings.find((b) => b.name === "Cannon")?.levels).toEqual({ 20: 3 });
  });
});

describe("a Town Hall upgrade that finishes", () => {
  it("moves the hall, and every cap with it", () => {
    const v = village(18, [{ data: CANNON, lvl: 21, cnt: 7 }]);
    const o = applyTracked(v, [tracked({ subject: "Town Hall", fromLevel: 18 })], hours(2));
    expect(o.stored.thLevel).toBe(19);
    // A TH18 Cannon cap was known; at TH19 it is not yet.
    expect(o.stored.buildings.find((b) => b.name === "Cannon")).toMatchObject({ capPending: true });
  });
});

describe("merges", () => {
  // TH17: two Cannons and one Archer Tower at 21. The Ricochet Cannon wants
  // both Cannons; the Multi-Gear Tower one Cannon and the Archer Tower.
  const v = village(17, [
    { data: CANNON, lvl: 21, cnt: 2 },
    { data: ARCHER_TOWER, lvl: 21 },
  ]);

  it("does not offer two merges the same sources", () => {
    const items = remainingUpgrades(v, "home", hours(1));
    const merges = items.filter((i) => i.action === "merge" && ["Ricochet Cannon", "Multi-Gear Tower"].includes(i.name));
    expect(merges).toHaveLength(2);
    expect(merges.filter((i) => !i.blocked)).toHaveLength(1);
    expect(merges.reduce((sum, i) => sum + (i.ready ?? 0), 0)).toBe(1);
  });

  it("will not mark more merges done than the sources allow", () => {
    const ref = { village: "home" as const, subjectType: "building" as const, subject: "Ricochet Cannon", fromLevel: 0 };
    expect(markUpgraded(v, ref, 2)).toBeNull();
    const one = markUpgraded(v, ref, 1)!;
    expect(one.buildings.find((b) => b.name === "Ricochet Cannon")?.levels).toEqual({ 1: 1 });
    expect(one.buildings.find((b) => b.name === "Cannon")).toMatchObject({ count: 0, levels: {} });
  });

  it("never consumes sources below the merge level", () => {
    const low = village(17, [{ data: CANNON, lvl: 20, cnt: 2 }]);
    const o = applyTracked(low, [tracked({ subject: "Ricochet Cannon", fromLevel: 0 })], hours(2));
    expect(o.ignored).toHaveLength(1);
    expect(o.stored.buildings.find((b) => b.name === "Cannon")?.levels).toEqual({ 20: 2 });
    expect(o.stored.buildings.some((b) => b.name === "Ricochet Cannon")).toBe(false);
  });
});

describe("the Town Hall row's timer", () => {
  // village-export.ts reads any timer on the Town Hall row as the HALL being
  // upgraded. If the game puts a weapon upgrade's timer on that row too,
  // finishing it would level the hall instead of the weapon. Needs one real
  // export taken during a weapon upgrade to settle; until then, unchanged.
  it.todo("tells a Town Hall weapon upgrade from a Town Hall upgrade");
});
