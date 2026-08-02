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

/** Paths reachable without a session. Everything else redirects to /login. */
const PUBLIC_PATHS = ["/login", "/auth"];

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

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

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

  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Remember where they were headed so login can return them there.
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
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
