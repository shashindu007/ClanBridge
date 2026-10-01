// T10.4 — which paths the middleware lets through without a session.
//
// This test exists for one line. updateSession() redirects every unauthenticated
// request that is not public to /login, and /api/auth/sign-in only ever receives
// unauthenticated requests — so leaving it out of PUBLIC_PATHS does not make it
// secure, it makes it answer a 307 to a login page nobody asked for, and sign-in
// silently never works.
//
// Nothing else in the suite would notice. The route's own tests call POST()
// directly and pass; the failure only exists once a request goes through the
// middleware, which is to say only in the running product.
//
// Same shape as src/lib/gate.test.ts, and for the same reason: the bug class is
// "a route that is quietly unreachable", and it does not fail loudly anywhere.

import { describe, expect, it } from "vitest";
import { config } from "@/middleware";
import { isPublicPath, PUBLIC_EXACT_PATHS, PUBLIC_PATHS } from "@/lib/supabase/middleware";

describe("PUBLIC_PATHS", () => {
  // The regression. If this fails, the Sign in button does nothing.
  it("lets an unauthenticated POST reach the sign-in route", () => {
    expect(isPublicPath("/api/auth/sign-in")).toBe(true);
  });

  it("covers the paths that must work without a session", () => {
    expect(isPublicPath("/login")).toBe(true); // the form itself
    expect(isPublicPath("/auth/callback")).toBe(true); // the magic link lands here
    expect(isPublicPath("/auth/sign-out")).toBe(true); // signing out of an expired session
  });

  // The gate's actual job. Everything holding clan data still needs a session,
  // and /api is NOT public wholesale — /api/verify and /api/push/subscribe both
  // identify the caller before they do anything.
  // T12.5 — the landing page, and ONLY the landing page. Exact match, so the
  // whole app beneath "/" does not come with it.
  it("makes the landing page public by exact match", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(PUBLIC_EXACT_PATHS).toEqual(["/"]);
  });

  it.each([
    "/dashboard",
    "/feedback",
    "/people",
    "/notifications",
    "/roster",
    "/report",
    "/rating",
    "/admin",
    "/account/setup",
    "/settings/account",
    "/%232PP0JCCL/members",
    "/api/verify",
    "/api/push/subscribe",
  ])("keeps %s behind the session check", (path) => {
    expect(isPublicPath(path)).toBe(false);
  });

  // Segment-matched, not prefix-matched. A plain startsWith would wave
  // "/authorise" or "/api/authorise" straight past the session check.
  it("does not let a lookalike path through", () => {
    expect(isPublicPath("/authorise")).toBe(false);
    expect(isPublicPath("/api/authorise")).toBe(false);
    expect(isPublicPath("/loginfoo")).toBe(false);
  });

  it("is exactly three entries, so adding one is a deliberate act", () => {
    expect(PUBLIC_PATHS).toEqual(["/login", "/auth", "/api/auth"]);
  });
});

// T10.9 — which paths the middleware runs on AT ALL, which is a different
// question from which paths it lets through.
//
// This exists because of a measured defect, not for coverage. `[clanTag]` is a
// dynamic segment at the ROOT of the routing tree, so any single-segment path
// matches it. A browser asks for /favicon.ico unprompted on every page load,
// and the old matcher's named exclusions did not stop that reaching the
// middleware: the dev log read `GET /favicon.ico 307 in 2965ms` — a full
// session lookup and a redirect, for an icon, in parallel with the real page
// and competing with it.
//
// Nothing failed. Every page worked. It just did twice the work per navigation.
describe("the middleware matcher", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  const runsOn = (pathname: string) => matcher.test(pathname);

  // The regression. If any of these start running middleware again, every page
  // load is paying for a second render it throws away.
  it.each([
    "/favicon.ico",
    "/apple-touch-icon.png",
    "/robots.txt",
    "/manifest.json",
    "/sw.js",
    "/icons/icon-192.png",
    "/game/heroes/hero-archer-queen.webp",
    "/scenes/crystal-cave.webp",
    "/apple-touch-icon-precomposed.png",
    "/_next/static/chunk.js",
    "/_next/image",
  ])("does not run on %s", (path) => {
    expect(runsOn(path)).toBe(false);
  });

  // A dot is not an extension. Skipping the middleware for any dotted path let
  // a crafted URL reach a page's Server Actions without it — and with it
  // skipped, a client-supplied forwarded user-id header was never overwritten.
  it.each(["/%23TAG.x/war", "/%232G8YQYRGJ.png/war", "/admin.x", "/api/sync-status.json/x"])(
    "runs on a dotted path that is not a file: %s",
    (path) => {
      expect(runsOn(path)).toBe(true);
    },
  );

  // An extension at the END was the second guess, and it was wrong too:
  // [clanTag] and player/[tag] end a path, so these are real pages.
  it.each([
    "/%232G8YQYRGJ.png",
    "/%232G8YQYRGJ/player/%23ABC.js",
    "/%232G8YQYRGJ/polls/x.css",
    "/roster/2026-10.txt",
    "/sw.js/x",
  ])("runs on a page whose last segment merely ends like a file: %s", (path) => {
    expect(runsOn(path)).toBe(true);
  });

  it.each([
    "/",
    "/login",
    "/%232G8YQYRGJ",
    "/%232G8YQYRGJ/cwl",
    "/%232G8YQYRGJ/player/%23ABC",
    "/admin/members",
    "/roster/2026-08",
    "/account/setup",
    "/auth/callback",
    "/api/auth/sign-in",
    "/api/verify",
  ])("still runs on %s", (path) => {
    expect(runsOn(path)).toBe(true);
  });
});
