// T10.9 — the headers middleware writes for Server Components to read.
//
// They live in their own module rather than in lib/supabase/middleware.ts,
// where they started, because lib/auth.ts now reads one of them. Importing the
// middleware from there would drag @supabase/ssr, next/server and the Upstash
// rate limiter into every module that wants a header name — including the ones
// the offline test suite imports directly.
//
// A Server Component cannot see the request path or the session any other way:
// headers() exposes what arrived over the wire, and neither of these arrives
// over the wire. Middleware puts them there.

/**
 * The path of the current request.
 *
 * (app)/layout.tsx needs it for the T3.8 gate: it redirects an unapproved user
 * to /pending, and /pending lives inside (app), so without knowing the current
 * path the layout redirects /pending to /pending forever.
 */
export const PATHNAME_HEADER = "x-pathname";

/**
 * The id of the user whose token middleware has ALREADY validated.
 *
 * Middleware calls getUser() on every request — an HTTPS round trip to
 * Supabase's auth server — and (app)/layout.tsx then called currentUserId(),
 * which called getUser() again for the same answer on the same request. React's
 * cache() cannot collapse those two: middleware and the render are separate
 * executions and share nothing. It was a second full round trip on every
 * navigation, buying an answer already in hand.
 *
 * TRUSTWORTHY ONLY BECAUSE IT IS WRITTEN UNCONDITIONALLY. A client may send any
 * header it likes, so an `x-user-id` arriving from the browser must never be
 * believed. forwardedHeaders() in lib/supabase/middleware.ts always sets this
 * from the token it has just verified, or deletes it outright — so a path that
 * skips the check forwards no id rather than whatever the caller invented.
 */
export const USER_ID_HEADER = "x-user-id";
