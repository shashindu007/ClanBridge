// T3.8 — which paths an unapproved account may still reach.
//
// Extracted from (app)/layout.tsx so it can be tested directly. The bug this
// exists to prevent was a single missing entry in the list below, and it made
// the platform impossible to bootstrap: the claim-ownership button lives only on
// /admin, the first user to sign in is `pending` by definition, and nobody
// exists yet who could approve them — so they were redirected to /pending
// forever and the platform could never be claimed by anyone.
//
// Nothing failed loudly. Every test passed, the RPC was correct, and the route
// that reaches it was simply unreachable.

/**
 * Paths reachable while `users.status !== 'approved'`.
 *
 *   /pending  must be here or the redirect targets itself forever — it lives
 *             inside (app) and renders through the same layout.
 *   /verify   verifying a player tag is the one useful thing an unapproved
 *             member can do, and it is how they become approvable.
 *
 *             Note that this entry does nothing today: the page is at
 *             src/app/(auth)/verify/page.tsx, so it renders through
 *             (auth)/layout.tsx and never reaches the gate at all. Left in place
 *             because it states the intent, and because moving the page into
 *             (app) later must not silently lock it behind approval.
 *   /guide    being told how to get in is not clan data.
 *   /admin    the bootstrap. See the note above.
 *   /account  T10.5's setup step. A brand-new account is 'pending' by
 *             definition, and setup happens before approval — without this the
 *             gate bounces them from /account/setup to /pending and the setup
 *             they are being forced through is unreachable. Same class of bug as
 *             /admin above, one phase later.
 *
 * Being on this list does NOT make a page public. The middleware still requires
 * a session, RLS still denies an unapproved user every clan-scoped row, and each
 * privileged action guards itself:
 *
 *   claimOwnership    caller's email must equal OWNER_EMAIL, AND
 *                     claim_platform_ownership() refuses once an admin exists
 *   addClan           RLS "platform admin adds clans"
 *   grantSelfLeader   RLS "admin or leader grants roles"
 */
export const GATE_EXEMPT = [
  "/pending",
  "/verify",
  "/guide",
  "/admin",
  "/account",
] as const;

/**
 * Paths reachable while the account still has no username and no password.
 *
 * T10.5 — the setup step is the one gate that runs BEFORE approval, because
 * every account created since the magic link shipped has neither, and the Sign
 * in button does not work for them until they do. It is deliberately a list of
 * one: the whole point is that there is nowhere else to go.
 *
 * /account/setup and not /account, so /settings/account — where the same values
 * are CHANGED later — is not accidentally reachable mid-setup.
 */
export const SETUP_EXEMPT = ["/account/setup"] as const;

/**
 * Prefix-matched on a path SEGMENT, so "/admin" covers "/admin/members" but
 * "/adminfoo" does not match — a plain startsWith would let a lookalike route
 * through.
 */
function matches(list: readonly string[], pathname: string): boolean {
  return list.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Is this path reachable without an approved account? */
export function isGateExempt(pathname: string): boolean {
  return matches(GATE_EXEMPT, pathname);
}

/** Is this path reachable before the account has been set up? */
export function isSetupExempt(pathname: string): boolean {
  return matches(SETUP_EXEMPT, pathname);
}
