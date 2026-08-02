// T3.5 — Roles and the requireRole() guard.
//
// ROLES ARE PER CLAN, NOT GLOBAL. A co-leader of clan A is an ordinary member of
// clan B. Every function here therefore takes a clan, and there is deliberately
// no `getUserRole(userId)` — a global role is a concept this system does not have,
// and offering one would invite exactly the bug R3 warns about.
//
// The pure parts (ROLE_RANK, hasRole) are separate from the database parts, so the
// hierarchy is testable without a session.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClanRole } from "@/types/domain";

/** Thrown when the caller is authenticated but not permitted. Maps to HTTP 403. */
export class ForbiddenError extends Error {
  readonly clanId?: string;
  readonly required?: ClanRole;

  constructor(message: string, clanId?: string, required?: ClanRole) {
    super(message);
    this.name = "ForbiddenError";
    this.clanId = clanId;
    this.required = required;
  }
}

/** Thrown when there is no session at all. Maps to HTTP 401. */
export class UnauthenticatedError extends Error {
  constructor(message = "Not signed in") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

/** Thrown when the account exists but has not been approved (T3.8). */
export class NotApprovedError extends Error {
  readonly status: string;

  constructor(status: string) {
    super(`Account is ${status}, not approved`);
    this.name = "NotApprovedError";
    this.status = status;
  }
}

/**
 * Least to most privileged. Comparison is by rank, so a check for `elder` passes
 * for a co-leader and a leader too.
 */
export const ROLE_RANK: Record<ClanRole, number> = {
  member: 1,
  elder: 2,
  "co-leader": 3,
  leader: 4,
};

export const ALL_ROLES: ClanRole[] = ["member", "elder", "co-leader", "leader"];

/** Does `actual` meet or exceed `minimum`? Pure; no database. */
export function hasRole(
  actual: ClanRole | null | undefined,
  minimum: ClanRole,
): boolean {
  if (!actual) return false;
  return ROLE_RANK[actual] >= ROLE_RANK[minimum];
}

export interface AuthContext {
  userId: string;
  clanId: string;
  role: ClanRole;
}

/** The signed-in user's id, or null. */
export async function currentUserId(supabase: SupabaseClient): Promise<string | null> {
  // getUser() revalidates the token with Supabase. getSession() trusts the
  // cookie, which the client controls — never use it for an authorisation check.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

/** The user's role in one clan, or null if they have none there. */
export async function clanRole(
  supabase: SupabaseClient,
  userId: string,
  clanId: string,
): Promise<ClanRole | null> {
  const { data, error } = await supabase
    .from("clan_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("clan_id", clanId)
    .is("deleted_at", null);

  if (error || !data?.length) return null;
  return (data[0] as { role: ClanRole }).role;
}

/** Every clan the user belongs to, with their role. Powers the clan switcher (T3.6). */
export async function clanRoles(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, ClanRole>> {
  const { data, error } = await supabase
    .from("clan_roles")
    .select("clan_id, role")
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error || !data) return new Map();
  return new Map(
    (data as Array<{ clan_id: string; role: ClanRole }>).map((r) => [r.clan_id, r.role]),
  );
}

/** T3.8 — 'pending' | 'approved' | 'rejected'. */
export async function accountStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("users")
    .select("status")
    .eq("id", userId)
    .is("deleted_at", null);

  if (error || !data?.length) return null;
  return (data[0] as { status: string }).status;
}

/**
 * The one platform-level capability (015). May add clans and approve accounts
 * that belong to no clan yet.
 *
 * Deliberately separate from ClanRole and never mixed into it: every other
 * permission in this system is per clan, and a helper that returned "leader OR
 * platform admin" would erase that distinction at the first call site that found
 * it convenient.
 */
export async function isPlatformAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("users")
    .select("is_platform_admin")
    .eq("id", userId)
    .is("deleted_at", null);

  if (error || !data?.length) return false;
  return (data[0] as { is_platform_admin: boolean }).is_platform_admin === true;
}

/**
 * The guard every route handler and Server Action calls before acting.
 *
 * Throws rather than returning a boolean, deliberately: the failure mode of a
 * boolean guard is that forgetting the `if` looks identical to passing the check.
 *
 * @throws {UnauthenticatedError} no session
 * @throws {NotApprovedError}     signed in but still pending (T3.8)
 * @throws {ForbiddenError}       no role in that clan, or too low a role
 */
export async function requireRole(
  supabase: SupabaseClient,
  clanId: string,
  minimum: ClanRole,
): Promise<AuthContext> {
  // A blank clanId would otherwise compare against nothing and quietly pass.
  // Refusing it makes an unscoped call a crash rather than an authorisation hole.
  if (!clanId) {
    throw new ForbiddenError("requireRole called without a clan", undefined, minimum);
  }

  const userId = await currentUserId(supabase);
  if (!userId) throw new UnauthenticatedError();

  const status = await accountStatus(supabase, userId);
  if (status !== "approved") throw new NotApprovedError(status ?? "unknown");

  const role = await clanRole(supabase, userId, clanId);
  if (!hasRole(role, minimum)) {
    // Names the requirement, never the user's actual role — that would tell a
    // prober how close they are.
    throw new ForbiddenError(`Requires ${minimum} in this clan`, clanId, minimum);
  }

  return { userId, clanId, role: role as ClanRole };
}

/** Membership only, for a read any member of the clan may perform. */
export function requireMember(supabase: SupabaseClient, clanId: string) {
  return requireRole(supabase, clanId, "member");
}

/** Leadership, for target assignment, bonuses, roster publishing and approvals. */
export function requireLeadership(supabase: SupabaseClient, clanId: string) {
  return requireRole(supabase, clanId, "co-leader");
}
