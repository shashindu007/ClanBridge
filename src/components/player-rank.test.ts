// What a player reads about their rank, in each state. createElement rather than
// JSX, as the other component tests here do.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HomeRank, RankHistory, RankSummary, rankHref } from "@/components/player-rank";
import type { Standing } from "@/services/player-rank";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));

const RANKED: Standing = {
  kind: "ranked",
  month: "2026-10",
  open: false,
  familyRank: 12,
  familySize: 195,
  tied: false,
  clanRank: 3,
  clanSize: 45,
  clanName: "Dark Hell",
  rating: 3.21,
  shares: { donations: 1.5, war: 2, cwl: 3, games: 0, raids: -0.5 },
  computedAt: "2026-10-31T06:00:00Z",
  movement: "Up 3 from September",
};

const summary = (standing: Standing, showClan = true) =>
  renderToStaticMarkup(createElement(RankSummary, { standing, tag: "#PY0LQGRJ", showClan }));

const home = (standing: Standing, showClan = true) =>
  renderToStaticMarkup(createElement(HomeRank, { standing, tag: "#PY0LQGRJ", showClan }));

describe("RankSummary", () => {
  it("says the rank, out of what, in which month, and how final it is", () => {
    const html = summary(RANKED);

    expect(html).toContain("#12");
    expect(html).toContain("of 195 in the family");
    expect(html).toContain("October 2026, final");
    expect(html).toContain("#3 of 45 in Dark Hell");
    expect(html).toContain("Up 3 from September");
    expect(html).toContain("3.21%");
    expect(html).toContain("−0.50%");
  });

  it("says when a month is still counting", () => {
    expect(summary({ ...RANKED, open: true })).toContain("October 2026, so far");
  });

  it("says Tied in words", () => {
    expect(summary(RANKED)).not.toContain("Tied");
    expect(summary({ ...RANKED, tied: true })).toContain("Tied");
  });

  it("leaves out a clan this viewer may not read", () => {
    expect(summary(RANKED, false)).not.toContain("Dark Hell");
  });

  it("links to this player's row in this month", () => {
    expect(summary(RANKED)).toContain('href="/rating?month=2026-10#rank-PY0LQGRJ"');
  });

  it("has a different sentence for each state with no rank", () => {
    expect(summary({ kind: "failed" })).toContain("could not be loaded");
    expect(summary({ kind: "not-ranked" })).toContain("Not ranked yet");
    expect(summary({ kind: "no-marks", month: "2026-11", open: true })).toContain(
      "No marks yet for November 2026",
    );
  });
});

describe("HomeRank", () => {
  it("leads Home's card with the rank, its month, the rating and its sections", () => {
    const html = home(RANKED);
    expect(html).toContain("#12");
    expect(html).toContain("of 195 in the family");
    expect(html).toContain("#3 of 45 in Dark Hell");
    expect(html).toContain("October 2026, final");
    expect(html).toContain("Up 3 from September");
    expect(html).toContain("3.21%");
    expect(html).toContain("CWL");
    expect(html).toContain('href="/rating?month=2026-10#rank-PY0LQGRJ"');
  });

  it("leaves out a clan this viewer may not read", () => {
    expect(home(RANKED, false)).not.toContain("Dark Hell");
  });

  it("gives a medal shield to the top three only", () => {
    expect(home(RANKED)).not.toContain("data-tier");
    expect(home({ ...RANKED, familyRank: 1 })).toContain('data-tier="1"');
  });

  it("carries a failed read as its own sentence, and no link", () => {
    const html = home({ kind: "failed" });
    expect(html).toContain("could not be loaded");
    expect(html).not.toContain("<a ");
  });
});

describe("RankHistory", () => {
  it("is absent with nothing to list", () => {
    expect(renderToStaticMarkup(createElement(RankHistory, { rows: [] }))).toBe("");
  });

  it("lists each month in words", () => {
    const html = renderToStaticMarkup(
      createElement(RankHistory, {
        rows: [
          { month: "2026-11", open: true, familyRank: 9, familySize: 190, tied: true, rating: 1 },
          { month: "2026-10", open: false, familyRank: 12, familySize: 195, tied: false, rating: 3.21 },
        ],
      }),
    );

    expect(html).toContain("November 2026");
    expect(html).toContain("so far");
    expect(html).toContain("of 190, tied");
    expect(html).toContain("October 2026");
  });
});

describe("rankHref", () => {
  it("drops the # a tag starts with, which would end the URL's fragment early", () => {
    expect(rankHref("2026-09", "#C2V89UGL")).toBe("/rating?month=2026-09#rank-C2V89UGL");
  });
});
