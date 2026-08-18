// T10.9 — the headers middleware forwards to Server Components.
//
// The reason this file exists is one line in lib/supabase/middleware.ts:
// forwardedHeaders() writes USER_ID_HEADER unconditionally. lib/auth.ts trusts
// that header instead of calling getUser() a second time, so if a browser could
// put its own `x-user-id` on a request, it would choose who it is signed in as.
// Nothing else in the suite would notice — every page would work perfectly, for
// the wrong member.
//
// The header never travels over the wire in either direction. Next encodes what
// middleware forwards as `x-middleware-request-*`, listed in
// `x-middleware-override-headers`, which is what these tests read.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
let cookieHandlers: {
  getAll: () => Array<{ name: string; value: string }>;
  setAll: (c: Array<{ name: string; value: string; options?: object }>) => void;
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: typeof cookieHandlers },
  ) => {
    cookieHandlers = options.cookies;
    return { auth: { getUser } };
  },
}));

const { updateSession } = await import("@/lib/supabase/middleware");
const { USER_ID_HEADER, PATHNAME_HEADER } = await import("@/lib/request-headers");

/** What a Server Component would see for `name`, or null if it is not forwarded. */
function forwarded(response: Response, name: string): string | null {
  const overridden =
    response.headers.get("x-middleware-override-headers")?.split(",") ?? [];
  if (!overridden.includes(name)) return null;
  return response.headers.get(`x-middleware-request-${name}`);
}

function requestFor(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://clanbridge.test${path}`, { headers });
}

function signedInAs(id: string) {
  getUser.mockResolvedValue({ data: { user: { id } }, error: null });
}

function signedOut() {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

describe("USER_ID_HEADER — the id a Server Component may believe", () => {
  it("forwards the id when getUser has validated one", async () => {
    signedInAs("real-user");
    const response = await updateSession(requestFor("/roster"));
    expect(forwarded(response, USER_ID_HEADER)).toBe("real-user");
  });

  it("does not forward an id the browser supplied", async () => {
    signedOut();
    // /login rather than /roster: a signed-out request to a private path is
    // redirected, and a redirect forwards no request headers to assert on.
    const response = await updateSession(
      requestFor("/login", { [USER_ID_HEADER]: "somebody-else" }),
    );
    expect(forwarded(response, USER_ID_HEADER)).toBeNull();
  });

  it("overwrites a forged id with the validated one", async () => {
    signedInAs("real-user");
    const response = await updateSession(
      requestFor("/roster", { [USER_ID_HEADER]: "somebody-else" }),
    );
    expect(forwarded(response, USER_ID_HEADER)).toBe("real-user");
  });

  it("forwards no id on a path that skips the session check", async () => {
    // needsNoSession() short-circuits before getUser(), so there is no validated
    // id here at all — and therefore nothing that may be believed downstream.
    const response = await updateSession(
      requestFor("/api/auth/sign-in", { [USER_ID_HEADER]: "somebody-else" }),
    );
    expect(forwarded(response, USER_ID_HEADER)).toBeNull();
    expect(getUser).not.toHaveBeenCalled();
  });

  it("still forwards the pathname alongside it", async () => {
    signedInAs("real-user");
    const response = await updateSession(requestFor("/roster"));
    expect(forwarded(response, PATHNAME_HEADER)).toBe("/roster");
  });
});

describe("the refreshed session survives the response being built last", () => {
  it("carries cookies written during getUser onto the returned response", async () => {
    // The response is now constructed after getUser(), because that is the first
    // moment the user id exists. Anything setAll() wrote before then has to be
    // replayed onto it — dropping it logs members out at random intervals, which
    // is the failure this file's subject warns about.
    getUser.mockImplementation(async () => {
      cookieHandlers.setAll([
        { name: "sb-access-token", value: "refreshed", options: { path: "/" } },
      ]);
      return { data: { user: { id: "real-user" } }, error: null };
    });

    const response = await updateSession(requestFor("/roster"));

    expect(response.cookies.get("sb-access-token")?.value).toBe("refreshed");
    expect(forwarded(response, USER_ID_HEADER)).toBe("real-user");
  });
});
