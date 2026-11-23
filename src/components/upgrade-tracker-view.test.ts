// 079 — the upgrade tracker, rendered statically.
//
// The view is presentational, so it renders whole. The client wrapper holds
// state and renders only its first frame here, which is enough to prove it
// wires the board, the totals and the list together.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  TotalsHeader,
  UpgradeItemRow,
  UpgradesPanel,
  WorkshopBoard,
} from "@/components/upgrade-tracker-view";
import { UpgradeTracker } from "@/components/upgrade-tracker";
import { parseVillageExport } from "@/integration/village-export";
import { remainingUpgrades, runningLoads } from "@/services/upgrades";
import { remainingTotals, type RemainingItem } from "@/services/upgrade-time";
import { applyTracked } from "@/services/village-overlay";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(app)/account/bases/tracker-actions", () => ({
  startUpgrade: vi.fn(),
  finishUpgradeNow: vi.fn(),
  cancelUpgrade: vi.fn(),
  markAlreadyUpgraded: vi.fn(),
}));

const EXPORTED_AT = 1_789_000_000;
const NOW = new Date((EXPORTED_AT + 60) * 1000);

const parsed = parseVillageExport(
  JSON.stringify({
    tag: "#PY0LQGRJ",
    timestamp: EXPORTED_AT,
    buildings: [
      { data: 1000001, lvl: 17 },
      { data: 1000015, lvl: 1, cnt: 3 },
      { data: 1000007, lvl: 15 },
      { data: 1000008, lvl: 20, cnt: 2 },
      { data: 1000008, lvl: 20, timer: 90_000 },
      { data: 1000010, lvl: 16, cnt: 50 },
    ],
    heroes: [{ data: 28000000, lvl: 95 }],
  }),
  NOW,
);
if (!parsed.ok) throw new Error(parsed.error);

const village = applyTracked(
  parsed.village,
  [
    {
      id: "00000000-0000-4000-8000-000000000001",
      village: "home",
      subjectType: "unit",
      subject: "Barbarian King",
      fromLevel: 95,
      workshop: "builders",
      boostPct: 0,
      startedAt: NOW.toISOString(),
      endsAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    },
  ],
  NOW,
).village;
const items = remainingUpgrades(village, "home", NOW);
const running = runningLoads(village, "home", NOW);

const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("WorkshopBoard", () => {
  const html = render(createElement(WorkshopBoard, { village, which: "home", now: NOW, onPick: () => {} }));

  it("shows each busy builder with its timer, and says where it came from", () => {
    expect(html).toContain("Barbarian King");
    expect(html).toContain("Level 95 → 96");
    expect(html).toContain('role="timer"');
    expect(html).toContain("from export"); // the Cannon came with the export
  });

  it("offers the free builder an upgrade", () => {
    expect(html).toContain("1 of 3 builders free");
    expect(html).toContain("Free builder");
    expect(html).toContain("Pick an upgrade");
  });

  it("shows the lab as a slot of its own", () => {
    expect(html).toContain("Laboratory is free");
  });

  it("draws the free builder and the lab as their Fan Kit buildings", () => {
    expect(html).toContain("/game/buildings/building-builders-hut.webp");
    expect(html).toContain("/game/buildings/building-laboratory.webp");
  });
});

describe("TotalsHeader", () => {
  const totals = remainingTotals(items, { builders: 3, boostPct: 0, running });

  it("gives the time to max and the resources, by name as well as icon", () => {
    const html = render(
      createElement(TotalsHeader, { totals, hallLabel: "Town Hall 17", builders: 3, boost: 0, has: ["builders", "lab"], onBoost: () => {} }),
    );
    expect(html).toContain("Time to max Town Hall 17");
    expect(html).toContain("≈");
    expect(html).toContain("Gold");
    expect(html).toContain("Dark elixir");
    expect(html).toContain("Gold Pass boost");
  });

  it("says Maxed when nothing is left", () => {
    const html = render(
      createElement(TotalsHeader, {
        totals: remainingTotals([], { builders: 3, boostPct: 0, running }),
        hallLabel: "Town Hall 17",
        builders: 3,
        boost: 0,
        has: ["builders"],
      }),
    );
    expect(html).toContain("Maxed");
  });

  // TH19 before the data has every cap: nothing listed is not "maxed".
  it("says Not known yet, never Maxed, while caps are still to come", () => {
    const html = render(
      createElement(TotalsHeader, {
        totals: remainingTotals([], { builders: 3, boostPct: 0, running }),
        pending: 4,
        hallLabel: "Town Hall 19",
        builders: 3,
        boost: 0,
        has: ["builders"],
      }),
    );
    expect(html).toContain("Not known yet");
    expect(html).not.toContain("Maxed");
    expect(html).toContain("not in the");
    expect(html).toContain("They are not maxed");
  });
});

describe("UpgradesPanel and its rows", () => {
  const row = (item: RemainingItem, blocked: string | null = null) =>
    render(createElement(UpgradeItemRow, { item, boost: 0, blocked, onStart: () => {}, onMark: () => {} }));
  const find = (name: string, from?: number) =>
    items.find((i) => i.name === name && (from === undefined || i.fromLevel === from))!;

  it("prices the next level and offers Start", () => {
    const html = row(find("Cannon", 20));
    expect(html).toContain("Level 20 → 21");
    expect(html).toContain("Start");
    expect(html).toContain("To max:");
  });

  it("says why Start is not available, and disables it", () => {
    const html = row(find("Cannon", 20), "All 3 builders busy");
    expect(html).toContain("All 3 builders busy");
    expect(html).toContain("disabled");
  });

  it("marks a running hero as upgrading rather than offering Start again", () => {
    expect(row(find("Barbarian King"))).toContain("Upgrading");
  });

  it("offers walls an Upgraded button, since they need no builder", () => {
    const html = row(find("Wall", 16));
    expect(html).toContain("Upgraded");
    expect(html).not.toContain("Start");
  });

  it("shows tabs with counts and an all-done message for an empty tab", () => {
    const html = render(
      createElement(UpgradesPanel, {
        items: [],
        tabs: [{ key: "builders", count: 12 }, { key: "walls", count: 50 }],
        tab: "builders",
        sort: "quickest",
        boost: 0,
        hallLabel: "Town Hall 17",
        totals: null,
      }),
    );
    expect(html).toContain("Upgrades left");
    expect(html).toContain("Walls");
    expect(html).toContain("Nothing left here for Town Hall 17");
  });

  it("does not call an empty list done while caps are still to come", () => {
    const html = render(
      createElement(UpgradesPanel, {
        items: [],
        tabs: [],
        tab: "builders",
        sort: "quickest",
        boost: 0,
        hallLabel: "Town Hall 19",
        pending: 4,
        totals: null,
      }),
    );
    expect(html).not.toContain("Nothing left here");
    expect(html).toContain("this is not maxed");
  });
});

describe("UpgradeTracker", () => {
  it("renders the board, the totals and the list together", () => {
    const html = render(
      createElement(UpgradeTracker, { tag: "#PY0LQGRJ", village, which: "home", now: NOW.toISOString(), items, running }),
    );
    expect(html).toContain("Upgrading now");
    expect(html).toContain("Time to max Town Hall 17");
    expect(html).toContain("Upgrades left");
  });
});
