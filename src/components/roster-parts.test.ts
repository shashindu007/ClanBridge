// The roster pages' shared parts, rendered statically (the toaster.test.ts
// pattern). What matters is what a first-time leader READS, so these assert
// words: labels on numbers, who can see a lineup, and why a button is disabled.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AvailabilityBadge,
  LastCwl,
  LineupPanel,
  LineupStatus,
  SlotMeter,
  TownHall,
} from "@/components/roster-parts";
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

describe("labels", () => {
  it("labels a Town Hall level instead of printing a bare number", () => {
    expect(html(createElement(TownHall, { level: 18 }))).toContain("TH 18");
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
    const out = html(createElement(LineupPanel, { roster, clanName: "Dark Hell", members: [], action: noop }));
    expect(out).toContain("Press Add beside a player");
    expect(out).toContain("Add at least one player before you can publish");
    expect(out).toMatch(/<button[^>]*disabled/);
    expect(out).toContain("only leaders and co-leaders can see it");
  });

  it("numbers the players, labels their Town Hall, and names what Remove does", () => {
    const out = html(
      createElement(LineupPanel, {
        roster,
        clanName: "Dark Hell",
        members: [member(1, 18), member(2, 17)],
        action: noop,
        hidden: { season: "2026-09", view: "?show=in" },
      }),
    );
    expect(out).toContain("TH 18");
    expect(out).toContain('aria-label="Remove Player 1 from the Dark Hell lineup"');
    expect(out).toContain('name="view" value="?show=in"');
    expect(out).toContain("Publish lineup to members");
  });

  it("offers unpublishing, in words, once published", () => {
    const out = html(
      createElement(LineupPanel, {
        roster: { ...roster, status: "published" },
        clanName: "Dark Hell",
        members: [member(1)],
        action: noop,
      }),
    );
    expect(out).toContain("Unpublish (back to draft)");
    expect(out).toContain("members of this clan can see this lineup");
  });

  it("renders read-only with no forms when there is no action", () => {
    const out = html(createElement(LineupPanel, { roster, clanName: "Dark Hell", members: [member(1)] }));
    expect(out).not.toContain("<form");
    expect(out).not.toContain("Remove");
  });
});
