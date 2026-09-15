// T11.11 — the extracted report panels.
//
// The extraction's done-when is "the profile page renders what it rendered
// before", and this is the half of that a test can hold: the panels themselves,
// against a bundle, with no database and no browser.
//
// Rendered with renderToStaticMarkup from a .ts file, which is the pattern
// src/components/toaster.test.ts established — vitest.config.ts includes `.ts`
// only, but a .ts test may import a .tsx component, and esbuild's automatic JSX
// handles it. createElement rather than JSX for the same reason.
//
// WHAT IS OUT OF SCOPE BY CONSTRUCTION: no effects run under
// renderToStaticMarkup, and this component has none — it is a Server Component
// with no state, which is what makes it testable at all.
//
// The empty-state cases matter more than the populated ones. A report for a
// village in a clan with no synced history is the COMMON case on /account/bases
// (T11.12), and a section that throws on an absent number would take the whole
// page down rather than saying it has nothing to show.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerReportSections } from "@/components/player-report-sections";
import type { PlayerReport } from "@/repositories/player-report";

/** A report with nothing in it — a freshly synced village in a quiet clan. */
const EMPTY: PlayerReport = {
  cwlSeasons: [],
  cwlTotals: { warsRostered: 0, attacksUsed: 0, stars: 0 },
  donations: [],
  lastSeen: null,
  movement: [],
  raids: { weekendsAvailable: 0, weekendsRaided: 0, attacksUsed: 0, totalLoot: 0 },
  games: { monthsAvailable: 0, monthsScored: 0, totalPoints: 0, averagePoints: null },
  war: null,
};

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";

function render(report: PlayerReport, clanNames = new Map<string, string>()) {
  return renderToStaticMarkup(
    createElement(PlayerReportSections, {
      report,
      clanTag: "%232PP0JCCL",
      clanName: "DH v2",
      clanNames,
    }),
  );
}

describe("every section is present and names itself", () => {
  const html = render(EMPTY);

  it.each([
    "Clan War League",
    "Donations",
    "Clan war",
    "Raid weekends",
    "Clan Games",
  ])("renders the %s panel", (heading) => {
    expect(html).toContain(heading);
  });

  it("renders five panels for an empty report, not six", () => {
    // Clan movement is conditional on MORE THAN ONE clan, so an empty report has
    // five. A sixth would mean the movement table is rendering an empty table.
    expect(html.match(/<section/g)).toHaveLength(5);
  });
});

describe("empty states say what is missing and which clan", () => {
  const html = render(EMPTY);

  it("names the clan rather than saying 'no data'", () => {
    // The clan name is what makes an empty state actionable: a leader reading it
    // learns the sync has not run HERE, not that the member does not exist.
    expect(html).toContain("No CWL record for this member in DH v2");
    expect(html).toContain("No war record for this member in DH v2");
    expect(html).toContain("No raid weekends recorded for DH v2");
    expect(html).toContain("No Clan Games months recorded for DH v2");
  });

  it("names the sync that fills the donations in", () => {
    // Every empty state in this component names the job responsible, so a member
    // reading it can tell "not yet" from "broken".
    expect(html).toContain("sync:clans");
  });

  it("renders no numbers it does not have", () => {
    // The regression this guards: a headline of "0 of 0" reads as a real measured
    // result. An empty section must be a sentence, not a zero.
    expect(html).not.toContain("tabular-nums");
  });
});

describe("clan movement", () => {
  const movement = [
    { clanId: CLAN_A, firstSeen: "2026-01-01T00:00:00Z", lastSeen: "2026-03-01T00:00:00Z" },
    { clanId: CLAN_B, firstSeen: "2026-03-02T00:00:00Z", lastSeen: "2026-09-01T00:00:00Z" },
  ];

  it("is hidden for a player who has only ever been in one clan", () => {
    const html = render(
      { ...EMPTY, movement: [movement[0]!] },
      new Map([[CLAN_A, "DH v2"]]),
    );
    expect(html).not.toContain("Clan movement");
  });

  it("appears once a player has been in two, and names both", () => {
    const html = render(
      { ...EMPTY, movement },
      new Map([
        [CLAN_A, "DH v2"],
        [CLAN_B, "DH CWL ONLY"],
      ]),
    );
    expect(html).toContain("Clan movement");
    expect(html).toContain("DH CWL ONLY");
  });

  it("drops a clan the reader may not see rather than showing a bare uuid", () => {
    // clanNames comes from visibleClans(), so an unresolved id is one RLS already
    // refused. Dropping it leaves one row, which then hides the table entirely —
    // and that is correct: a member cannot be told they moved somewhere they are
    // not allowed to know about.
    const html = render({ ...EMPTY, movement }, new Map([[CLAN_A, "DH v2"]]));
    expect(html).not.toContain(CLAN_B);
    expect(html).not.toContain("Clan movement");
  });
});

