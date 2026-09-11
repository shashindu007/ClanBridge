// Where a member can go inside one clan, and what each of those places is for.
//
// WHY THIS IS A MODULE AND NOT JSX IN THE DASHBOARD
//
// It used to be thirteen hand-written <Go> elements in [clanTag]/page.tsx and
// nothing else — which made the dashboard the only door into thirty-three
// pages. Open /members and the sole route to the war board was the browser's
// Back button, because no layout under [clanTag] existed to carry a nav and no
// page rendered one of its own.
//
// The same file also carried the one-line description of every destination, so
// those lines existed in exactly one place that a member had to already be on
// the dashboard to read. The hints are the product's plain-language layer for
// somebody who has never used it; they belong where the tab strip, the grid and
// /guide can all read them from, or two of the three drift. That is not a
// hypothetical: the "Not built yet" list three sections below the grid claimed
// the base layout library was unbuilt while the grid directly above it linked to
// the working page.
//
// Extracted from the layout the way lib/gate.ts was, and for the same reason:
// so the matching below can be tested without rendering a React tree. gate.ts's
// matches() is also the precedent for the segment-boundary rule — a plain
// startsWith would let "/warehouse" light up the War tab.
//
// R3 IS NOT AT RISK HERE. This is a list of routes within a clan, not a list of
// clans. Every path is relative to whichever [clanTag] the member is already
// authorised for, and the tag itself still comes from requireClanByTag().

import {
  Castle,
  ClipboardList,
  Gamepad2,
  Gauge,
  Layers,
  LayoutGrid,
  Megaphone,
  Swords,
  Target,
  Trophy,
  Users,
  Vote,
} from "lucide-react";
import { decodeTag } from "@/lib/tags";

/** Which cluster a destination belongs to on the dashboard grid. */
export type ClanGroup = "war" | "league" | "clan" | "share";

export interface ClanSection {
  /**
   * Path suffix under `/[clanTag]`. `""` is the clan dashboard itself.
   *
   * Never begins with the tag — see `sectionHref`, which joins the two.
   */
  path: string;
  /** One or two words, for the tab strip. The word a member would say out loud. */
  label: string;
  /**
   * The longer name, for the dashboard card, where "Lineup" on its own would be
   * ambiguous between a war lineup and a CWL one. Falls back to `label`.
   */
  cardLabel?: string;
  /** The plain-language line. Rendered on the card, the tab's title, and /guide. */
  hint: string;
  icon: typeof Users;
  /**
   * The dashboard cluster. `null` for Overview, which is a tab but not a card —
   * the dashboard does not need a link to itself.
   */
  group: ClanGroup | null;
  /** Sub-destinations, shown as a second row while this section is active. */
  children?: ClanSection[];
  /**
   * Routes with no tab of their own that should still light this one.
   *
   * A player profile is reached from the member directory and is the same
   * subject, so it highlights Members rather than nothing at all.
   */
  alsoMatches?: string[];
}

export interface ClanGroupMeta {
  id: ClanGroup;
  /** The heading above the cluster. */
  label: string;
  /** One line under the heading, for /guide. The grid is tight enough already. */
  blurb: string;
}

/**
 * The four clusters, in the order they are shown.
 *
 * Ordered by how often a member needs them, not alphabetically: war is the thing
 * that runs on a clock and costs something if missed, and the library of shared
 * bases is the thing nobody opens in a hurry.
 */
export const CLAN_GROUPS: readonly ClanGroupMeta[] = [
  {
    id: "war",
    label: "War",
    blurb: "One war at a time, against one other clan. Runs on a clock.",
  },
  {
    id: "league",
    label: "Clan War League",
    blurb: "Once a month, seven wars in a row, against seven clans.",
  },
  {
    id: "clan",
    label: "The clan",
    blurb: "Who is here, and what everyone has been doing.",
  },
  {
    id: "share",
    label: "Talk and share",
    blurb: "Decisions, notices, and the base designs people have posted.",
  },
];

/**
 * Every destination inside a clan.
 *
 * The hints are written for somebody on their first day. They say what the page
 * answers, not what it contains — "who has gone quiet" rather than "member
 * table" — because a member who does not yet know the product cannot tell which
 * of thirteen tables holds their answer.
 */
