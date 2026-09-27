// The roster pages' shared parts, rendered statically (the toaster.test.ts
// pattern). What matters is what a first-time leader READS, so these assert
// words: labels on numbers, who can see a lineup, and why a button is disabled.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AvailabilityBadge,
  AvailabilityChips,
  HowItWorks,
  LastCwl,
  LineupPanel,
  LineupStatus,
  PoolSearch,
  SlotMeter,
  Step,
  TownHall,
} from "@/components/lineup-parts";
import type { Roster, RosterMember } from "@/repositories/rosters";

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);

const roster: Roster = {
  id: "r1",
  season: "2026-09",
  clanId: "c1",
  status: "draft",
  slotCount: 15,
  createdBy: "u1",
  publishedAt: null,
  createdAt: "2026-09-01T00:00:00Z",
};

const member = (n: number, th = 17): RosterMember => ({
  id: `m${n}`,
  rosterId: "r1",
  playerId: `p${n}`,
  position: n,
  addedAt: "2026-09-02T00:00:00Z",
  tag: "#PY0LQGRJ",
  name: `Player ${n}`,
  thLevel: th,
});

const noop = async () => {};

const panel = {
  title: "Dark Hell",
  status: roster.status,
  slots: roster.slotCount,
};

describe("labels", () => {
  it("labels a Town Hall level instead of printing a bare number", () => {
    expect(html(createElement(TownHall, { level: 18 }))).toContain('aria-label="Town Hall 18"');
    expect(html(createElement(TownHall, { level: null }))).toContain("TH ?");
  });

  it("writes every availability out, never colour alone", () => {
    expect(html(createElement(AvailabilityBadge, { answer: "In" }))).toContain("In");
    expect(html(createElement(AvailabilityBadge, { answer: "Out" }))).toContain("Out");
    expect(html(createElement(AvailabilityBadge, { answer: null }))).toContain("No answer");
    expect(html(createElement(AvailabilityBadge, { answer: "Days 1-3" }))).toContain("Days 1-3");
  });

  it("says who can see a lineup", () => {
    expect(html(createElement(LineupStatus, { status: "draft", withHint: true }))).toContain(
      "Only leaders can see this",
    );
    expect(html(createElement(LineupStatus, { status: "published", withHint: true }))).toContain(
      "Members can see this lineup",
    );
  });
});

describe("SlotMeter", () => {
  it.each([
    [11, "4 spots left"],
    [14, "1 spot left"],
    [15, "Full"],
    [16, "1 too many"],
  ])("%i of 15 reads %s", (filled, text) => {
    const out = html(createElement(SlotMeter, { filled, slots: 15 }));
    expect(out).toContain(text);
    expect(out).toContain("of 15 players");
  });
});

describe("LastCwl", () => {
  it("reads as attacks of wars, with the season and the other clan", () => {
    const out = html(
      createElement(LastCwl, {
        attacks: 6,
        wars: 7,
        season: "September 2026",
        clanName: "DH CWL ONLY",
        ownClanName: "Dark Hell",
      }),
    );
    expect(out).toContain("6 of 7 attacks");
    expect(out).toContain("1 missed");
    expect(out).toContain("in DH CWL ONLY");
  });

  it("does not name the clan when it was the player's own", () => {
    const out = html(
      createElement(LastCwl, { attacks: 7, wars: 7, season: "August 2026", clanName: "Dark Hell", ownClanName: "Dark Hell" }),
    );
    expect(out).not.toContain("in Dark Hell");
    expect(out).not.toContain("missed");
  });

  it("says so when there is no CWL yet", () => {
    expect(
      html(createElement(LastCwl, { attacks: null, wars: null, season: null, clanName: null, ownClanName: "x" })),
    ).toContain("No CWL yet");
  });
});

