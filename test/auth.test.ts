// T3.5 requireRole, T3.8 approval gate, and the rate limiter — against real Postgres.
//
// The assertions that matter are the negative ones. An authorisation helper that
// permits when it should deny is the failure this project can least afford, and
// R3 already names missing clan scoping as its most common bug.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import {
  ALL_ROLES,
  ForbiddenError,
  NotApprovedError,
  ROLE_RANK,
  UnauthenticatedError,
  accountStatus,
  clanRole,
  clanRoles,
  hasRole,
  requireLeadership,
  requireMember,
  requireRole,
} from "../src/lib/auth";
import {
  VERIFY_LIMIT,
  createMemoryRateLimiter,
  getRateLimiter,
  rateLimitHeaders,
} from "../src/lib/rate-limit";
import type { ClanRole } from "../src/types/domain";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000001";
const LEADER = "11111111-0000-4000-8000-000000000001";
const ELDER = "22222222-0000-4000-8000-000000000001";
const MEMBER = "33333333-0000-4000-8000-000000000001";
const PENDING = "44444444-0000-4000-8000-000000000001";

/** Attaches a fake auth to the PGlite-backed client, so requireRole has a session. */
function withUser(base: SupabaseClient, userId: string | null): SupabaseClient {
  return {
    ...base,
    from: base.from.bind(base),
    auth: {
      getUser: async () => ({
        data: { user: userId ? { id: userId } : null },
        error: userId ? null : { message: "no session" },
      }),
    },
  } as unknown as SupabaseClient;
}

describe("hasRole — the hierarchy, without a database", () => {
  it("ranks least to most privileged", () => {
    expect(ROLE_RANK.member).toBeLessThan(ROLE_RANK.elder);
    expect(ROLE_RANK.elder).toBeLessThan(ROLE_RANK["co-leader"]);
    expect(ROLE_RANK["co-leader"]).toBeLessThan(ROLE_RANK.leader);
  });

  it("lets a higher role satisfy a lower requirement", () => {
    expect(hasRole("leader", "member")).toBe(true);
    expect(hasRole("leader", "co-leader")).toBe(true);
    expect(hasRole("co-leader", "elder")).toBe(true);
  });

  it("does NOT let a lower role satisfy a higher requirement", () => {
    expect(hasRole("member", "elder")).toBe(false);
    expect(hasRole("elder", "co-leader")).toBe(false);
    expect(hasRole("co-leader", "leader")).toBe(false);
  });

  it("treats every role as satisfying itself", () => {
    for (const role of ALL_ROLES) expect(hasRole(role, role)).toBe(true);
  });

  // A missing role must never pass. This is the case a truthiness check gets wrong.
  it("denies null and undefined", () => {
    for (const role of ALL_ROLES) {
      expect(hasRole(null, role)).toBe(false);
      expect(hasRole(undefined, role)).toBe(false);
    }
  });
});