export const CLAN_SECTIONS: readonly ClanSection[] = [
  {
    path: "",
    label: "Overview",
    hint: "This clan at a glance — the war on now, and anything needing an answer",
    icon: Gauge,
    group: null,
  },
  {
    path: "/members",
    label: "Members",
    hint: "Donations, ratios, who has gone quiet",
    icon: Users,
    group: "clan",
    // A profile is one member out of the directory, so the directory stays lit.
    alsoMatches: ["/player"],
  },
  {
    path: "/war",
    label: "War",
    // No cardLabel: a section with children is never rendered as a card — the
    // children are. See cardsInGroup.
    hint: "The war that is on right now",
    icon: Swords,
    group: "war",
    children: [
      {
        path: "/war",
        label: "Board",
        cardLabel: "War board",
        hint: "Targets, the chase list, both rosters",
        icon: Swords,
        group: "war",
      },
      {
        path: "/war/lineup",
        label: "Lineup",
        cardLabel: "War lineup",
        hint: "Pick who is in before declaring",
        icon: ClipboardList,
        group: "war",
      },
      {
        path: "/war/history",
        label: "History",
        cardLabel: "War history",
        hint: "Every past war and its result",
        icon: Layers,
        group: "war",
      },
      {
        // T6.9 / T6.10. This was reachable only from the war sub-headers and a
        // player profile, which made the one report answering "did they do what
        // they were told" the hardest page in the app to find.
        path: "/war/report",
        label: "Report",
        cardLabel: "War report",
        hint: "Contribution, and plan versus reality",
        icon: Target,
        group: "war",
      },
    ],
  },
  {
    path: "/cwl",
    label: "CWL",
    hint: "Clan War League — seasons, stars and bonuses",
    icon: Trophy,
    group: "league",
    children: [
      {
        path: "/cwl",
        label: "Seasons",
        cardLabel: "Clan War League",
        hint: "Seasons, stars and bonuses",
        icon: Trophy,
        group: "league",
      },
      {
        // Listed explicitly, which is also what keeps it unambiguous: a season
        // page is /cwl/2026-08, and only a literal entry stops "roster" being
        // read as a season name.
        path: "/cwl/roster",
        label: "Lineup",
        cardLabel: "CWL lineup",
        hint: "The roster for this season",
        icon: ClipboardList,
        group: "league",
      },
    ],
  },
  {
    path: "/raids",
    label: "Raids",
    cardLabel: "Raid weekends",
    hint: "Medals, loot, and who still has attacks",
    icon: Castle,
    group: "clan",
  },
  {
    path: "/games",
    label: "Games",
    cardLabel: "Clan Games",
    hint: "Points per member, month by month",
    icon: Gamepad2,
    group: "clan",
  },
  {
    path: "/polls",
    label: "Polls",
    hint: "Ask, answer, and chase the quiet ones",
    icon: Vote,
    group: "share",
  },
  {
    path: "/notices",
    label: "Notices",
    cardLabel: "Announcements",
    hint: "What leadership has posted",
    icon: Megaphone,
    group: "share",
  },
  {
    path: "/layouts",
    label: "Bases",
    cardLabel: "Base layouts",
    hint: "Shared bases, ranked by votes",
    icon: LayoutGrid,
    group: "share",
  },
];

/** The name to print on a dashboard card. */
export function cardLabelOf(section: ClanSection): string {
  return section.cardLabel ?? section.label;
}

/**
 * The href for a section, given the clan's own base href.
 *
 * `base` is already `encodeURIComponent`d by the caller — every link in this app
 * is built that way, because a tag is `#2PP0JCCL` and the hash would otherwise
 * be read as a fragment.
 */
export function sectionHref(base: string, section: ClanSection): string {
  return `${base}${section.path}`;
}

/**
 * The cards that belong in one cluster.
 *
 * A section with children contributes its children and not itself: "War" is a
 * heading on the grid, so a card that also said "War" would be a link to a
 * group rather than to a page.
 */
export function cardsInGroup(group: ClanGroup): ClanSection[] {
  const cards: ClanSection[] = [];
  for (const section of CLAN_SECTIONS) {
    if (section.children) {
      cards.push(...section.children.filter((c) => c.group === group));
    } else if (section.group === group) {
      cards.push(section);
    }
  }
  return cards;
}

/**
 * Segment-boundary match, straight out of lib/gate.ts.
 *
 * `""` is exact-only: the dashboard is the prefix of every other path in the
 * clan, so the general rule below would light Overview on all of them.
 */
function matches(candidate: string, target: string): boolean {
  if (candidate === "") return target === "";
  return target === candidate || target.startsWith(`${candidate}/`);
}

/**
 * The part of a pathname after the clan tag, or null if it is not a clan route.
 *
 * `/%232PP0JCCL/war/lineup` -> `/war/lineup`, and `/%232PP0JCCL` -> `""`.
 *
 * Returns null rather than throwing for /admin, /roster, /settings and every
 * other route outside a clan, which is the same contract (app)/layout.tsx's
 * currentClanTag() holds and for the same reason: a highlighted nav link is not
 * worth a 500 on the shell that wraps every page in the app.
 */
export function pathWithinClan(pathname: string): string | null {
  const segments = pathname.split("/").filter(Boolean);
  const first = segments[0];
  if (!first) return null;

  try {
    decodeTag(first);
  } catch {
    return null;
  }

  return segments.length === 1 ? "" : `/${segments.slice(1).join("/")}`;
}

export interface ActiveNav {
  /** The top-level tab to light. */
  section: ClanSection;
  /** The sub-tab to light, when the section has a second row. */
  child?: ClanSection;
}

/**
 * Which tab, and which sub-tab, the current path corresponds to.
 *
 * Longest match wins, which is the whole reason this is not a loop of
 * startsWith: `/war/lineup` matches both `/war` and `/war/lineup`, and the
 * shorter answer would light the war board while the member is on the lineup.
 *
 * Takes the full pathname so callers can hand it the middleware header
 * unmodified. Never throws; an unrecognised path simply lights nothing.
 */
export function activeNav(pathname: string): ActiveNav | null {
  const within = pathWithinClan(pathname);
  if (within === null) return null;

  let best: ActiveNav | null = null;
  let bestLength = -1;

  const consider = (
    candidate: string,
    section: ClanSection,
    child?: ClanSection,
  ) => {
    if (!matches(candidate, within)) return;
    // `>` and not `>=`: a parent is offered before its children below, so a tie
    // on length — /war as a section and /war as its Board child — keeps the
    // first, and the explicit child pass immediately after overrides it.
    if (candidate.length > bestLength) {
      best = { section, ...(child ? { child } : {}) };
      bestLength = candidate.length;
    }
  };

  for (const section of CLAN_SECTIONS) {
    consider(section.path, section);
    for (const also of section.alsoMatches ?? []) consider(also, section);
  }

  // Children second, so an exact-length tie with the parent resolves to the
  // child. /war is both the War section and its Board child; the member is on
  // the board, and the second row has to say so.
  for (const section of CLAN_SECTIONS) {
    for (const child of section.children ?? []) {
      if (!matches(child.path, within)) continue;
      if (child.path.length >= bestLength) {
        best = { section, child };
        bestLength = child.path.length;
      }
    }
  }

  return best;
}
