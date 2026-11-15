// "Upgrades left": what remains for a hall, with prices — and its totals.

import { describe, expect, it } from "vitest";
import { parseVillageExport } from "@/integration/village-export";
import { remainingUpgrades, runningLoads } from "@/services/upgrades";
import {
  boosted,
  formatAmount,
  formatLong,
  itemTotal,
  remainingTotals,
  sortItems,
  type RemainingItem,
} from "@/services/upgrade-time";
import { applyTracked } from "@/services/village-overlay";
import type { ExportedVillage } from "@/types/village";

const EXPORTED_AT = 1_789_000_000;
const NOW = new Date(EXPORTED_AT * 1000 + 3_600_000);

function village(buildings: unknown[], extra: Record<string, unknown> = {}): ExportedVillage {
  const parsed = parseVillageExport(
    JSON.stringify({
      tag: "#PY0LQGRJ",
      timestamp: EXPORTED_AT,
      buildings: [{ data: 1000001, lvl: 17, weapon: 3 }, { data: 1000015, lvl: 1, cnt: 5 }, ...buildings],
      ...extra,
    }),
    new Date(EXPORTED_AT * 1000),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.village;
}

const find = (items: RemainingItem[], name: string, from?: number) =>
  items.find((i) => i.name === name && (from === undefined || i.fromLevel === from));

describe("remainingUpgrades", () => {
  const v = village(
    [
      { data: 1000008, lvl: 19, cnt: 2 },
      { data: 1000008, lvl: 20, timer: 86_400 },
      { data: 1000010, lvl: 16, cnt: 100 },
      { data: 1000007, lvl: 14 },
    ],
    { heroes: [{ data: 28000000, lvl: 90 }], units: [{ data: 4000000, lvl: 11 }] },
  );
  const items = remainingUpgrades(v, "home", NOW);

  it("has one line per subject and level, priced to this hall's cap", () => {
    const at19 = find(items, "Cannon", 19)!;
    expect(at19).toMatchObject({ tab: "builders", workshop: "builders", idle: 2, busy: 0, cap: 21, action: "upgrade" });
    expect(at19.steps.map((s) => s?.level)).toEqual([20, 21]);
    expect(at19.steps[0]?.cost[0]?.resource).toBe("gold");
  });

  it("knows an instance that is already upgrading", () => {
    expect(find(items, "Cannon", 20)).toMatchObject({ idle: 0, busy: 1 });
  });

  it("puts walls on their own tab, with no builder", () => {
    expect(find(items, "Wall", 16)).toMatchObject({ tab: "walls", workshop: null, idle: 100 });
  });

  it("lists buildings the hall allows that are not built, after merges", () => {
    // TH17 allows 7 Cannons; 3 are built and none merged yet.
    expect(find(items, "Cannon", 0)).toMatchObject({ action: "build", idle: 4 });
    expect(find(items, "Ricochet Cannon", 0)).toMatchObject({
      action: "merge",
      merge: [{ name: "Cannon", n: 2, level: 21 }],
    });
  });

  it("sends heroes to the builders and troops to the lab", () => {
    expect(find(items, "Barbarian King")).toMatchObject({ tab: "builders", workshop: "builders", cap: 100 });
    expect(find(items, "Barbarian")).toMatchObject({ tab: "lab", workshop: "lab" });
  });

  it("lists what the hall allows but is not unlocked, as locked", () => {
    expect(find(items, "Archer Queen")).toMatchObject({ locked: true, fromLevel: 0 });
  });

  it("includes the Town Hall weapon when the export says its level", () => {
    expect(find(items, "Inferno Artillery")).toMatchObject({ subjectType: "weapon", fromLevel: 3, cap: 5 });
  });

  it("never lists the hall itself", () => {
    expect(find(items, "Town Hall")).toBeUndefined();
  });

  it("is empty when the hall is unknown", () => {
    expect(remainingUpgrades({ ...v, thLevel: null }, "home", NOW)).toEqual([]);
  });

  it("takes timers started here into account through the overlay", () => {
    const o = applyTracked(
      v,
      [
        {
          id: "00000000-0000-4000-8000-000000000001",
          village: "home",
          subjectType: "building",
          subject: "Cannon",
          fromLevel: 19,
          workshop: "builders",
          boostPct: 0,
          startedAt: NOW.toISOString(),
          endsAt: new Date(NOW.getTime() + 7_200_000).toISOString(),
        },
      ],
      NOW,
    );
    expect(find(remainingUpgrades(o.village, "home", NOW), "Cannon", 19)).toMatchObject({ idle: 1, busy: 1 });
    expect(runningLoads(o.village, "home", NOW).builders.sort((a, b) => a - b)).toEqual([7_200, 82_800]);
  });
});

describe("totals", () => {
  const step = (seconds: number, amount = 1_000) => ({
    level: 2,
    cost: [{ resource: "gold" as const, amount }],
    seconds,
  });
  const item = (over: Partial<RemainingItem>): RemainingItem => ({
    key: over.name ?? "x",
    subjectType: "building",
    name: "Cannon",
    village: "home",
    tab: "builders",
    workshop: "builders",
    fromLevel: 1,
    cap: 3,
    idle: 1,
    busy: 0,
    action: "upgrade",
    steps: [step(100), step(200)],
    ...over,
  });

  it("charges a busy instance only for the steps after the one it is on", () => {
    expect(itemTotal(item({ idle: 1, busy: 1 }), 0)).toEqual({ cost: { gold: 3_000 }, seconds: 500, unpriced: 0 });
  });

  it("schedules chains longest-first over the builders it has", () => {
    const items = [item({ name: "A", steps: [step(1_000)] }), item({ name: "B", steps: [step(600)] }), item({ name: "C", steps: [step(500)] })];
    expect(remainingTotals(items, { builders: 2, boostPct: 0, running: { builders: [], lab: [], pets: [] } }).finish.builders).toBe(1_100);
    expect(remainingTotals(items, { builders: 3, boostPct: 0, running: { builders: [], lab: [], pets: [] } }).finish.builders).toBe(1_000);
  });

  it("starts each builder with what it is already running", () => {
    const items = [item({ steps: [step(1_000)] })];
    expect(remainingTotals(items, { builders: 1, boostPct: 0, running: { builders: [400], lab: [], pets: [] } }).finish.builders).toBe(1_400);
  });

  it("applies the Gold Pass boost to builders and the lab, not pets", () => {
    expect(boosted(1_000, 20)).toBe(800);
    const pet = item({ workshop: "pets", tab: "pets", steps: [step(1_000)] });
    expect(remainingTotals([pet], { builders: 1, boostPct: 20, running: { builders: [], lab: [], pets: [] } }).finish.pets).toBe(1_000);
  });

  it("counts levels with no price instead of guessing them", () => {
    const t = remainingTotals([item({ steps: [step(100), null] })], {
      builders: 1,
      boostPct: 0,
      running: { builders: [], lab: [], pets: [] },
    });
    expect(t.unpriced).toBe(1);
    expect(t.cost.gold).toBe(1_000);
  });

  it("sorts what can be started first", () => {
    const sorted = sortItems(
      [item({ name: "Busy", idle: 0, busy: 1, steps: [step(10)] }), item({ name: "Slow", steps: [step(900)] }), item({ name: "Fast", steps: [step(60)] })],
      "quickest",
      0,
    );
    expect(sorted.map((i) => i.name)).toEqual(["Fast", "Slow", "Busy"]);
  });
});

describe("formatting", () => {
  it("rounds amounts the way the game's shop does", () => {
    expect(formatAmount(950)).toBe("950");
    expect(formatAmount(12_500)).toBe("12.5K");
    expect(formatAmount(3_400_000)).toBe("3.4M");
    expect(formatAmount(1_250_000_000)).toBe("1.25B");
  });

  it("reads long spans in days", () => {
    expect(formatLong(0)).toBe("nothing left");
    expect(formatLong(90_000)).toBe("1d 1h");
    expect(formatLong(86_400 * 128.4)).toBe("128 days");
  });
});
