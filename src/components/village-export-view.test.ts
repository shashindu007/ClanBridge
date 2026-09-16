// T11B.12 — the pasted-export view, rendered statically.
//
// The paste component itself holds state and cannot render past its first frame
// under renderToStaticMarkup, so what is tested here is its first frame (the
// button, and the promise that nothing is saved) and the presentational view it
// swaps in once an export parses.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VillageExportPaste } from "@/components/village-export-paste";
import { VillageExportView } from "@/components/village-export-view";
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

function view(which: Village = "home"): string {
  return renderToStaticMarkup(
    createElement(VillageExportView, { village, which, onWhich: () => {}, onClear: () => {} }),
  );
}

describe("VillageExportPaste — first frame", () => {
  it("offers the button and says nothing is sent or saved", () => {
    const html = renderToStaticMarkup(
      createElement(VillageExportPaste, { tag: "#PY0LQGRJ", label: "Main" }),
    );
    expect(html).toContain("Paste village export");
    expect(html).toContain("no buildings, walls, traps or upgrade timers");
  });
});

describe("VillageExportView", () => {
  it("says the details are not saved", () => {
    expect(view()).toContain("Not saved");
  });

  it("lists buildings by group with counts, level spread and cap", () => {
    const html = view();
    expect(html).toContain("Defenses");
    expect(html).toContain("Cannon");
    expect(html).toContain("21 ×5 · 20");
    expect(html).toContain("Walls");
    expect(html).toContain("17 ×300");
    expect(html).toContain("Traps");
  });

  it("shows running upgrades with time left from the export", () => {
    const html = view();
    expect(html).toContain("Upgrading now");
    expect(html).toContain("20 → 21");
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
