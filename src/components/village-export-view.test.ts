// T11B.12 / 076 — the saved-export view, rendered statically.
//
// The saved component holds state and cannot render past its first frame under
// renderToStaticMarkup, so what is tested here is that first frame — the upload
// form with nothing saved, the view with an export — and the presentational
// view itself.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SavedVillageExport } from "@/components/village-export-saved";
import { VillageExportView, type VillageExportViewProps } from "@/components/village-export-view";
import { parseVillageExport } from "@/integration/village-export";
import type { Village } from "@/types/domain";

const EXPORTED_AT = 1_789_000_000;
const NOW = new Date((EXPORTED_AT + 60) * 1000);

const parsed = parseVillageExport(
  JSON.stringify({
    tag: "#PY0LQGRJ",
    timestamp: EXPORTED_AT,
    buildings: [
      { data: 1000001, lvl: 17 },
      { data: 1000008, lvl: 21, cnt: 5 },
      { data: 1000008, lvl: 20, cnt: 1, timer: 90_000 },
      { data: 1000010, lvl: 17, cnt: 300 },
      { data: 1009999, lvl: 3 },
    ],
    traps: [{ data: 12000000, lvl: 13, cnt: 6 }],
    heroes: [{ data: 28000000, lvl: 100 }],
    buildings2: [{ data: 1000034, lvl: 10 }, { data: 1000044, lvl: 10, cnt: 2 }],
  }),
  NOW,
);
if (!parsed.ok) throw new Error(parsed.error);
const village = parsed.village;

// The server actions module imports the Supabase server client; the first frame
// never calls it.
vi.mock("@/app/(app)/account/bases/actions", () => ({
  uploadVillageExport: vi.fn(),
  removeVillageExport: vi.fn(),
}));
// 079. The tracker beside it is imported, and never rendered without `tracker`.
vi.mock("@/app/(app)/account/bases/tracker-actions", () => ({
  startUpgrade: vi.fn(),
  finishUpgradeNow: vi.fn(),
  cancelUpgrade: vi.fn(),
  markAlreadyUpgraded: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function view(which: Village = "home", now: Date = NOW, extra: Partial<VillageExportViewProps> = {}): string {
  return renderToStaticMarkup(createElement(VillageExportView, { village, which, now, ...extra }));
}

const saved = (value: typeof village | null, which: Village = "home") =>
  renderToStaticMarkup(
    createElement(SavedVillageExport, {
      tag: "#PY0LQGRJ",
      label: "Main",
      village: value,
      now: NOW.toISOString(),
      which,
    }),
  );

describe("SavedVillageExport — first frame", () => {
  it("offers the upload form when nothing is saved, and says what the API lacks", () => {
    const html = saved(null);
    expect(html).toContain("Track everything, from your game");
    expect(html).toContain("no buildings, walls, traps or upgrade timers");
    expect(html).toContain("Choose .json file");
    expect(html).toContain("visible only to you");
  });

  it("shows the saved export with Upload newer and Remove", () => {
    const html = saved(village);
    expect(html).toContain("From your village export");
    expect(html).toContain("Upload newer");
    expect(html).toContain("Remove");
    expect(html).not.toContain("Choose .json file");
    // The filter it holds is offered.
    expect(html).toContain("Not maxed only");
    expect(html).toContain('aria-pressed="true"');
  });

  it("shows the village the page chose, not one of its own", () => {
    expect(saved(village, "builder")).toContain("Builder Hall 10");
  });
});

describe("VillageExportView", () => {
  it("says the details are saved and private", () => {
    expect(view()).toContain("Saved to your account");
  });

  it("works time left out from the finish time, days after the export", () => {
    // Two days on, the upgrade that had a day left is done.
    expect(view("home", new Date(NOW.getTime() + 2 * 86_400_000))).toContain(">done<");
  });

  it("draws every building as a tile with its icon, count, level spread and cap", () => {
    const html = view();
    expect(html).toContain("Defenses");
    expect(html).toContain("Cannon");
    expect(html).toContain("×6");
    expect(html).toContain("21 ×5 · 20");
    expect(html).toContain("Traps");
    // The Fan Kit has no Cannon render yet, so its kind's token stands in;
    // the Bomb has one (2026-11-24 zip).
    expect(html).toContain('data-kind="Defense"');
    expect(html).toContain("/game/traps/trap-bomb.webp");
    expect(html).not.toContain("<table");
  });

  it("gives walls a card of their own, by level", () => {
    const html = view();
    expect(html).toContain('id="walls-title"');
    expect(html).toContain("300 pieces");
    expect(html).toContain("Lv 17");
    expect(html).toContain("×300");
    expect(html).toContain("300 at level 17");
  });

  it("leads with the four numbers a player checks first", () => {
    const html = view();
    expect(html).toContain("Town Hall 17");
    expect(html).toContain("Buildings");
    expect(html).toContain("Builders busy");
    expect(html).toContain("Heroes and army");
  });

  it("filters the grid to one group, and hides what is maxed", () => {
    const traps = view("home", NOW, { filter: "traps", onFilter: () => {} });
    expect(traps).toContain(">Bomb<");
    // The tile's own bar; Cannon is still named in "Upgrading now".
    expect(traps).not.toContain('aria-label="Cannon ');
    const left = view("home", NOW, { notMaxedOnly: true, onNotMaxedOnly: () => {} });
    expect(left).toContain('aria-label="Cannon ');
    // Six Bombs at 13, the TH 17 cap: all maxed, so hidden.
    expect(left).not.toContain(">Bomb<");
  });

  it("shows running upgrades with time left from the export", () => {
    const html = view();
    expect(html).toContain("Upgrading now");
    expect(html).toContain("Level 20 → 21");
    // 90,000s at export, 60s ago: 89,940s, which formats as whole days only.
    expect(html).toContain("1d left");
  });

  it("says how many items the data does not know", () => {
    expect(view()).toContain("1 item is newer than");
  });

  it("switches to the Builder Base buildings", () => {
    const html = view("builder");
    expect(html).toContain("Builder Hall 10");
    expect(html).not.toContain("17 ×300");
    expect(html).toContain("Nothing was upgrading");
  });
});

describe("VillageExportView — a new Town Hall the data does not fully know", () => {
  const th19 = parseVillageExport(
    JSON.stringify({
      tag: "#PY0LQGRJ",
      timestamp: EXPORTED_AT,
      buildings: [
        { data: 1000001, lvl: 19 },
        { data: 1000015, lvl: 1, cnt: 6 },
        { data: 1000008, lvl: 21, cnt: 7 },
        { data: 1000009, lvl: 21, cnt: 8 },
      ],
    }),
    NOW,
  );
  if (!th19.ok) throw new Error(th19.error);
  const html = renderToStaticMarkup(createElement(VillageExportView, { village: th19.village, which: "home", now: NOW }));

  it("shows a dash, not 100%, and says why", () => {
    expect(html).toContain("caps not known yet");
    // Nothing in this export can be measured: no unit sections, and the
    // buildings' TH19 caps are unknown. Neither tile may claim 100%.
    expect(html).not.toContain(">100%<");
    expect(html).toContain("not in the site&#x27;s game data yet");
  });

  it("draws a building with Fan Kit art as its picture", () => {
    expect(html).toContain("/game/buildings/building-archer-tower.webp");
    expect(html).toContain("/game/buildings/building-builders-hut.webp");
  });
});
