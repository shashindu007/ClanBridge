// The tier table, as assertions.
//
// This file is what makes the hierarchy real. Before lib/visibility.ts, ROLE_RANK
// declared four ranks and the application could not tell an elder from a member
// anywhere — so the rank table was documentation. Every row of the product's
// visibility matrix is a case below, and the sweep at the bottom is what stops a
// predicate added later from quietly defaulting a visitor into something.

import { describe, expect, it } from "vitest";
import * as v from "@/lib/visibility";
import { ALL_ROLES } from "@/lib/auth";
import type { ClanRole } from "@/types/domain";

/** Every role, plus the one that is not a role. */
const VIEWERS: Array<ClanRole | null> = [null, "member", "elder", "co-leader", "leader"];

describe("tierOf", () => {
  it("puts no role at all in the visitor band", () => {
    expect(v.tierOf(null)).toBe("visitor");
    expect(v.tierOf(undefined)).toBe("visitor");
  });

  it("maps each role to its band, with co-leader and leader sharing one", () => {
    expect(v.tierOf("member")).toBe("member");
    expect(v.tierOf("elder")).toBe("elder");
    expect(v.tierOf("co-leader")).toBe("leadership");
    expect(v.tierOf("leader")).toBe("leadership");
  });

  it("agrees with ROLE_RANK's ordering", () => {
    // The bands must never invert the hierarchy lib/auth.ts already declares.
    const ranks = ALL_ROLES.map((r) => v.TIER_RANK[v.tierOf(r)]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe("atLeast", () => {
  it("is inclusive of the tier asked for", () => {
    expect(v.atLeast("elder", "elder")).toBe(true);
    expect(v.atLeast("co-leader", "elder")).toBe(true);
    expect(v.atLeast("member", "elder")).toBe(false);
  });

  it("lets everyone reach visitor, including nobody", () => {
    for (const viewer of VIEWERS) expect(v.atLeast(viewer, "visitor")).toBe(true);
  });
});

// ── The matrix, one describe per band ────────────────────────────────────────

describe("what a visitor sees", () => {
  // Someone reading another clan's page. The database enforces this one: with no
  // clan_roles row, auth_clan_ids() omits the clan and every clan-scoped policy
  // denies them whatever this module says.
  it("sees the clan overview and the roster, and can search it", () => {
    expect(v.canSeeClanOverview(null)).toBe(true);
    expect(v.canSeeRoster(null)).toBe(true);
    expect(v.canSearchRoster(null)).toBe(true);
  });

  it("sees no donation figures, no war board and no player profiles", () => {
    expect(v.canSeeMemberStats(null)).toBe(false);
    expect(v.canSeeWarBoard(null)).toBe(false);
    expect(v.canSeePlayerProfile(null)).toBe(false);
    expect(v.canSeePolls(null)).toBe(false);
    expect(v.canSeeNotices(null)).toBe(false);
    expect(v.canSeeLayouts(null)).toBe(false);
  });
});

describe("what a member adds", () => {
  it("gains the donation columns and the full war board", () => {
    expect(v.canSeeMemberStats("member")).toBe(true);
    expect(v.canSeeWarBoard("member")).toBe(true);
    expect(v.canSeePolls("member")).toBe(true);
    expect(v.canSeeNotices("member")).toBe(true);
    expect(v.canSeeLayouts("member")).toBe(true);
    expect(v.canSeePlayerProfile("member")).toBe(true);
  });

  it("does not gain the clan's ongoing record", () => {
    expect(v.canSeeAttention("member")).toBe(false);
    expect(v.canSeeCwl("member")).toBe(false);
    expect(v.canSeeRaids("member")).toBe(false);
    expect(v.canSeeGames("member")).toBe(false);
    expect(v.canSeeWarReport("member")).toBe(false);
  });
});

describe("what an elder adds", () => {
  it("gains the attention list, CWL, raids, games and the war report", () => {
    expect(v.canSeeAttention("elder")).toBe(true);
    expect(v.canSeeCwl("elder")).toBe(true);
    expect(v.canSeeRaids("elder")).toBe(true);
    expect(v.canSeeGames("elder")).toBe(true);
    expect(v.canSeeWarReport("elder")).toBe(true);
  });

  it("gains nothing that writes", () => {
    expect(v.isLeadership("elder")).toBe(false);
    expect(v.canAssignTargets("elder")).toBe(false);
    expect(v.canEditLineup("elder")).toBe(false);
    expect(v.canEditCwlRoster("elder")).toBe(false);
    expect(v.canAwardBonuses("elder")).toBe(false);
    expect(v.canPostNotices("elder")).toBe(false);
    expect(v.canOpenPolls("elder")).toBe(false);
    expect(v.canSeePollNames("elder")).toBe(false);
    expect(v.canModerateLayouts("elder")).toBe(false);
    expect(v.canSeeBaseDetails("elder")).toBe(false);
  });
});

describe("leadership", () => {
  // The thirteen hand-rolled copies were all exactly this, and replacing them
  // must not move anybody. If either row below changes, the refactor was not one.
  it.each(["co-leader", "leader"] as const)("%s can do everything a leader page offers", (role) => {
    expect(v.isLeadership(role)).toBe(true);
    expect(v.canAssignTargets(role)).toBe(true);
    expect(v.canEditLineup(role)).toBe(true);
    expect(v.canEditCwlRoster(role)).toBe(true);
    expect(v.canAwardBonuses(role)).toBe(true);
    expect(v.canPostNotices(role)).toBe(true);
    expect(v.canOpenPolls(role)).toBe(true);
    expect(v.canSeePollNames(role)).toBe(true);
    expect(v.canModerateLayouts(role)).toBe(true);
    expect(v.canSeeBaseDetails(role)).toBe(true);
  });

  it.each(["member", "elder"] as const)("%s is not leadership", (role) => {
    expect(v.isLeadership(role)).toBe(false);
  });

  it("is not leadership for a visitor", () => {
    expect(v.isLeadership(null)).toBe(false);
  });
});

describe("isLeader — the one place co-leader and leader differ", () => {
  it("is true for a leader only", () => {
    expect(v.isLeader("leader")).toBe(true);
    expect(v.isLeader("co-leader")).toBe(false);
    expect(v.isLeader("elder")).toBe(false);
    expect(v.isLeader("member")).toBe(false);
    expect(v.isLeader(null)).toBe(false);
  });

  // 006's audit_log policy is auth_leader_clan_ids(). A co-leader shown the
  // /admin link would reach a page the database then empties, so the tier and
  // the policy have to agree — and this is the assertion that keeps them agreed.
  it("is stricter than leadership, deliberately", () => {
    expect(v.isLeadership("co-leader")).toBe(true);
    expect(v.isLeader("co-leader")).toBe(false);
  });
});

// ── The sweep ────────────────────────────────────────────────────────────────

describe("every predicate is monotonic in the hierarchy", () => {
  // A higher role must never see LESS. Written as a sweep rather than per
  // predicate because the failure it catches — someone writing
  // `role === "elder"` instead of `atLeast(role, "elder")`, which denies
  // co-leaders — looks correct at the call site and is invisible in review.
  const predicates = Object.entries(v).filter(
    ([name, value]) => typeof value === "function" && /^(can|is)/.test(name),
  ) as Array<[string, (r: ClanRole | null) => boolean]>;

  it("covers every exported predicate", () => {
    // A guard on the guard: if the naming convention changes, this sweep would
    // silently start testing nothing.
    expect(predicates.length).toBeGreaterThanOrEqual(20);
  });

  it.each(predicates)("%s never denies a higher role than it allows", (_name, predicate) => {
    const allowed = VIEWERS.map((r) => predicate(r));
    // Once true, stays true, reading visitor -> member -> elder -> leadership.
    const firstTrue = allowed.indexOf(true);
    if (firstTrue === -1) return;
    expect(allowed.slice(firstTrue).every(Boolean)).toBe(true);
  });
});

describe("only the three visitor predicates admit a viewer with no role", () => {
  // The important one. A predicate added later without thinking about visitors
  // fails here rather than in production on somebody else's clan page.
  const VISITOR_OK = new Set(["canSeeClanOverview", "canSeeRoster", "canSearchRoster"]);

  const predicates = Object.entries(v).filter(
    ([name, value]) => typeof value === "function" && /^(can|is)/.test(name),
  ) as Array<[string, (r: ClanRole | null) => boolean]>;

  it.each(predicates)("%s", (name, predicate) => {
    expect(predicate(null)).toBe(VISITOR_OK.has(name));
  });
});
