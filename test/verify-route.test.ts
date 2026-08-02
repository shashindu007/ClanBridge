// T3.3 — /api/verify, at the route level.
//
// test/verification.test.ts proves the database half. This proves the half above
// it: that the route refuses before it spends anything, and that R8 holds.
//
// verifyPlayerToken is mocked rather than stubbed behind a flag. There is no
// USE_FIXTURES path for verifytoken — coc-client.ts calls fetch directly for it —
// and a dev bypass that accepts a magic token is a bypass that can reach
// production. Mocking keeps the escape hatch in the test file, where it cannot
// be deployed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CocAuthError, CocServerError } from "@/integration/errors";
import { resetSharedRateLimiters } from "@/lib/rate-limit";

const verifyPlayerToken = vi.hoisted(() => vi.fn());
const getUser = vi.hoisted(() => vi.fn());
const rpc = vi.hoisted(() => vi.fn());

vi.mock("@/integration/coc-client", () => ({ verifyPlayerToken }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser }, rpc }),
}));

const { POST } = await import("@/app/api/verify/route");

const USER = "11111111-0000-4000-8000-0000000000a1";
const TAG = "#2PP0JCCL";
const TOKEN = "abc123token";

function post(body: unknown): Request {
  return new Request("http://localhost/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function signedIn(id: string | null) {
  getUser.mockResolvedValue({
    data: { user: id ? { id } : null },
    error: id ? null : { message: "no session" },
  });
}

describe("POST /api/verify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSharedRateLimiters();
    signedIn(USER);
    verifyPlayerToken.mockResolvedValue(true);
    rpc.mockResolvedValue({ data: { ok: true, clan_id: "c" }, error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("refusals that cost nothing", () => {
    it("401s without a session, and never calls the game API", async () => {
      signedIn(null);
      const res = await POST(post({ playerTag: TAG, token: TOKEN }));
      expect(res.status).toBe(401);
      expect(verifyPlayerToken).not.toHaveBeenCalled();
    });

    it("400s on a malformed body", async () => {
      const res = await POST(post({ playerTag: TAG }));
      expect(res.status).toBe(400);
      expect(verifyPlayerToken).not.toHaveBeenCalled();
    });

    it("400s on a body that is not JSON", async () => {
      const res = await POST(
        new Request("http://localhost/api/verify", { method: "POST", body: "{" }),
      );
      expect(res.status).toBe(400);
    });

    // '#REPLACE1' and 'IOS' contain letters no Clash of Clans tag ever has.
    it("400s on a tag that cannot exist, before spending an attempt", async () => {
      const res = await POST(post({ playerTag: "#IOSIOS", token: TOKEN }));
      expect(res.status).toBe(400);
      expect(verifyPlayerToken).not.toHaveBeenCalled();
    });
  });

  describe("rate limiting (5 per user per hour)", () => {
    it("allows five attempts and refuses the sixth", async () => {
      verifyPlayerToken.mockResolvedValue(false); // wrong token, so attempts are spent

      for (let i = 1; i <= 5; i++) {
        const res = await POST(post({ playerTag: TAG, token: TOKEN }));
        expect(res.status, `attempt ${i}`).toBe(422);
      }

      const sixth = await POST(post({ playerTag: TAG, token: TOKEN }));
      expect(sixth.status).toBe(429);
      // The whole point: the sixth never reaches Supercell.
      expect(verifyPlayerToken).toHaveBeenCalledTimes(5);
    });

    it("counts per user, not globally", async () => {
      verifyPlayerToken.mockResolvedValue(false);
      for (let i = 0; i < 5; i++) await POST(post({ playerTag: TAG, token: TOKEN }));

      signedIn("22222222-0000-4000-8000-0000000000b2");
      const other = await POST(post({ playerTag: TAG, token: TOKEN }));
      expect(other.status).toBe(422);
    });

    it("returns RateLimit headers so a client can back off", async () => {
      const res = await POST(post({ playerTag: TAG, token: TOKEN }));
      expect(res.headers.get("RateLimit-Limit")).toBe("5");
      expect(res.headers.get("RateLimit-Remaining")).toBe("4");
    });
  });

  describe("outcomes from the game API", () => {
    it("422s a token Supercell did not accept", async () => {
      verifyPlayerToken.mockResolvedValue(false);
      const res = await POST(post({ playerTag: TAG, token: TOKEN }));
      expect(res.status).toBe(422);
      expect(rpc).not.toHaveBeenCalled();
    });

    // Our misconfiguration must not read as the member's mistake.
    it("503s when COC_API_TOKEN is absent", async () => {
      verifyPlayerToken.mockRejectedValue(new CocAuthError("not set", "/x"));
      const res = await POST(post({ playerTag: TAG, token: TOKEN }));
      expect(res.status).toBe(503);
    });

    it("502s when the game API is unreachable", async () => {
      verifyPlayerToken.mockRejectedValue(new CocServerError("down", "/x", 500));
      const res = await POST(post({ playerTag: TAG, token: TOKEN }));
      expect(res.status).toBe(502);
    });

    it("normalises the tag before calling Supercell", async () => {
      await POST(post({ playerTag: " 2pp0jccl ", token: TOKEN }));
      expect(verifyPlayerToken).toHaveBeenCalledWith(TAG, TOKEN);
    });
  });

  describe("linking", () => {
    it("calls link_verified_player with the normalised tag", async () => {
      await POST(post({ playerTag: "2pp0jccl", token: TOKEN }));
      expect(rpc).toHaveBeenCalledWith("link_verified_player", { p_tag: TAG });
    });

    it("404s a tag that is in none of the clans", async () => {
      rpc.mockResolvedValue({ data: { ok: false, reason: "not_a_member" }, error: null });
      const res = await POST(post({ playerTag: TAG, token: TOKEN }));
      expect(res.status).toBe(404);
    });

    it("409s a tag already linked to someone else", async () => {
      rpc.mockResolvedValue({
        data: null,
        error: { message: "player already linked to another account" },
      });
      const res = await POST(post({ playerTag: TAG, token: TOKEN }));
      expect(res.status).toBe(409);
    });

    // Manual approval is the confirmed policy: verifying never lets anyone in.
    it("succeeds without implying the account is approved", async () => {
      const res = await POST(post({ playerTag: TAG, token: TOKEN }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; message: string };
      expect(body.ok).toBe(true);
      expect(body.message).toMatch(/approve/i);
    });
  });

  // R8 — the token is verified and discarded. Never stored, never logged, never
  // included in an error message. This is the test that keeps it true when
  // somebody later adds a helpful debug line.
  describe("R8 — the token never escapes", () => {
    const cases: Array<[string, () => void]> = [
      ["a rejected token", () => verifyPlayerToken.mockResolvedValue(false)],
      [
        "a game API failure",
        () => verifyPlayerToken.mockRejectedValue(new CocServerError("down", "/x", 500)),
      ],
      [
        "a database failure",
        () => rpc.mockResolvedValue({ data: null, error: { message: "boom" } }),
      ],
    ];

    it.each(cases)("keeps it out of the response body on %s", async (_label, arrange) => {
      arrange();
      const res = await POST(post({ playerTag: TAG, token: TOKEN }));
      expect(await res.text()).not.toContain(TOKEN);
    });

    it("keeps it out of console output", async () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      verifyPlayerToken.mockRejectedValue(new CocServerError("down", "/x", 500));

      await POST(post({ playerTag: TAG, token: TOKEN }));

      for (const call of spy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(TOKEN);
      }
      spy.mockRestore();
    });
  });
});
