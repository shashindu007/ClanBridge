// Who sees what inside one clan — the whole rule, in one file.
//
// WHY THIS IS A MODULE AND NOT THIRTEEN COPIES
//
// Thirteen pages had each written some spelling of
//
//   function isLeadership(role: string) {
//     return role === "leader" || role === "co-leader";
//   }
//
// and a fourteenth would have been written the next time somebody needed one:
// [clanTag]/war, war/lineup, notices, polls, polls/[pollId], cwl/roster,
// cwl/[season]/report, /report, /roster, /roster/[season], plus inline variants
// in layouts, polls/new and (app)/layout.tsx. Five more sites hand-rolled
// `role === "leader"` for the leader-only tier.
//
// Meanwhile lib/auth.ts already had the hierarchy — ROLE_RANK, hasRole(),
// requireRole() — and the application called almost none of it. hasRole() had
// exactly two call sites in thirty-three pages; requireRole(),
// requireLeadership() and requireMember() had none at all. So the rank table
// said member < elder < co-leader < leader, and not one line of the product
// could tell an elder from a member.
//
// Extracted the way lib/gate.ts and lib/clan-nav.ts were, and for the same
// reason each of those headers gives: a policy restated at thirteen call sites
// is a policy that drifts, and the drift is invisible because every copy still
// compiles.
//
// ─────────────────────────────────────────────────────────────────────────────
// NULL IS A ROLE HERE, AND IT IS THE NEW ONE
//
// `null` means "an approved account holding no clan_roles row for THIS clan" — a
// visitor. It does not mean signed out: the middleware turned those away, and
// the (app) gate turned away the unapproved. Every predicate below therefore
// takes `ClanRole | null` and none may assume a row exists.
//
// THE VISITOR TIER IS THE ONLY ONE THE DATABASE ENFORCES, and that is worth
// knowing before trusting any of this. A visitor has no clan_roles row, so
// auth_clan_ids() omits the clan and every clan-scoped policy denies them —
// the tier has teeth whatever this file says. Member, elder and leadership are
// presentation decisions over rows the session may already read, exactly as they
// were before this file existed. See the closing note in migration 038 for why
// an elder tier in SQL was considered and deliberately not built.
// ─────────────────────────────────────────────────────────────────────────────

import { hasRole } from "@/lib/auth";
import type { ClanRole } from "@/types/domain";

/**
 * The four bands, least to most privileged.
 *
 * `leadership` covers co-leader AND leader, because every existing gate in the
 * product treats them alike. The one place they differ — /admin and
 * /admin/audit — is asked through `isLeader()` below rather than by adding a
 * fifth band nothing else would use.
 */
export type Tier = "visitor" | "member" | "elder" | "leadership";

export const TIER_RANK: Record<Tier, number> = {
  visitor: 0,
  member: 1,
  elder: 2,
  leadership: 3,
};

/** The band a role falls in. No role in this clan — `null` — is `visitor`. */
export function tierOf(role: ClanRole | null | undefined): Tier {
  if (!role) return "visitor";
  if (hasRole(role, "co-leader")) return "leadership";
  if (hasRole(role, "elder")) return "elder";
  return "member";
}

/**
 * Does this role reach `tier`?
 *
 * The one comparison in the file; every predicate below delegates to it rather
 * than testing a role directly, so the hierarchy is stated once.
 */
export function atLeast(role: ClanRole | null | undefined, tier: Tier): boolean {
  return TIER_RANK[tierOf(role)] >= TIER_RANK[tier];
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE PREDICATE PER QUESTION, NEVER ONE PER ROLE.
//
// `canSeeCwl(role)` rather than `isElder(role)` at the call site, so moving CWL
// from elder to member later is a one-line change here instead of a grep across
// the app — and so a reader of the page can tell what the check is FOR without
// knowing the tier table by heart.
// ─────────────────────────────────────────────────────────────────────────────

// ── Visitor: any approved account, including in a clan they have no role in.
//
// These take a role they ignore, deliberately. A call site reading
// `canSeeRoster(clan.role)` states a decision; an absent check states nothing,
// and the next person cannot tell "everyone may see this" from "nobody thought
// about it".

export const canSeeClanOverview = (_role: ClanRole | null): boolean => true;
export const canSeeRoster = (_role: ClanRole | null): boolean => true;
export const canSearchRoster = (_role: ClanRole | null): boolean => true;

// ── Member: someone who belongs to this clan.
/** Donations given and received, the ratio, and "last seen". */
export const canSeeMemberStats = (role: ClanRole | null): boolean =>
  atLeast(role, "member");
export const canSeeWarBoard = (role: ClanRole | null): boolean =>
  atLeast(role, "member");
export const canSeePolls = (role: ClanRole | null): boolean => atLeast(role, "member");
export const canSeeNotices = (role: ClanRole | null): boolean => atLeast(role, "member");
export const canSeeLayouts = (role: ClanRole | null): boolean => atLeast(role, "member");
/** Another member's profile page. Your own village is always yours — see /account/bases. */
export const canSeePlayerProfile = (role: ClanRole | null): boolean =>
  atLeast(role, "member");

// ── Elder: the clan's ongoing record, as opposed to what is happening today.
/** The "Worth a look" panel on the member directory. */
export const canSeeAttention = (role: ClanRole | null): boolean => atLeast(role, "elder");
export const canSeeCwl = (role: ClanRole | null): boolean => atLeast(role, "elder");
export const canSeeRaids = (role: ClanRole | null): boolean => atLeast(role, "elder");
export const canSeeGames = (role: ClanRole | null): boolean => atLeast(role, "elder");
/**
 * /war/report — contribution across the last ten wars.
 *
 * Elder, while the CURRENT war's plan-and-result table on the war board is
 * member. The board answers "what is happening now", which is everybody's
 * business; this answers "who has been pulling their weight", which is not.
 */
export const canSeeWarReport = (role: ClanRole | null): boolean =>
  atLeast(role, "elder");

// ── Leadership: co-leader and leader. Replaces all thirteen hand-rolled copies.
export const isLeadership = (role: ClanRole | null): boolean =>
  atLeast(role, "leadership");
/** Assign and reassign targets on the war board. Claiming a free base is member-level. */
export const canAssignTargets = (role: ClanRole | null): boolean => isLeadership(role);
export const canEditLineup = (role: ClanRole | null): boolean => isLeadership(role);
export const canEditCwlRoster = (role: ClanRole | null): boolean => isLeadership(role);
export const canAwardBonuses = (role: ClanRole | null): boolean => isLeadership(role);
export const canPostNotices = (role: ClanRole | null): boolean => isLeadership(role);
export const canOpenPolls = (role: ClanRole | null): boolean => isLeadership(role);
/** T4B.4 — members see counts, leadership sees who answered what. */
export const canSeePollNames = (role: ClanRole | null): boolean => isLeadership(role);
/** Remove anybody's layout. The uploader may always remove their own. */
export const canModerateLayouts = (role: ClanRole | null): boolean => isLeadership(role);
/** T11B.10 — another member's hero, troop and spell levels. */
export const canSeeBaseDetails = (role: ClanRole | null): boolean => isLeadership(role);

// ── Leader only.
/**
 * /admin, /admin/audit, and the "check /admin" half of the sync-failure badge.
 *
 * Deliberately NOT `atLeast(role, "leadership")`: 006's audit_log policy is
 * `auth_leader_clan_ids()`, so a co-leader shown the audit link would reach a
 * page the database then empties. The tier and the policy have to agree.
 */
export const isLeader = (role: ClanRole | null): boolean => role === "leader";