describe("populated numbers", () => {
  const full: PlayerReport = {
    ...EMPTY,
    cwlSeasons: [
      { season: "2026-08", warsRostered: 7, attacksUsed: 6, stars: 15 },
      { season: "2026-09", warsRostered: 7, attacksUsed: 7, stars: 19 },
    ],
    cwlTotals: { warsRostered: 14, attacksUsed: 13, stars: 34 },
    donations: [
      { from: "2026-08-01T00:00:00Z", to: "2026-08-31T00:00:00Z", given: 1200, received: 600, complete: true },
      { from: "2026-09-01T00:00:00Z", to: "2026-09-14T00:00:00Z", given: 400, received: 500, complete: false },
    ],
    raids: { weekendsAvailable: 6, weekendsRaided: 4, attacksUsed: 20, totalLoot: 1_234_567 },
    games: { monthsAvailable: 3, monthsScored: 2, totalPoints: 8000, averagePoints: 4000 },
    war: {
      playerId: "p1",
      tag: "#PY0LQGRJ",
      name: "Player",
      warsPlayed: 5,
      attacksAvailable: 10,
      attacksUsed: 9,
      attacksMissed: 1,
      stars: 22,
      destruction: 91.5,
      warsMissedEntirely: 0,
      targetsFollowed: 3,
      targetsJudged: 4,
    },
  };

  const html = render(full);

  it("shows the CWL total beside the table, from the same bundle", () => {
    // The header and the rows are two renderings of one number. Computing the
    // total in the repository rather than here is what stops them disagreeing.
    expect(html).toContain("13 of 14 attacks used");
    expect(html).toContain("34 stars");
  });

  it("puts the newest donation month first", () => {
    // The repository returns oldest-first on purpose; the reversal is this
    // component's reading decision, and a leader reads the current month first.
    expect(html.indexOf("Sep 2026")).toBeLessThan(html.indexOf("Aug 2026"));
  });

  it("marks the current month as still accumulating", () => {
    // Without it, a month four days in reads as a member who has stopped giving.
    expect(html).toContain("in progress");
  });

  it("shows a donation ratio to two places, and the denominator for war attacks", () => {
    expect(html).toContain("2.00"); // 1200 given / 600 received
    expect(html).toContain("of 10");
  });

  it("shows targets only as a proportion of the wars where they were judged", () => {
    // "3 of 4", never "3" alone: a member never assigned a target has not
    // ignored one, which is the rule services/war.ts states.
    expect(html).toContain("3 of 4");
  });

  it("reports Clan Games months measured against months available", () => {
    expect(html).toContain("2 measured month");
    expect(html).toContain("of 3");
  });

  it("links every panel back into the clan, tag already encoded", () => {
    // A tag is #2PP0JCCL and an unencoded hash would be read as a fragment, so
    // the caller encodes once and this component never re-encodes.
    expect(html).toContain('href="/%232PP0JCCL/war/report"');
    expect(html).toContain('href="/%232PP0JCCL/raids"');
    expect(html).toContain('href="/%232PP0JCCL/games"');
    expect(html).toContain('href="/%232PP0JCCL/cwl/2026-08"');
    expect(html).not.toContain("/#2PP0JCCL/");
  });
});

describe("degenerate values do not take the page down", () => {
  it("renders a war record with everything at zero", () => {
    // A member rostered into wars who attacked nothing. Every number is present
    // and zero, which is a real result and must render as one.
    const html = render({
      ...EMPTY,
      war: {
        playerId: "p1",
        tag: "#PY0LQGRJ",
        name: "Player",
        warsPlayed: 2,
        attacksAvailable: 4,
        attacksUsed: 0,
        attacksMissed: 4,
        stars: 0,
        destruction: 0,
        warsMissedEntirely: 2,
        targetsFollowed: 0,
        targetsJudged: 0,
      },
    });
    expect(html).toContain("0");
    expect(html).toContain("2 wars skipped entirely");
    // targetsJudged is 0, so the targets figure is absent rather than "0 of 0".
    expect(html).not.toContain("hit the base they were given");
  });

  it("renders an em dash for an average it cannot compute", () => {
    const html = render({
      ...EMPTY,
      games: { monthsAvailable: 2, monthsScored: 1, totalPoints: 100, averagePoints: null },
    });
    expect(html).toContain("—");
  });

  it("renders an em dash for a ratio with no receipts", () => {
    const html = render({
      ...EMPTY,
      donations: [
        { from: "2026-09-01T00:00:00Z", to: "2026-09-14T00:00:00Z", given: 10, received: 0, complete: false },
      ],
    });
    expect(html).toContain("—");
  });
});
