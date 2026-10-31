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
import { isPublicPath, isServerAction, PUBLIC_EXACT_PATHS, PUBLIC_PATHS } from "@/lib/supabase/middleware";

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
// The write limit keyed on the next-action header, which only the client router
// sends. Next also runs an action from a plain form post, with no header at all.
describe("isServerAction", () => {
  const request = (method: string, headers: Record<string, string> = {}) =>
    ({ method, headers: new Headers(headers) }) as Parameters<typeof isServerAction>[0];

  it("sees the client router's action", () => {
    expect(isServerAction(request("POST", { "next-action": "abc" }))).toBe(true);
  });

  it.each(["multipart/form-data; boundary=x", "application/x-www-form-urlencoded"])(
    "sees a plain form post with no header: %s",
    (type) => {
      expect(isServerAction(request("POST", { "content-type": type }))).toBe(true);
    },
  );

  it("leaves reads and JSON route handlers alone", () => {
    expect(isServerAction(request("GET", { "next-action": "abc" }))).toBe(false);
    expect(isServerAction(request("POST", { "content-type": "application/json" }))).toBe(false);
  });
});

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
    "/offline.html",
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

  // The bare `game/` prefix skipped this: [clanTag] is "game", so it routes to
  // [clanTag]/war, Server Actions and all, with no write limit and a client-sent
  // x-user-id believed. Every segment that can follow [clanTag] is listed, and
  // none of them may ever be the name of a folder in public/game.
  it.each(
    ["cwl", "games", "layouts", "members", "notices", "player", "polls", "raids", "war"].flatMap((segment) => [
      `/game/${segment}`,
      `/icons/${segment}`,
      `/scenes/${segment}`,
      `/game/${segment}/x.png`,
    ]),
  )("runs on a route that only starts like an asset folder: %s", (path) => {
    expect(runsOn(path)).toBe(true);
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
