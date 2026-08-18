// T3.5 — Roles and the requireRole() guard.
//
// ROLES ARE PER CLAN, NOT GLOBAL. A co-leader of clan A is an ordinary member of
// clan B. Every function here therefore takes a clan, and there is deliberately
// no `getUserRole(userId)` — a global role is a concept this system does not have,
// and offering one would invite exactly the bug R3 warns about.
//
// The pure parts (ROLE_RANK, hasRole) are separate from the database parts, so the
// hierarchy is testable without a session.

//
// T10.9 — EVERY DATABASE FUNCTION HERE IS MEMOISED PER REQUEST.
//
// Not an optimisation detail; it was the reason navigation felt broken. One
// click on a nav link ran this sequence, each line a separate network round trip
// to a free-tier database in another region:
//
//   middleware      getUser()                        <- unavoidable, the gate
//   (app)/layout    currentUserId()  -> getUser()    <- the same answer again
//   (app)/layout    accountProfile()                 <- users row
//   (app)/layout    isPlatformAdmin()                <- the SAME users row again
//   (app)/layout    visibleClans()   -> clanRoles + clans
//   the page        currentUserId()  -> getUser()    <- the same answer a third time
//   the page        requireClanByTag -> visibleClans -> clanRoles + clans again
//
// Nine or ten round trips before the first byte of the page, and — because the
// layout runs OUTSIDE the (app)/loading.tsx Suspense boundary — before even the
// loading skeleton could appear. From the member's side that is a button that
// does nothing for a second and a half.
//
// cache() collapses the repeats: the layout pays for each distinct read once and
// the page gets it free. It is scoped to a single request, so it is a
// deduplication and never a stale cache — a Server Action's re-render is a new
// request and reads fresh.
//
// It works only because createClient() in lib/supabase/server.ts is itself
// cached. cache() keys on argument identity, and these all take `supabase` as
// their first argument.

import type { SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { cache } from "react";
import { USER_ID_HEADER } from "@/lib/request-headers";
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

/**
 * The user id middleware validated for this request, if this is a request at all.
 *
 * Falls back to null rather than throwing, and the fallback is the point: every
 * caller of currentUserId() today runs inside a request, but headers() throws
 * outside one, and a helper that brings down a page because it could not find an
 * optimisation is worse than the round trip it was avoiding. A null here simply
 * means the caller pays for getUser(), which is what it did before.
 */
async function forwardedUserId(): Promise<string | null> {
  try {
    return (await headers()).get(USER_ID_HEADER);
  } catch {
    return null;
  }
}

/**
 * The signed-in user's id, or null.
 *
 * The single most-called function in the product — the layout wants it, the page
 * wants it, and requireClanByTag wants it, all in one render. getUser() is an
 * HTTPS call to Supabase's auth server every time, so those three used to cost
 * three round trips for one answer. Now they cost one.
 */
export const currentUserId = cache(async function currentUserId(
  supabase: SupabaseClient,
): Promise<string | null> {
  // Middleware has already done this exact work for this exact request, and
  // getUser() is an HTTPS round trip. Reuse its answer when it is there.
  //
  // NOT a weaker check. The id is only present because middleware called
  // getUser() and Supabase verified the token; forwardedHeaders() writes it
  // unconditionally, so a browser cannot put one there itself. See
  // USER_ID_HEADER for why that unconditional write is the whole safety
  // argument.
  const forwarded = await forwardedUserId();
  if (forwarded) return forwarded;

  // getUser() revalidates the token with Supabase. getSession() trusts the
  // cookie, which the client controls — never use it for an authorisation check.
  //
  // Caching does NOT weaken that. The token is still verified with Supabase; it
  // is verified once per request instead of three times per request, and the
  // three callers were always going to get the same answer.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
});

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

/**
 * Every clan the user belongs to, with their role. Powers the clan switcher (T3.6).
 *
 * Cached because the layout builds the switcher from it and then every
 * clan-scoped page resolves its own tag through visibleClans(), which reads it
 * again for the same answer.
 */
export const clanRoles = cache(async function clanRoles(
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
});

/** What (app)/layout.tsx needs about the signed-in member, in one read. */
export interface AccountProfile {
  /** T3.8 — 'pending' | 'approved' | 'rejected'. */
  status: string;
  email: string;
  /** T10 — null until /account/setup has been completed. */
  username: string | null;
  passwordSetAt: string | null;
  /** T3.5 — the one platform-level capability (015). */
  isPlatformAdmin: boolean;
}

/**
 * The member's own profile row.
 *
 * ONE QUERY, deliberately. (app)/layout.tsx runs on every navigation in the
 * product and needs all five of these columns — the approval gate needs
 * `status`, the T10.5 setup gate needs `username` and `password_set_at`, the nav
 * shows the identity so a member with two accounts can tell which one they are
 * on, and the Admin link needs `is_platform_admin`. Five helpers each doing
 * their own select would be five round trips to a free-tier database in another
 * region, added to every page load. The layout's own comment already makes this
 * argument about two.
 *
 * Returns null when there is no row, which is a real state: /auth/callback
 * creates the profile and it can fail. The caller must treat null as "not
 * approved and not set up" rather than as an error.
 */
export const accountProfile = cache(async function accountProfile(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccountProfile | null> {
  const { data, error } = await supabase
    .from("users")
    .select("status, email, username, password_set_at, is_platform_admin")
    .eq("id", userId)
    .is("deleted_at", null);

  if (error || !data?.length) return null;

  const row = data[0] as {
    status: string;
    email: string | null;
    username: string | null;
    password_set_at: string | null;
    is_platform_admin: boolean | null;
  };

  return {
    status: row.status,
    email: row.email ?? "",
    username: row.username,
    passwordSetAt: row.password_set_at,
    isPlatformAdmin: row.is_platform_admin === true,
  };
});

/**
 * T10.5 — has this account got through /account/setup?
 *
 * BOTH halves, not either. A username with no password cannot use the Sign in
 * button; a password with no username has no handle. Pure, so the rule is stated
 * once and the layout and the setup page cannot disagree about who is finished.
 */
export function needsAccountSetup(profile: AccountProfile | null): boolean {
  if (!profile) return true;
  return !profile.username || !profile.passwordSetAt;
}

/**
 * T3.8 — 'pending' | 'approved' | 'rejected'.
 *
 * Kept as its own function because requireRole() and several callers want only
 * this, and asking them to destructure a profile would be noise. It delegates,
 * so there is one query shape to keep working.
 */
export async function accountStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const profile = await accountProfile(supabase, userId);
  return profile?.status ?? null;
}

/**
 * The one platform-level capability (015). May add clans and approve accounts
 * that belong to no clan yet.
 *
 * Deliberately separate from ClanRole and never mixed into it: every other
 * permission in this system is per clan, and a helper that returned "leader OR
 * platform admin" would erase that distinction at the first call site that found
 * it convenient.
 *
 * Delegates to accountProfile() rather than running its own select. It read the
 * same row from the same table, so in (app)/layout.tsx — which needs both — the
 * two were literally the same query issued twice, one after the other, on every
 * navigation in the product.
 */
export async function isPlatformAdmin(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const profile = await accountProfile(supabase, userId);
  return profile?.isPlatformAdmin === true;
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
