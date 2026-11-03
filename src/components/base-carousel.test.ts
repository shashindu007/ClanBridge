// Home's base card, rendered: the main base first, the controls only when there
// is somewhere to go, and every control named in words.
//
// Static markup only (the suite runs in node): what is on screen before any
// click. The 20-second turn itself is plain setTimeout in an effect.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BaseCarousel, ROTATE_MS } from "@/components/base-carousel";
import type { MainBaseView } from "@/components/main-base-card";
import type { ExportSummary } from "@/services/village";

// The upload dialog imports the server actions, which import the Supabase server
// client. Nothing here calls them.
vi.mock("@/app/(app)/account/bases/actions", () => ({
  uploadVillageExport: vi.fn(),
  removeVillageExport: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }),
}));

function view(tag: string, label: string, over: Partial<MainBaseView> = {}): MainBaseView {
  return {
    label,
    name: label,
    tag,
    thLevel: 17,
    thWeaponLevel: null,
    bhLevel: null,
    verified: true,
    isMain: false,
    clanName: "Dark Hell",
    clanRole: "leader",
    detailsHref: `/account/bases/${encodeURIComponent(tag)}/details`,
    reportHref: `/account/bases/${encodeURIComponent(tag)}`,
    career: null,
    progress: null,
    standing: { kind: "not-ranked" },
    showClanRank: true,
    saved: null,
    ...over,
  };
}

const SAVED: ExportSummary = {
  exportedAt: "2026-11-01T10:00:00Z",
  ageDays: 2,
  stale: false,
  buildingsPct: 87.4,
  walls: { level: 17, atLevel: 200, total: 325 },
  running: [
    { name: "Cannon", village: "home", fromLevel: 20, secondsLeft: 3_600, finishesAt: "2026-11-03T13:00:00Z", subject: { type: "building", kind: "Defense" } },
    { name: "Archer Queen", village: "home", fromLevel: 99, secondsLeft: 90_000, finishesAt: "2026-11-04T13:00:00Z", subject: { type: "unit", group: "hero" } },
    { name: "X-Bow", village: "home", fromLevel: 11, secondsLeft: 100_000, finishesAt: "2026-11-04T16:00:00Z", subject: { type: "building", kind: "Defense" } },
    { name: "Inferno Tower", village: "home", fromLevel: 10, secondsLeft: 200_000, finishesAt: "2026-11-05T16:00:00Z", subject: null },
  ],
  finishedSince: 1,
  builders: { busy: 3, total: 6 },
};

const render = (bases: MainBaseView[]) => renderToStaticMarkup(createElement(BaseCarousel, { bases }));

describe("BaseCarousel", () => {
  it("turns every 20 seconds", () => {
    expect(ROTATE_MS).toBe(20_000);
  });

  it("opens on the main base, and says where it is in the set", () => {
    const html = render([
      view("#MAIN", "Hasitha", { isMain: true }),
      view("#ALT1", "alt one"),
      view("#ALT2", "alt two"),
    ]);
    expect(html).toContain("Your main base");
    expect(html).toContain("1 of 3");
    expect(html).toContain("Hasitha");
    expect(html).toContain('href="/account/bases/%23MAIN/details"');
    expect(html).not.toContain("alt one</h2>");
    expect(html).toContain("All 3 bases");
  });

  it("names every control, and marks the current dot", () => {
    const html = render([view("#A", "main", { isMain: true }), view("#B", "alt")]);
    expect(html).toContain('aria-label="Previous base"');
    expect(html).toContain('aria-label="Next base"');
    expect(html).toContain('aria-label="Show main"');
    expect(html).toContain('aria-label="Show alt"');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('aria-label="Stop turning through bases"');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain("cb-carousel-timer");
  });

  it("shows the career numbers it has, and leaves out the ones it does not", () => {
    const html = render([
      view("#A", "main", {
        isMain: true,
        bhLevel: 10,
        thWeaponLevel: 4,
        career: {
          expLevel: 245,
          trophies: 5_210,
          bestTrophies: 6_001,
          warStars: 1_830,
          attackWins: 120,
          defenseWins: 9,
          builderBaseTrophies: 4_100,
          capitalContributions: null,
        },
      }),
    ]);
    expect(html).toContain("XP 245");
    expect(html).toContain("5,210");
    expect(html).toContain("best 6,001");
    expect(html).toContain("1,830");
    expect(html).toContain("9 defences won");
    expect(html).toContain("Builder Hall 10");
    expect(html).toContain("Lv 4");
    expect(html).not.toContain("Capital gold");
  });

  it("asks for the game JSON when none is saved", () => {
    const html = render([view("#A", "main", { isMain: true })]);
    expect(html).toContain("Track buildings, walls and upgrades");
    expect(html).toContain("Upload JSON");
    expect(html).not.toContain("Update JSON");
  });

  it("shows the saved export: buildings, walls, the soonest upgrades and how old it is", () => {
    const html = render([view("#A", "main", { isMain: true, saved: SAVED })]);
    expect(html).toContain("From your game export");
    expect(html).toContain("exported 2 days ago");
    expect(html).toContain("87.4%");
    expect(html).toContain("Lv 17");
    expect(html).toContain("200 of 325 at this level");
    expect(html).toContain("Builders busy");
    expect(html).toContain("3/6");
    expect(html).toContain("3 free");
    // Each upgrade has its picture, or its kind's token without the art.
    expect(html).toContain('data-kind="Defense"');
    expect(html).toContain("4 upgrades running");
    expect(html).toContain("1 finished since the export");
    expect(html).toContain("Cannon");
    expect(html).toContain("20 → 21");
    expect(html).toContain("1h");
    expect(html).not.toContain("Inferno Tower");
    expect(html).toContain("+1 more in Base details");
    expect(html).toContain("Update JSON");
    expect(html).not.toContain("Upload a fresh one");
  });

  it("asks for a fresh export once the saved one is a week old", () => {
    const html = render([view("#A", "main", { isMain: true, saved: { ...SAVED, ageDays: 9, stale: true } })]);
    expect(html).toContain("exported 9 days ago");
    expect(html).toContain("Upload a fresh one");
  });

  it("is just the card for a single village: no arrows, dots or timer", () => {
    const html = render([view("#ONLY", "solo", { isMain: true })]);
    expect(html).toContain("Your main base");
    expect(html).not.toContain("Previous base");
    expect(html).not.toContain("cb-carousel-timer");
    expect(html).not.toContain("of 1");
    expect(html).not.toContain("carousel");
  });
});
