// Your rank, pinned to the bottom: drawn open on the server, with a way to shrink
// it and a way to each of the member's rows.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RankDock } from "@/components/rank-dock";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));

const ENTRY = {
  key: "ann",
  name: "Ann",
  rank: 2,
  medal: true,
  line: "#2 of 110 in the family · #1 of 12 in Dark Hell",
  rating: "1.06%",
  href: "/rating#rank-PY0LQGRJ",
};

const render = (entries = [ENTRY]) =>
  renderToStaticMarkup(createElement(RankDock, { title: "November 2026", entries }));

describe("RankDock", () => {
  it("is drawn open, with the rank, the line and the way to the row", () => {
    const html = render();
    expect(html).toContain('aria-label="Your rank"');
    expect(html).toContain("Your rank · November 2026");
    expect(html).toContain("#2 of 110 in the family");
    expect(html).toContain("1.06%");
    expect(html).toContain('href="/rating#rank-PY0LQGRJ"');
  });

  it("has a close button that says what it does", () => {
    expect(render()).toContain('aria-label="Hide your rank"');
  });

  it("is nothing for someone with no village in the ranking", () => {
    expect(render([])).toBe("");
  });
});