describe("LineupPanel", () => {
  it("explains an empty draft and why Publish is disabled", () => {
    const out = html(createElement(LineupPanel, { ...panel, members: [], action: noop }));
    expect(out).toContain("Press Add beside a player");
    expect(out).toContain("Add at least one player before you can publish");
    expect(out).toMatch(/<button[^>]*disabled/);
    expect(out).toContain("only leaders and co-leaders can see it");
  });

  it("numbers the players, labels their Town Hall, and names what Remove does", () => {
    const out = html(
      createElement(LineupPanel, {
        ...panel,
        members: [member(1, 18), member(2, 17)],
        action: noop,
        hidden: { season: "2026-09", view: "?show=in", rosterId: "r1" },
      }),
    );
    // The accessible name, which holds with the Fan Kit picture or without it.
    expect(out).toContain('aria-label="Town Hall 18"');
    expect(out).toContain('aria-label="Remove Player 1 from the Dark Hell lineup"');
    expect(out).toContain('name="view" value="?show=in"');
    // The lineup's id rides in `hidden` under the name the page's action reads.
    expect(out).toContain('name="rosterId" value="r1"');
    expect(out).toContain("Publish lineup to members");
  });

  it("offers unpublishing, in words, once published", () => {
    const out = html(
      createElement(LineupPanel, {
        ...panel,
        status: "published",
        members: [member(1)],
        action: noop,
      }),
    );
    expect(out).toContain("Unpublish (back to draft)");
    expect(out).toContain("members of this clan can see this lineup");
  });

  it("renders read-only with no forms when there is no action", () => {
    const out = html(createElement(LineupPanel, { ...panel, members: [member(1)] }));
    expect(out).not.toContain("<form");
    expect(out).not.toContain("Remove");
  });
});

describe("LineupPanel for a war", () => {
  it("names the audience and carries extras under the publish button", () => {
    const out = html(
      createElement(
        LineupPanel,
        {
          title: "15v15 war",
          status: "published",
          slots: 15,
          members: [member(1)],
          audience: "everyone in the clan",
          action: noop,
          hidden: { lineupId: "l1" },
        },
        createElement("p", null, "Link it to the war"),
      ),
    );
    expect(out).toContain("everyone in the clan can see this lineup");
    expect(out).toContain('name="lineupId" value="l1"');
    expect(out).toContain("Link it to the war");
  });
});

describe("filters", () => {
  it("renders every availability chip with its count, marking the active one", () => {
    const out = html(
      createElement(AvailabilityChips, {
        active: "in",
        counts: { all: 40, in: 12, maybe: 3, none: 20, out: 5 },
        hrefFor: (f: string) => `/x?show=${f}`,
      }),
    );
    expect(out).toContain("Said In");
    expect(out).toContain("No answer");
    expect(out).toContain('href="/x?show=out"');
    expect(out).toMatch(/aria-current="true"[^>]*>Said In/);
  });

  it("is a GET form that keeps other URL state and offers Clear only when filtering", () => {
    const out = html(
      createElement(PoolSearch, {
        action: "/roster/2026-09",
        hidden: { clan: "#2G8YQYRGJ" },
        q: "flash",
        clans: [
          { id: "a", name: "Dark Hell" },
          { id: "b", name: "DH CWL ONLY" },
        ],
        from: "b",
        clearHref: "/roster/2026-09",
      }),
    );
    expect(out).toContain('method="get"');
    expect(out).toContain('name="clan" value="#2G8YQYRGJ"');
    expect(out).toContain('value="flash"');
    expect(out).toContain("From DH CWL ONLY");
    expect(out).toContain("Clear filters");

    const plain = html(createElement(PoolSearch, { action: "/x", hidden: {}, q: "" }));
    expect(plain).not.toContain("Clear filters");
    expect(plain).not.toContain("<select");
  });

  it("renders How this works as a native disclosure with numbered steps", () => {
    const out = html(
      createElement(HowItWorks, { open: true }, createElement(Step, { n: 1, title: "Check who is available" }, "text")),
    );
    expect(out).toContain("<details open");
    expect(out).toContain("How this works");
    expect(out).toContain("Check who is available");
  });
});
