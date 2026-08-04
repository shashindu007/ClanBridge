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
 *   /guide    being told how to get in is not clan data.
 *   /admin    the bootstrap. See the note above.
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
export const GATE_EXEMPT = ["/pending", "/verify", "/guide", "/admin"] as const;

/**
 * Is this path reachable without an approved account?
 *
 * Prefix-matched on a path SEGMENT, so "/admin" covers "/admin/members" but
 * "/adminfoo" is not exempt — a plain startsWith would let a lookalike route
 * through the gate.
 */
export function isGateExempt(pathname: string): boolean {
  return GATE_EXEMPT.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
