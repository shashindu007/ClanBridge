// T10.3 — /auth/sign-out.
//
// The gap it fills was total: before this route there was no signOut() call
// anywhere in the project and no cookie deletion code at all, so a session ended
// when it expired and not before. A member with two accounts was stuck on
// whichever one they opened a link with.
//
// The failure this file is really guarding against is the quiet one. If a single
// sb-* cookie survives, updateSession() still resolves a user on the next
// request, the middleware bounces them off /login back into the app, and the
// button looks like it does nothing — which is indistinguishable from the bug it
// was written to fix.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const signOut = vi.hoisted(() => vi.fn());

/** A stand-in for next/headers' cookie store, holding what the browser sent. */
const store = vi.hoisted(() => {
  const jar = new Map<string, string>();
  return {
    jar,
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    delete: (name: string) => void jar.delete(name),
    set: (name: string, value: string) => void jar.set(name, value),
  };
});

vi.mock("next/headers", () => ({ cookies: async () => store }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signOut } }),
}));

const { POST, ...handlers } = await import("@/app/auth/sign-out/route");

function post(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("https://clanbridge.example/auth/sign-out", {
    method: "POST",
    headers: { host: "clanbridge.example", ...headers },
  });
}

describe("POST /auth/sign-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.jar.clear();
    store.jar.set("sb-abcdef-auth-token", "eyJ...");
    store.jar.set("sb-abcdef-auth-token.1", "...more");
    store.jar.set("theme", "dark");
    signOut.mockResolvedValue({ error: null });
  });

  it("revokes the session at Supabase, not only locally", async () => {
    await POST(post({ origin: "https://clanbridge.example" }));
    // Without this, a cookie copied before sign-out still buys a fresh access
    // token from the refresh endpoint.
    expect(signOut).toHaveBeenCalled();
  });

  // The regression that would be invisible. Belt and braces over signOut()'s own
  // clearing, because this project never states the cookie names anywhere and
  // therefore cannot notice when @supabase/ssr changes them.
  it("leaves no sb-* cookie behind", async () => {
    const res = await POST(post({ origin: "https://clanbridge.example" }));

    expect([...store.jar.keys()].filter((n) => n.startsWith("sb-"))).toEqual([]);
    for (const name of ["sb-abcdef-auth-token", "sb-abcdef-auth-token.1"]) {
      expect(res.cookies.get(name)?.value ?? "").toBe("");
    }
  });

  it("leaves cookies that are not the session alone", async () => {
    await POST(post({ origin: "https://clanbridge.example" }));
    expect(store.jar.get("theme")).toBe("dark");
  });

  // 303, not the 307 NextResponse.redirect defaults to. A 307 preserves the
  // method, so the browser re-POSTs to /login — which is a page, not a route
  // handler, and answers 405.
  it("303s to the login form, saying so", async () => {
    const res = await POST(post({ origin: "https://clanbridge.example" }));
    expect(res.status).toBe(303);

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("signed-out")).toBe("1");
  });

  it("signs them out anyway when the revocation fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signOut.mockResolvedValue({ error: { message: "network" } });

    const res = await POST(post({ origin: "https://clanbridge.example" }));

    // An already-invalid token has nothing to revoke, and the member must still
    // end up signed out locally rather than staring at an error.
    expect(res.status).toBe(303);
    expect([...store.jar.keys()].filter((n) => n.startsWith("sb-"))).toEqual([]);
  });

  describe("cross-site", () => {
    it("refuses a POST from another origin", async () => {
      const res = await POST(post({ origin: "https://evil.example" }));
      expect(res.status).toBe(403);
      expect(signOut).not.toHaveBeenCalled();
      expect(store.jar.get("sb-abcdef-auth-token")).toBe("eyJ...");
    });

    it("refuses an Origin that is not a URL", async () => {
      const res = await POST(post({ origin: "not-a-url" }));
      expect(res.status).toBe(403);
    });

    // A browser cannot suppress Origin on a cross-site form POST, so absent
    // means "not the attack this check is for" — curl, a health probe, a test.
    // Rejecting it would break those without closing anything.
    it("allows a request with no Origin at all", async () => {
      const res = await POST(post());
      expect(res.status).toBe(303);
    });
  });

  // A GET sign-out is reachable by a prefetch, an <img src>, or the link scanner
  // in somebody's mail client, and every one of those logs the member out for no
  // reason.
  it("exports no GET handler", () => {
    expect(handlers).not.toHaveProperty("GET");
  });
});
