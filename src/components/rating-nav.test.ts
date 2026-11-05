// The Player rating tabs: Overall is a tab, and the lit one follows the route.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ current: "/rating" }));

vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));

const { RatingNav, activeRatingTab } = await import("@/components/rating-nav");

function lit(pathname: string): string | null {
  path.current = pathname;
  const html = renderToStaticMarkup(createElement(RatingNav));
  return /<a href="([^"]+)"[^>]*aria-current="page"/.exec(html)?.[1] ?? null;
}

describe("RatingNav", () => {
  it("has Overall first, then every section", () => {
    path.current = "/rating";
    const html = renderToStaticMarkup(createElement(RatingNav));
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toEqual([
      "/rating",
      "/rating/donations",
      "/rating/war",
      "/rating/cwl",
      "/rating/games",
      "/rating/raids",
    ]);
    expect(html).toContain("Overall");
  });

  it("lights the tab for the page you are on, and only one", () => {
    expect(lit("/rating")).toBe("/rating");
    expect(lit("/rating/war")).toBe("/rating/war");
    expect(lit("/rating/cwl/share")).toBe("/rating/cwl");
  });

  it("lights nothing off the rating pages", () => {
    expect(activeRatingTab("/dashboard")).toBeNull();
  });
});
