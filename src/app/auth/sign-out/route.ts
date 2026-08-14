// T10.3 — Sign out.
//
// The gap this fills: until now there was no way out of a session. No /logout,
// no signOut() call anywhere in the project, no cookie deletion code at all. A
// member who signed in with one email was that member until the cookie expired
// — so a second account was unreachable, and signing in as the wrong person was
// unrecoverable without clearing site data by hand.
//
// WHY A ROUTE HANDLER AND NOT A SERVER ACTION. Three reasons, and all three
// matter:
//
//   1. It sits under /auth, which PUBLIC_PATHS in lib/supabase/middleware.ts
//      already reaches without a session. Signing out of an expired session must
//      not itself redirect to /login.
//   2. It is outside the (app) group, so neither the T3.8 approval gate nor the
//      T10.5 setup gate can redirect it. A member stuck on /account/setup with
//      the wrong account must be able to leave.
//   3. A plain <form method="post"> reaches it with no JavaScript.
//
// POST only. A GET sign-out is reachable by a prefetch, an <img src>, or a link
// scanner in somebody's mail client, and every one of those logs the member out
// for no reason.

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Refuse a cross-site POST.
 *
 * Logging somebody out against their will is an annoyance rather than a breach,
 * but it is three lines to close and the alternative is an endpoint any page on
 * the internet can fire at a member.
 *
 * A MISSING Origin is allowed. Browsers have sent it on form POSTs for years,
 * and an attacker cannot suppress it — so absent means "not a cross-site browser
 * form", which is the only thing this check is for. Rejecting absent would break
 * curl and the tests without closing anything.
 */
function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  const host = request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    // An Origin that is not a URL is not one we sent.
    return false;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!sameOrigin(request)) {
    return new NextResponse("Cross-site sign-out refused.", {
      status: 403,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const cookieStore = await cookies();
  const supabase = await createClient();

  // Revokes the refresh token at Supabase as well as clearing the cookie, so a
  // copy of the cookie taken before sign-out cannot be replayed into a new
  // access token. Errors are deliberately not surfaced: if the token was already
  // invalid there is nothing to revoke, and the member must still end up signed
  // out locally.
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error(`sign-out: revoking the session failed — ${error.message}`);
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "?signed-out=1";

  // 303, not the default 307: the browser must follow it with a GET. A 307
  // preserves the method and re-POSTs to /login, which is not a route handler
  // and answers 405.
  const response = NextResponse.redirect(url, 303);

  // Belt and braces over signOut()'s own cookie clearing.
  //
  // This is the failure that would be invisible: if one sb-* cookie survives,
  // updateSession() still resolves a user on the next request, the member is
  // bounced away from /login back into the app, and sign-out looks like a button
  // that does nothing. Clearing them explicitly costs nothing and removes the
  // dependency on @supabase/ssr's cookie names, which this project never states
  // anywhere.
  for (const cookie of cookieStore.getAll()) {
    if (!cookie.name.startsWith("sb-")) continue;
    cookieStore.delete(cookie.name);
    response.cookies.delete(cookie.name);
  }

  return response;
}