describe("T3.5 / T3.8 — requireRole against real Postgres", () => {
  let h: Harness;
  let base: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    base = createPgliteSupabase(h.db);
  });
  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.asSuperuser();
    await h.db.exec(`
      truncate feedback, notifications, member_snapshots, clan_roles, players, users, clans cascade;
      delete from auth.users;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');

      insert into auth.users (id, email) values
        ('${LEADER}', 'leader@example.com'),
        ('${ELDER}', 'elder@example.com'),
        ('${MEMBER}', 'member@example.com'),
        ('${PENDING}', 'pending@example.com');

      insert into users (id, email, status) values
        ('${LEADER}', 'leader@example.com', 'approved'),
        ('${ELDER}', 'elder@example.com', 'approved'),
        ('${MEMBER}', 'member@example.com', 'approved'),
        ('${PENDING}', 'pending@example.com', 'pending');

      -- All three roles are in CLAN A only. Nobody has a role in clan B.
      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER}', '${CLAN_A}', 'leader'),
        ('${ELDER}', '${CLAN_A}', 'elder'),
        ('${MEMBER}', '${CLAN_A}', 'member');
    `);
  });

  it("returns the role when it is sufficient", async () => {
    const ctx = await requireRole(withUser(base, ELDER), CLAN_A, "member");
    expect(ctx).toEqual({ userId: ELDER, clanId: CLAN_A, role: "elder" });
  });

  it("rejects a role that is too low", async () => {
    await expect(
      requireRole(withUser(base, MEMBER), CLAN_A, "co-leader"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects when there is no session", async () => {
    await expect(
      requireRole(withUser(base, null), CLAN_A, "member"),
    ).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  // ROLES ARE PER CLAN. A leader of clan A has no standing in clan B at all.
  it("does not carry a role from one clan into another", async () => {
    await expect(
      requireRole(withUser(base, LEADER), CLAN_B, "member"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // An unscoped call must crash, not quietly pass.
  it("refuses an empty clan id rather than matching nothing", async () => {
    await expect(
      requireRole(withUser(base, LEADER), "", "member"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("does not leak the caller's actual role in the error", async () => {
    const error = await requireRole(withUser(base, MEMBER), CLAN_A, "leader").catch(
      (e) => e,
    );
    expect((error as Error).message).toContain("leader");
    expect((error as Error).message).not.toContain("member");
  });

  describe("T3.8 — a pending account is refused everywhere", () => {
    it("is refused even with a valid role", async () => {
      await h.db.exec(
        `insert into clan_roles (user_id, clan_id, role) values ('${PENDING}', '${CLAN_A}', 'leader')`,
      );

      const error = await requireRole(withUser(base, PENDING), CLAN_A, "member").catch(
        (e) => e,
      );

      // Status is checked BEFORE the role, so a pending leader is still pending.
      expect(error).toBeInstanceOf(NotApprovedError);
      expect((error as NotApprovedError).status).toBe("pending");
    });

    it("is refused when rejected", async () => {
      await h.db.exec(`update users set status = 'rejected' where id = '${MEMBER}'`);
      await expect(
        requireRole(withUser(base, MEMBER), CLAN_A, "member"),
      ).rejects.toBeInstanceOf(NotApprovedError);
    });

    it("passes once approved", async () => {
      await h.db.exec(`
        update users set status = 'approved' where id = '${PENDING}';
        insert into clan_roles (user_id, clan_id, role) values ('${PENDING}', '${CLAN_A}', 'member');
      `);
      const ctx = await requireRole(withUser(base, PENDING), CLAN_A, "member");
      expect(ctx.role).toBe("member");
    });

    it("defaults a brand new account to pending", async () => {
      await h.db.exec(`
        insert into auth.users (id, email) values ('55555555-0000-4000-8000-000000000001', 'new@example.com');
        insert into users (id, email) values ('55555555-0000-4000-8000-000000000001', 'new@example.com');
      `);
      expect(await accountStatus(base, "55555555-0000-4000-8000-000000000001")).toBe(
        "pending",
      );
    });
  });

  describe("convenience guards", () => {
    it("requireMember accepts any role", async () => {
      for (const [user, role] of [
        [MEMBER, "member"],
        [ELDER, "elder"],
        [LEADER, "leader"],
      ] as Array<[string, ClanRole]>) {
        const ctx = await requireMember(withUser(base, user), CLAN_A);
        expect(ctx.role).toBe(role);
      }
    });

    it("requireLeadership accepts co-leader and above only", async () => {
      await expect(
        requireLeadership(withUser(base, ELDER), CLAN_A),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(requireLeadership(withUser(base, LEADER), CLAN_A)).resolves.toBeTruthy();
    });
  });

  describe("clanRole / clanRoles", () => {
    it("returns null for a clan the user has no role in", async () => {
      expect(await clanRole(base, LEADER, CLAN_B)).toBeNull();
    });

    // T3.6 — the switcher must be built from this, never a hardcoded three.
    it("lists only the clans the user belongs to", async () => {
      const roles = await clanRoles(base, LEADER);
      expect([...roles.keys()]).toEqual([CLAN_A]);
      expect(roles.get(CLAN_A)).toBe("leader");
    });

    // A soft-deleted role revokes access (R4 — the row survives).
    it("ignores a soft-deleted role", async () => {
      await h.db.exec(
        `update clan_roles set deleted_at = now() where user_id = '${LEADER}'`,
      );
      expect(await clanRole(base, LEADER, CLAN_A)).toBeNull();
      expect((await clanRoles(base, LEADER)).size).toBe(0);
    });
  });
});

describe("T3.3 / T9.7 — rate limiting", () => {
  it("allows exactly max requests, then denies", async () => {
    const limiter = createMemoryRateLimiter({ max: 3, windowMs: 60_000 });
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await limiter.limit("user:1"));

    expect(results.map((r) => r.success)).toEqual([true, true, true, false, false]);
  });

  it("counts each key separately", async () => {
    const limiter = createMemoryRateLimiter({ max: 1, windowMs: 60_000 });
    expect((await limiter.limit("a")).success).toBe(true);
    expect((await limiter.limit("b")).success).toBe(true);
    expect((await limiter.limit("a")).success).toBe(false);
  });

  // The window has to be long enough that it cannot expire BETWEEN the first two
  // calls. At 20 ms it could: this file runs alongside twenty PGlite-backed
  // suites, and under that load the two awaits are easily 20 ms apart, so the
  // second call started a fresh window and was allowed. The test then failed for
  // the one reason it is not testing. 500 ms is longer than any scheduling gap
  // here and still costs only 600 ms to prove the reset.
  it("resets after the window", async () => {
    const limiter = createMemoryRateLimiter({ max: 1, windowMs: 500 });
    expect((await limiter.limit("k")).success).toBe(true);
    expect((await limiter.limit("k")).success).toBe(false);
    await new Promise((r) => setTimeout(r, 600));
    expect((await limiter.limit("k")).success).toBe(true);
  });

  it("enforces T3.3's stated 5 per hour", () => {
    expect(VERIFY_LIMIT).toEqual({ max: 5, windowMs: 3_600_000 });
  });

  it("reports remaining and never goes negative", async () => {
    const limiter = createMemoryRateLimiter({ max: 2, windowMs: 60_000 });
    expect((await limiter.limit("k")).remaining).toBe(1);
    expect((await limiter.limit("k")).remaining).toBe(0);
    expect((await limiter.limit("k")).remaining).toBe(0);
  });

  it("emits standard headers so a client can back off", async () => {
    const limiter = createMemoryRateLimiter({ max: 5, windowMs: 60_000 });
    const headers = rateLimitHeaders(await limiter.limit("k"));
    expect(headers["RateLimit-Limit"]).toBe("5");
    expect(headers["RateLimit-Remaining"]).toBe("4");
    expect(Number(headers["RateLimit-Reset"])).toBeGreaterThan(0);
  });

  // An ineffective limiter is worse than none: it looks like protection while
  // permitting max x instances across a serverless deployment.
  it("refuses to fall back to in-memory in production", async () => {
    const original = process.env.NODE_ENV;
    try {
      vi.stubEnv("NODE_ENV", "production");
      delete process.env.UPSTASH_REDIS_REST_URL;
      await expect(getRateLimiter(VERIFY_LIMIT)).rejects.toThrow(/UPSTASH/);
    } finally {
      vi.stubEnv("NODE_ENV", original ?? "test");
    }
  });

  it("uses the in-memory limiter outside production", async () => {
    const limiter = await getRateLimiter({ max: 1, windowMs: 60_000 });
    expect((await limiter.limit("k")).success).toBe(true);
  });
});
