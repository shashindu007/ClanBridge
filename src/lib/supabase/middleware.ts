// T1.11 / T3.2 — Session refresh, called from src/middleware.ts.
//
// Two things here are easy to get wrong and both fail silently:
//
//  1. The SAME response object that had cookies written to it must be returned.
//     Constructing a fresh NextResponse afterwards discards the refreshed
//     session, and members get logged out at apparently random intervals.
//
//  2. supabase.auth.getUser() must be called, not getSession(). getUser()
//     revalidates the token with Supabase; getSession() trusts the cookie, which
//     the client can forge.

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { WRITE_LIMIT, sharedRateLimiter } from "@/lib/rate-limit";

/**
 * Paths reachable without a session. Everything else redirects to /login.
 *
 *   /login     the form itself
 *   /auth      the magic-link callback and the T10.3 sign-out, both of which
 *              have to work when there is no valid session to begin with
 *   /api/auth  T10.4's password sign-in. An unauthenticated POST is the ONLY
 *              kind that ever arrives there, so omitting it does not make the
 *              route secure — it makes the route answer a 307 to /login and
 *              sign-in silently never work at all.
 */
export const PUBLIC_PATHS = ["/login", "/auth", "/api/auth"];

/**
 * Is this path reachable without a session?
 *
 * Segment-prefix matched, the same rule lib/gate.ts uses, so "/auth" covers
 * "/auth/callback" but "/authorise" is not public. Exported so a test can assert
 * the list without standing up a request — the failure mode here is a route that
 * is quietly unreachable rather than one that is quietly exposed, and nothing
 * else in the suite would notice.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * T9.7 — the write limit, applied once instead of in every Server Action.
 *
 * WHY HERE AND NOT IN THE ACTIONS. There are eleven files containing
 * `"use server"` and there will be more. A check copy-pasted into each is a
 * check that will be missing from the twelfth, and nothing fails when it is —
 * the action works perfectly, it is simply unlimited, which is invisible until
 * somebody finds it. Middleware is the only place every action necessarily
 * passes through.
 *
 * A Server Action is a POST to the page's own URL carrying a `next-action`
 * header, which is what distinguishes it from an ordinary navigation. API
 * routes are deliberately NOT limited here: /api/verify has its own far
 * stricter 5-per-hour budget (T3.3) and /api/push/subscribe its own, and a
 * second limiter over the top would only make the tighter one harder to reason
 * about.
 *
 * Keyed by user id, falling back to IP for the unauthenticated case — which in
 * practice cannot reach an action anyway, since this function redirects those
 * requests to /login a few lines below.
 */
function isServerAction(request: NextRequest): boolean {
  return request.method === "POST" && request.headers.has("next-action");
}

/**
 * Whether this request has budget left.
 *
 * FAILS OPEN, and the distinction from lib/rate-limit.ts's refusal to fall back
 * to an in-memory counter in production is worth being precise about. That
 * refusal is about a limiter that is CONFIGURED WRONG and would silently
 * pretend to work forever. This is about one that is configured correctly and
 * momentarily unreachable. Rejecting every write in the product because Upstash
 * is having a bad minute is a worse outcome than briefly not limiting, and the
 * writes behind this are still gated by RLS and by each action's own role check
 * — the limiter is a budget, never the access control.
 */
async function hasWriteBudget(key: string): Promise<boolean> {
  try {
    const limiter = await sharedRateLimiter(WRITE_LIMIT);
    const { success } = await limiter.limit(`write:${key}`);
    return success;
  } catch (error) {
    console.error(
      `rate limit unavailable, allowing write: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return true;
  }
}

/**
 * Header carrying the current path down to Server Components.
 *
 * (app)/layout.tsx needs it for the T3.8 gate: it redirects an unapproved user
 * to /pending, and /pending lives inside (app), so without knowing the current
 * path the layout redirects /pending to /pending forever. `headers()` in a
 * Server Component exposes request headers but not the pathname, so middleware
 * has to put it there.
 */
export const PATHNAME_HEADER = "x-pathname";

/**
 * A fresh header set carrying PATHNAME_HEADER.
 *
 * Read from `request.headers` at call time rather than from a snapshot, because
 * `request.cookies.set()` mutates the request's cookie header — capturing the
 * headers before that write would send the stale cookie downstream and undo the
 * session refresh.
 */
function headersWithPathname(request: NextRequest, pathname: string): Headers {
  const headers = new Headers(request.headers);
  headers.set(PATHNAME_HEADER, pathname);
  return headers;
}

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    // Loudly, at the edge. Missing config otherwise surfaces as getUser()
    // returning no user, which is indistinguishable from "signed out" — so every
    // member is silently bounced to /login and the cause is invisible.
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}

/**
 * T10.9 — paths this function has nothing useful to do for.
 *
 * getUser() is an HTTPS round trip to Supabase's auth server on every single
 * request that reaches here. For /api/auth/sign-in it buys nothing: the caller
 * is unauthenticated by definition, the path is public so there is no redirect
 * to make, it carries no `next-action` header so the write limiter does not
 * apply, and the route establishes its own session on its own response. The call
 * was pure latency added to the front of every sign-in.
 *
 * Deliberately narrow. /auth/callback is NOT here — it needs the cookie refresh
 * machinery below — and neither is /login, which needs a user to answer "should
 * this person be bounced into the app instead".
 */
function needsNoSession(pathname: string): boolean {
  return pathname === "/api/auth" || pathname.startsWith("/api/auth/");
}

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (needsNoSession(pathname)) {
    return NextResponse.next({
      request: { headers: headersWithPathname(request, pathname) },
    });
  }

  let response = NextResponse.next({
    request: { headers: headersWithPathname(request, pathname) },
  });

  const supabase = createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({
            request: { headers: headersWithPathname(request, pathname) },
          });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Remember where they were headed so login can return them there.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // T9.7 — after the session is resolved, so the budget is per member rather
  // than per IP, and after the redirect above, so an unauthenticated action
  // never consumes anyone's budget.
  if (isServerAction(request)) {
    const key = user?.id ?? request.headers.get("x-forwarded-for") ?? "anonymous";
    if (!(await hasWriteBudget(key))) {
      return new NextResponse("Too many requests. Wait a minute and try again.", {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(WRITE_LIMIT.windowMs / 1000)),
          "Content-Type": "text/plain; charset=utf-8",
        },
      });
    }
  }

  // A signed-in user has no business on /login. Without this they can sit on the
  // form and re-request a magic link that lands them exactly where they already
  // are, which reads as though sign-in silently failed.
  if (user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
