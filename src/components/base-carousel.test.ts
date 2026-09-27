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
    verified: true,
    isMain: false,
    clanName: "Dark Hell",
    clanRole: "leader",
    detailsHref: `/account/bases/${encodeURIComponent(tag)}/details`,
    reportHref: `/account/bases/${encodeURIComponent(tag)}`,
    progress: null,
    ...over,
  };
}

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

  it("is just the card for a single village: no arrows, dots or timer", () => {
    const html = render([view("#ONLY", "solo", { isMain: true })]);
    expect(html).toContain("Your main base");
    expect(html).not.toContain("Previous base");
    expect(html).not.toContain("cb-carousel-timer");
    expect(html).not.toContain("of 1");
    expect(html).not.toContain("carousel");
  });
});
