// T10.4 — /api/auth/sign-in, at the route level.
//
// Two properties this route has to keep, and both are the kind that stay correct
// until somebody adds a helpful error message:
//
//   1. It says the same thing however sign-in failed. "Invalid login
//      credentials" and "Email not confirmed" are different Supabase strings for
//      different states, and returning them turns this endpoint into an oracle
//      that reports which email addresses have accounts here.
//   2. It refuses before Supabase is asked, once the budget is spent. A limiter
//      applied after the credential check is not a limiter.
//
// Structure follows test/verify-route.test.ts, which proves the same shape for
// the other rate-limited route in the project.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetSharedRateLimiters, SIGN_IN_LIMIT } from "@/lib/rate-limit";

const signInWithPassword = vi.hoisted(() => vi.fn());
const upsert = vi.hoisted(() => vi.fn());
const from = vi.hoisted(() => vi.fn(() => ({ upsert })));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword }, from }),
}));

const { POST } = await import("@/app/api/auth/sign-in/route");

const USER = "11111111-0000-4000-8000-0000000000a1";
const EMAIL = "member@example.com";
const PASSWORD = "correct-horse-battery";

function post(body: unknown, ip = "203.0.113.7"): Request {
  return new Request("http://localhost/api/auth/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/sign-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSharedRateLimiters();
    signInWithPassword.mockResolvedValue({
      data: { user: { id: USER, email: EMAIL } },
      error: null,
    });
    upsert.mockResolvedValue({ error: null });
  });

  describe("refusals that cost nothing", () => {
    it("400s on a body that is not JSON, without asking Supabase", async () => {
      const res = await POST(
        new Request("http://localhost/api/auth/sign-in", { method: "POST", body: "{" }),
      );
      expect(res.status).toBe(400);
      expect(signInWithPassword).not.toHaveBeenCalled();
    });

    it("400s on a missing password", async () => {
      const res = await POST(post({ email: EMAIL }));
      expect(res.status).toBe(400);
      expect(signInWithPassword).not.toHaveBeenCalled();
    });

    it("400s on something that is not an email address", async () => {
      const res = await POST(post({ email: "shashi", password: PASSWORD }));
      expect(res.status).toBe(400);
      expect(signInWithPassword).not.toHaveBeenCalled();
    });

    // 72 bytes is bcrypt's ceiling. Anything longer cannot be a password this
    // system ever stored, so there is nothing to check it against.
    it("400s on a password past the bcrypt ceiling", async () => {
      const res = await POST(post({ email: EMAIL, password: "x".repeat(200) }));
      expect(res.status).toBe(400);
      expect(signInWithPassword).not.toHaveBeenCalled();
    });
  });

  describe("what a failure is allowed to say", () => {
    it("401s with one sentence, whatever Supabase said", async () => {
      signInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid login credentials" },
      });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(post({ email: EMAIL, password: "wrong-password" }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe("Wrong email or password.");
    });

    // The enumeration oracle, stated as a test. Every one of these is a
    // different state at Supabase and they must be indistinguishable here, or
    // the route reports which addresses have accounts.
    it.each([
      "Invalid login credentials",
      "Email not confirmed",
      "User not found",
      "Email logins are disabled",
    ])("gives the identical answer for %s", async (message) => {
      signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message } });
      vi.spyOn(console, "error").mockImplementation(() => {});

      const res = await POST(post({ email: EMAIL, password: PASSWORD }));
      const body = await res.text();

      expect(res.status).toBe(401);
      expect(body).toBe(JSON.stringify({ error: "Wrong email or password." }));
      expect(body).not.toContain(message);
    });

    // ── A transport failure is NOT a credential failure ────────────────────
    //
    // The enumeration argument above is about the ANSWER to a credential check.
    // These never got one: the request did not reach Supabase, so the reply is
    // identical whether the address exists or not and there is nothing to leak.
    //
    // The bug this covers was watched happening. A network drop produced
    // `AuthRetryableFetchError: fetch failed` with status 0, the route answered
    // 401 "Wrong email or password", and the password had never been checked
    // against anything.
    describe("when the auth server cannot be reached", () => {
      /** What @supabase/auth-js actually throws. The guard reads `name`. */
      function retryable(message = "fetch failed") {
        const error = new Error(message);
        error.name = "AuthRetryableFetchError";
        (error as Error & { status: number }).status = 0;
        (error as Error & { __isAuthError: boolean }).__isAuthError = true;
        return error;
      }

      it("503s rather than 401, so nobody retypes a password that was never read", async () => {
        signInWithPassword.mockResolvedValue({ data: { user: null }, error: retryable() });
        vi.spyOn(console, "error").mockImplementation(() => {});

        const res = await POST(post({ email: EMAIL, password: PASSWORD }));
        expect(res.status).toBe(503);
      });

      it("says the connection failed, not that the credentials are wrong", async () => {
        signInWithPassword.mockResolvedValue({ data: { user: null }, error: retryable() });
        vi.spyOn(console, "error").mockImplementation(() => {});

        const res = await POST(post({ email: EMAIL, password: PASSWORD }));
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain("Could not reach the server");
        expect(body.error).not.toContain("Wrong email or password");
      });

      it("sends Retry-After, because waiting is the correct action", async () => {
        signInWithPassword.mockResolvedValue({ data: { user: null }, error: retryable() });
        vi.spyOn(console, "error").mockImplementation(() => {});

        const res = await POST(post({ email: EMAIL, password: PASSWORD }));
        expect(res.headers.get("Retry-After")).toBe("5");
      });

      // The half of the old behaviour worth keeping: the member is told the
      // connection failed, and the transport detail stays in the log.
      it("keeps the underlying message out of the response", async () => {
        signInWithPassword.mockResolvedValue({
          data: { user: null },
          error: retryable("getaddrinfo ENOTFOUND xyz.supabase.co"),
        });
        vi.spyOn(console, "error").mockImplementation(() => {});

        const res = await POST(post({ email: EMAIL, password: PASSWORD }));
        expect(await res.text()).not.toContain("ENOTFOUND");
      });

      // The guard must be narrow. An ordinary rejection is still 401, or this
      // change has quietly turned every wrong password into "try again later"
      // and the enumeration protection with it.
      it("does not catch an ordinary credential rejection", async () => {
        signInWithPassword.mockResolvedValue({
          data: { user: null },
          error: { message: "Invalid login credentials" },
        });
        vi.spyOn(console, "error").mockImplementation(() => {});

        const res = await POST(post({ email: EMAIL, password: PASSWORD }));
        expect(res.status).toBe(401);
        expect((await res.json()).error).toBe("Wrong email or password.");
      });
    });

    it("logs the real reason so it is still debuggable", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      signInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: "Email logins are disabled" },
      });

      await POST(post({ email: EMAIL, password: PASSWORD }));
      expect(JSON.stringify(spy.mock.calls)).toContain("Email logins are disabled");
    });

    // Logged, but not the password. The log is the one place a careless line
    // would put it, and unlike the response body nobody reads the log until
    // something has already gone wrong.
    it("never writes the submitted password anywhere", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      signInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid login credentials" },
      });

      const res = await POST(post({ email: EMAIL, password: PASSWORD }));

      expect(await res.text()).not.toContain(PASSWORD);
      expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD);
    });
  });

  describe("rate limiting", () => {
    it(`allows ${SIGN_IN_LIMIT.max} attempts and refuses the next`, async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      signInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid login credentials" },
      });

      for (let i = 1; i <= SIGN_IN_LIMIT.max; i++) {
        const res = await POST(post({ email: EMAIL, password: "guess" }));
        expect(res.status, `attempt ${i}`).toBe(401);
      }

      const over = await POST(post({ email: EMAIL, password: "guess" }));
      expect(over.status).toBe(429);
      expect(over.headers.get("Retry-After")).toBe("900");
      // The point of the limit: the refused attempt never reaches Supabase.
      expect(signInWithPassword).toHaveBeenCalledTimes(SIGN_IN_LIMIT.max);
    });

    // Two keys, because they stop different attacks. Exhausting one address must
    // not lock out a different member who happens to share an office.
    it("counts per email as well as per host", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      signInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid login credentials" },
      });

      for (let i = 0; i < SIGN_IN_LIMIT.max; i++) {
        await POST(post({ email: EMAIL, password: "guess" }, "198.51.100.1"));
      }

      // Same address from a different host: still out of budget.
      const sameEmail = await POST(post({ email: EMAIL, password: "guess" }, "198.51.100.2"));
      expect(sameEmail.status).toBe(429);

      // Different address from a fresh host: unaffected.
      const otherEmail = await POST(
        post({ email: "other@example.com", password: "guess" }, "198.51.100.3"),
      );
      expect(otherEmail.status).toBe(401);
    });

    it("returns RateLimit headers so a client can back off", async () => {
      const res = await POST(post({ email: EMAIL, password: PASSWORD }));
      expect(res.headers.get("RateLimit-Limit")).toBe(String(SIGN_IN_LIMIT.max));
    });

    // Case-folded, or "Member@example.com" and "member@example.com" get a budget
    // each and the per-email limit counts for nothing.
    it("keys the budget on the folded address", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      signInWithPassword.mockResolvedValue({
        data: { user: null },
        error: { message: "Invalid login credentials" },
      });

      for (let i = 0; i < SIGN_IN_LIMIT.max; i++) {
        await POST(post({ email: EMAIL, password: "guess" }));
      }

      const shouted = await POST(post({ email: EMAIL.toUpperCase(), password: "guess" }));
      expect(shouted.status).toBe(429);
    });
  });

  describe("success", () => {
    it("200s with a destination", async () => {
      const res = await POST(post({ email: EMAIL, password: PASSWORD, next: "/roster" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, next: "/roster" });
    });

    // The open-redirect guard, at the second of its two call sites. A login form
    // that honours ?next=//evil.com is a login form that signs somebody in and
    // then hands them to a phishing page.
    it("refuses to send the member off-site", async () => {
      const res = await POST(post({ email: EMAIL, password: PASSWORD, next: "//evil.com" }));
      expect((await res.json()).next).toBe("/");
    });

    it("folds the address before signing in", async () => {
      await POST(post({ email: "  Member@Example.com ", password: PASSWORD }));
      expect(signInWithPassword).toHaveBeenCalledWith({
        email: EMAIL,
        password: PASSWORD,
      });
    });

    // Nothing else creates public.users — there is no trigger on auth.users, and
    // a session with no profile row is unrecoverable: accountStatus() returns
    // null, the T3.8 gate treats them as unapproved forever, and no leader can
    // see them to approve. /auth/callback has always done this; password sign-in
    // is a second path that produces a session and needs the same guarantee.
    it("ensures the profile row exists", async () => {
      await POST(post({ email: EMAIL, password: PASSWORD }));
      expect(from).toHaveBeenCalledWith("users");
      expect(upsert).toHaveBeenCalledWith(
        { id: USER, email: EMAIL },
        { ignoreDuplicates: true },
      );
    });

    // The member is signed in either way. Failing the request because a
    // defensive upsert failed would lock out somebody whose row already exists.
    it("still signs them in when the profile upsert fails", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      upsert.mockResolvedValue({ error: { message: "boom" } });

      const res = await POST(post({ email: EMAIL, password: PASSWORD }));
      expect(res.status).toBe(200);
    });
  });
});
