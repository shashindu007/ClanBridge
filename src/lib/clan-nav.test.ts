// The clan navigation map, and the matching that lights a tab.
//
// These tests exist for the same reason lib/gate.test.ts does: the interesting
// failures here are silent. A tab that lights the wrong destination does not
// throw, does not fail typecheck, and looks fine on the one page whoever wrote
// it was looking at. The two that actually bite:
//
//   longest match  /war/lineup matches BOTH /war and /war/lineup. Take the
//                  shorter answer and a member standing on the lineup page is
//                  told they are on the war board.
//   the empty path "" is a prefix of every route in the clan, so the ordinary
//                  prefix rule lights Overview on all thirteen of them.

import { describe, expect, it } from "vitest";
import {
  activeNav,
  cardLabelOf,
  cardsInGroup,
  CLAN_GROUPS,
  CLAN_SECTIONS,
  pathWithinClan,
  sectionHref,
} from "@/lib/clan-nav";

const TAG = "/%232PP0JCCL";

describe("pathWithinClan", () => {
  it("strips the tag segment", () => {
    expect(pathWithinClan(`${TAG}/war/lineup`)).toBe("/war/lineup");
    expect(pathWithinClan(`${TAG}/members`)).toBe("/members");
  });

  it("returns the empty path for the dashboard itself", () => {
    expect(pathWithinClan(TAG)).toBe("");
    expect(pathWithinClan(`${TAG}/`)).toBe("");
  });

  it("keeps a second encoded tag intact", () => {
    expect(pathWithinClan(`${TAG}/player/%23ABC123`)).toBe("/player/%23ABC123");
  });

  // The contract (app)/layout.tsx's currentClanTag() already holds. Every
  // non-clan route under (app) hits exactly this path.
  it.each(["/admin", "/admin/members", "/roster", "/report", "/search", "/guide", "/settings/account", "/"])(
    "returns null for %s rather than throwing",
    (path) => {
      expect(pathWithinClan(path)).toBeNull();
    },
  );

  it("returns null for a segment that is not a tag at all", () => {
    expect(pathWithinClan("/not-a-tag/war")).toBeNull();
  });
});

describe("activeNav", () => {
  // THE REGRESSION. A shorter prefix must never win.
  it("lights the lineup, not the war board, on /war/lineup", () => {
    const active = activeNav(`${TAG}/war/lineup`);
    expect(active?.section.label).toBe("War");
    expect(active?.child?.label).toBe("Lineup");
    expect(active?.child?.path).toBe("/war/lineup");
  });

  it.each([
    ["/war", "Board"],
    ["/war/history", "History"],
    ["/war/report", "Report"],
  ])("resolves %s to the %s sub-tab", (path, child) => {
    const active = activeNav(`${TAG}${path}`);
    expect(active?.section.label).toBe("War");
    expect(active?.child?.label).toBe(child);
  });

  // The other half of the same rule: /cwl/roster is a literal entry, so it must
  // not be read as a season named "roster", and a real season must fall back to
  // Seasons rather than matching nothing.
  it("separates the CWL lineup from a season page", () => {
    expect(activeNav(`${TAG}/cwl/roster`)?.child?.label).toBe("Lineup");
    expect(activeNav(`${TAG}/cwl/2026-08`)?.child?.label).toBe("Seasons");
    expect(activeNav(`${TAG}/cwl/2026-08/report`)?.child?.label).toBe("Seasons");
  });

  it("lights Members on a player profile, which has no tab of its own", () => {
    const active = activeNav(`${TAG}/player/%23ABC123`);
    expect(active?.section.label).toBe("Members");
    expect(active?.child).toBeUndefined();
  });

  // The empty-path case. Overview is the prefix of everything.
  it("lights Overview only on the dashboard itself", () => {
    expect(activeNav(TAG)?.section.label).toBe("Overview");
    expect(activeNav(`${TAG}/members`)?.section.label).toBe("Members");
    expect(activeNav(`${TAG}/polls`)?.section.label).toBe("Polls");
  });

  it("lights the parent section on a child route with no tab", () => {
    expect(activeNav(`${TAG}/polls/new`)?.section.label).toBe("Polls");
    expect(activeNav(`${TAG}/layouts/upload`)?.section.label).toBe("Bases");
  });

  // Segment-matched, like gate.ts. A plain startsWith lights War on /warehouse.
  it("does not light a lookalike path", () => {
    expect(activeNav(`${TAG}/warehouse`)).toBeNull();
    expect(activeNav(`${TAG}/membership`)).toBeNull();
  });

  it("returns null outside a clan rather than throwing", () => {
    expect(activeNav("/admin")).toBeNull();
    expect(activeNav("/roster")).toBeNull();
    expect(activeNav("")).toBeNull();
  });
});

describe("the map itself", () => {
  it("gives every section a hint, because the hint is the plain-language layer", () => {
    const walk = (sections: readonly { hint: string; children?: readonly unknown[] }[]) => {
      for (const s of sections) {
        expect(s.hint.length).toBeGreaterThan(0);
      }
    };
    walk(CLAN_SECTIONS);
    for (const section of CLAN_SECTIONS) {
      if (section.children) walk(section.children);
    }
  });

  // Every card must land in a cluster, or it renders nowhere on the dashboard
  // and becomes unreachable again — which is the defect this module exists to
  // fix, reintroduced by omission.
  it("places every destination in exactly one cluster", () => {
    const cards = CLAN_GROUPS.flatMap((g) => cardsInGroup(g.id));
    const paths = cards.map((c) => c.path);
    expect(new Set(paths).size).toBe(paths.length);

    // Overview is the one deliberate exclusion: the dashboard needs no link to
    // itself. Everything else, including every child, must be on the grid.
    const expected = CLAN_SECTIONS.flatMap((s) =>
      s.children ? s.children.map((c) => c.path) : s.group === null ? [] : [s.path],
    );
    expect(paths.sort()).toEqual(expected.sort());
  });

  it("gives a child card an unambiguous name", () => {
    // "Lineup" appears twice in the tab strip, under different sections, and is
    // only unambiguous there because the section above it says which.
    const war = CLAN_SECTIONS.find((s) => s.label === "War")!;
    const cwl = CLAN_SECTIONS.find((s) => s.label === "CWL")!;
    const warLineup = war.children!.find((c) => c.label === "Lineup")!;
    const cwlLineup = cwl.children!.find((c) => c.label === "Lineup")!;

    expect(cardLabelOf(warLineup)).toBe("War lineup");
    expect(cardLabelOf(cwlLineup)).toBe("CWL lineup");
  });

  it("builds hrefs under the clan tag", () => {
    const members = CLAN_SECTIONS.find((s) => s.label === "Members")!;
    const overview = CLAN_SECTIONS.find((s) => s.label === "Overview")!;
    expect(sectionHref(TAG, members)).toBe(`${TAG}/members`);
    expect(sectionHref(TAG, overview)).toBe(TAG);
  });

  // Round trip: every path in the map must resolve back to itself. This is what
  // catches a destination added to the grid whose route does not exist, or one
  // shadowed by an earlier entry.
  it("resolves every path in the map back to its own entry", () => {
    for (const section of CLAN_SECTIONS) {
      const active = activeNav(`${TAG}${section.path}`);
      expect(active, section.path).not.toBeNull();
      expect(active!.section.path, section.path).toBe(section.path);

      for (const child of section.children ?? []) {
        const childActive = activeNav(`${TAG}${child.path}`);
        expect(childActive?.child?.path, child.path).toBe(child.path);
      }
    }
  });
});
