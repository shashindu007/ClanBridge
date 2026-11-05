// The shared ranking every Player rating page draws: places with ties, the
// podium's picks, and one column order everywhere. createElement rather than
// JSX, as the other component tests here do.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Leaderboard, Podium, RatingToolbar, podiumRows, topOf, type BoardRow } from "@/components/rating-board";
import { rankRows } from "@/lib/rating";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }),
}));

const CLAN = { id: "aaaaaaaa-0000-4000-8000-000000000001", name: "Dark Hell" };

function row(over: Partial<BoardRow>): BoardRow {
  return {
    key: over.name ?? "p",
    rank: 1,
    medal: true,
    name: "Ann",
    tag: "#PY0LQGRJ",
    href: null,
    you: false,
    clan: CLAN,
    rating: { text: "1.0", value: 1 },
    cells: {},
    ...over,
  };
}

describe("rankRows", () => {
  it("gives players level on every count one place, and skips the next", () => {
    const ranked = rankRows([5, 4, 4, 3], (a, b) => a === b);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(ranked.map((r) => r.tied)).toEqual([false, true, true, false]);
  });

  it("is empty for nobody", () => {
    expect(rankRows([], () => true)).toEqual([]);
  });
});

describe("podiumRows", () => {
  it("takes the top three with something behind them, in place order", () => {
    const picked = podiumRows([
      row({ name: "C", rank: 3 }),
      row({ name: "A", rank: 1 }),
      row({ name: "B", rank: 2, medal: false }),
      row({ name: "D", rank: 4 }),
    ]);
    expect(picked.map((r) => r.name)).toEqual(["A", "C"]);
  });

  it("uses the clan place when one clan is shown", () => {
    expect(podiumRows([row({ rank: 9, place: 1 })])).toHaveLength(1);
  });
});

describe("Leaderboard", () => {
  const html = renderToStaticMarkup(
    createElement(Leaderboard, {
      rows: [
        row({ name: "Ann", rank: 1, you: true, anchorId: "rank-PY0LQGRJ", thLevel: 16, cells: { wars: 3 } }),
        row({ name: "Ben", rank: 2, medal: false, tag: "#C2V89UGL", cells: {} }),
      ],
      columns: [{ key: "wars", label: "Wars" }],
      ratingTop: 1,
    }),
  );

  it("puts the rating next to the player, then the section's own columns", () => {
    const order = ["Player", "Rating", "Wars"].map((label) => html.indexOf(`>${label}</th>`));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("marks your row, anchors it, and shows the clan inside the player cell", () => {
    expect(html).toContain('data-you="true"');
    expect(html).toContain('id="rank-PY0LQGRJ"');
    expect(html).toContain(">You<");
    expect(html).toContain("Dark Hell");
  });

  it("gives a medal only where there is something behind it, and fills an empty cell with a dash", () => {
    expect(html.match(/data-tier=/g)).toHaveLength(1);
    expect(html).toContain("—");
  });
});

describe("Podium", () => {
  it("is nothing with nobody on it", () => {
    expect(renderToStaticMarkup(createElement(Podium, { rows: [] }))).toBe("");
  });

  it("stands first in the middle with a crown", () => {
    const html = renderToStaticMarkup(createElement(Podium, { rows: [row({ rank: 1 }), row({ name: "B", rank: 2 })] }));
    expect(html).toContain('aria-label="Top of the ranking"');
    expect(html).toContain("cb-crown");
    expect(html).toContain("sm:order-2");
  });
});

describe("RatingToolbar", () => {
  it("leaves out a month picker with one month in it", () => {
    const html = renderToStaticMarkup(
      createElement(RatingToolbar, {
        months: [{ href: "/rating", label: "November 2026", active: true }],
        clans: [
          { href: "/rating", label: "All clans", active: true, count: 2 },
          { href: "/rating?clan=x", label: "Dark Hell", active: false, count: 2, dot: "red" },
        ],
      }),
    );
    expect(html).not.toContain('aria-label="Month"');
    expect(html).toContain('aria-label="Clan"');
    expect(html).toContain('aria-current="page"');
  });

  it("is nothing with nothing to pick", () => {
    expect(renderToStaticMarkup(createElement(RatingToolbar, {}))).toBe("");
  });
});

describe("topOf", () => {
  it("is never below 0", () => {
    expect(topOf([-3, -1])).toBe(0);
    expect(topOf([1, 4, 2])).toBe(4);
  });
});
