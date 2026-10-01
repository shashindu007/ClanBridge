// 056 — QA hardening: notification recipients and URLs, push endpoint
// hand-over, and retiring dead endpoints.
//
// Each block is the regression for one finding of the 2026-10 QA pass. The
// failure each guards against was silent: nothing errored, the wrong people
// were simply reachable, or the right ones simply were not.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const LEADER_A = "11111111-0000-4000-8000-0000000000cc";
const MEMBER_A = "22222222-0000-4000-8000-0000000000cc";
const LEFT_A = "33333333-0000-4000-8000-0000000000cc";
const LEADER_B = "44444444-0000-4000-8000-0000000000cc";
const MEMBER_B = "55555555-0000-4000-8000-0000000000cc";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000cc";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000cc";

const KEY = "p256dh-key-at-least-16";
const AUTH = "auth-key";

describe("056 — notification and push hardening", () => {
  let h: Harness;

  async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    const res = await h.db.query<Record<string, T>>(sql, params);
    return Object.values(res.rows[0]!)[0] as T;
  }

  async function raise(recipients: string[], clan: string | null, url = "/x"): Promise<number> {
    return scalar<number>("select raise_notification($1::uuid[], $2, $3, $4, $5, $6)", [
      recipients,
      clan,
      "announcements",
      "Title",
      "Body",
      url,
    ]);
  }

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.asSuperuser();
    await h.db.exec(`
      truncate notifications, push_subscriptions, players, clan_roles, users, clans cascade;
      delete from auth.users;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');

      insert into auth.users (id, email) values
        ('${LEADER_A}', 'leader-a@example.com'),
        ('${MEMBER_A}', 'member-a@example.com'),
        ('${LEFT_A}',   'left-a@example.com'),
        ('${LEADER_B}', 'leader-b@example.com'),
        ('${MEMBER_B}', 'member-b@example.com');

      insert into users (id, email, status, username) values
        ('${LEADER_A}', 'leader-a@example.com', 'approved', 'leader_a'),
        ('${MEMBER_A}', 'member-a@example.com', 'approved', 'member_a'),
        ('${LEFT_A}',   'left-a@example.com',   'approved', 'left_a'),
        ('${LEADER_B}', 'leader-b@example.com', 'approved', 'leader_b'),
        ('${MEMBER_B}', 'member-b@example.com', 'approved', 'member_b');

      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER_A}', '${CLAN_A}', 'leader'),
        ('${MEMBER_A}', '${CLAN_A}', 'member'),
        ('${LEFT_A}',   '${CLAN_A}', 'co-leader'),
        ('${LEADER_B}', '${CLAN_B}', 'leader'),
        ('${MEMBER_B}', '${CLAN_B}', 'member');

      insert into players (clan_id, user_id, tag, name, verified) values
        ('${CLAN_A}', '${MEMBER_A}', '#PY0LQGRJ', 'Member A', true),
        ('${CLAN_B}', '${MEMBER_B}', '#PY0LQGRC', 'Member B', true);
    `);
  });

  // ── 1. raise_notification reaches only the clan ───────────────────────────
  describe("raise_notification", () => {
    it("lets a leader notify members of their own clan", async () => {
      await h.asUser(LEADER_A);
      expect(await raise([MEMBER_A], CLAN_A)).toBe(1);
    });

    // The finding: leadership of ANY clan was enough to reach ANY account.
    it("drops recipients who are not in the clan being notified", async () => {
      await h.asUser(LEADER_A);
      expect(await raise([MEMBER_A, MEMBER_B, LEADER_B], CLAN_A)).toBe(1);

      await h.asSuperuser();
      expect(
        await scalar<number>(
          "select count(*)::int from notifications where recipient_id in ($1, $2)",
          [MEMBER_B, LEADER_B],
        ),
      ).toBe(0);
    });

    it("leaves the service role unscoped, for sync alerts to admins", async () => {
      await h.asServiceRole();
      expect(await raise([MEMBER_A, MEMBER_B], null)).toBe(2);
    });

    // '/\evil.example' is '//evil.example' to a browser.
    it("refuses a path containing a backslash", async () => {
      await h.asUser(LEADER_A);
      await expect(raise([MEMBER_A], CLAN_A, "/\\evil.example")).rejects.toThrow(
        /notifications_url_relative/,
      );
    });

    it("still refuses a protocol-relative path", async () => {
      await h.asUser(LEADER_A);
      await expect(raise([MEMBER_A], CLAN_A, "//evil.example")).rejects.toThrow(
        /notifications_url_relative/,
      );
    });
  });

  // ── 3. one browser, two accounts ──────────────────────────────────────────
  describe("claim_push_subscription", () => {
    const ENDPOINT = "https://push.example/shared-device";

    async function owner(): Promise<{ user_id: string; deleted_at: string | null }> {
      await h.asSuperuser();
      const res = await h.db.query<{ user_id: string; deleted_at: string | null }>(
        "select user_id, deleted_at from push_subscriptions where endpoint = $1",
        [ENDPOINT],
      );
      return res.rows[0]!;
    }

    it("registers a new endpoint for the caller", async () => {
      await h.asUser(MEMBER_A);
      expect(await scalar<boolean>("select claim_push_subscription($1, $2, $3)", [ENDPOINT, KEY, AUTH])).toBe(true);
      expect((await owner()).user_id).toBe(MEMBER_A);
    });

    // RLS refused this hand-over before 056 and the member saw a 500.
    it("hands an endpoint over to the account now signed in on that browser", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query("select claim_push_subscription($1, $2, $3)", [ENDPOINT, KEY, AUTH]);

      await h.asUser(MEMBER_B);
      expect(await scalar<boolean>("select claim_push_subscription($1, $2, $3)", [ENDPOINT, KEY, AUTH])).toBe(true);

      const row = await owner();
      expect(row.user_id).toBe(MEMBER_B);
      expect(row.deleted_at).toBeNull();
    });

    it("revives an endpoint that was turned off", async () => {
      await h.asSuperuser();
      await h.db.query(
        "insert into push_subscriptions (user_id, endpoint, p256dh, auth, deleted_at) values ($1, $2, $3, $4, now())",
        [MEMBER_A, ENDPOINT, KEY, AUTH],
      );
      await h.asUser(MEMBER_A);
      await h.db.query("select claim_push_subscription($1, $2, $3)", [ENDPOINT, KEY, AUTH]);
      expect((await owner()).deleted_at).toBeNull();
    });

    it("refuses something that is not a push endpoint", async () => {
      await h.asUser(MEMBER_A);
      expect(
        await scalar<boolean>("select claim_push_subscription($1, $2, $3)", ["http://insecure", KEY, AUTH]),
      ).toBe(false);
      expect(
        await scalar<boolean>("select claim_push_subscription($1, $2, $3)", [ENDPOINT, "short", AUTH]),
      ).toBe(false);
    });

    it("is not callable without a session", async () => {
      await h.asAnon();
      await expect(
        h.db.query("select claim_push_subscription($1, $2, $3)", [ENDPOINT, KEY, AUTH]),
      ).rejects.toThrow(/permission denied/);
    });
  });

  // ── 4. retiring dead endpoints ────────────────────────────────────────────
  describe("retire_push_endpoints", () => {
    beforeEach(async () => {
      await h.asSuperuser();
      await h.db.exec(`
        insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
          ('${MEMBER_A}', 'https://push.example/a', '${KEY}', '${AUTH}'),
          ('${MEMBER_B}', 'https://push.example/b', '${KEY}', '${AUTH}');
      `);
    });

    async function live(endpoint: string): Promise<boolean> {
      await h.asSuperuser();
      return scalar<boolean>(
        "select deleted_at is null from push_subscriptions where endpoint = $1",
        [endpoint],
      );
    }

    // Under RLS a leader could retire only their own rows, so a member's dead
    // endpoint was retried on every notice for ever.
    it("lets a leader retire a member's dead endpoint", async () => {
      await h.asUser(LEADER_A);
      expect(await scalar<number>("select retire_push_endpoints($1::text[])", [["https://push.example/a"]])).toBe(1);
      expect(await live("https://push.example/a")).toBe(false);
    });

    it("does not let a leader retire another clan's endpoints", async () => {
      await h.asUser(LEADER_A);
      expect(await scalar<number>("select retire_push_endpoints($1::text[])", [["https://push.example/b"]])).toBe(0);
      expect(await live("https://push.example/b")).toBe(true);
    });

    it("lets an ordinary member retire only their own", async () => {
      await h.asUser(MEMBER_A);
      expect(
        await scalar<number>("select retire_push_endpoints($1::text[])", [
          ["https://push.example/a", "https://push.example/b"],
        ]),
      ).toBe(1);
    });

    it("lets the service role retire any endpoint", async () => {
      await h.asServiceRole();
      expect(
        await scalar<number>("select retire_push_endpoints($1::text[])", [
          ["https://push.example/a", "https://push.example/b"],
        ]),
      ).toBe(2);
    });
  });
});
