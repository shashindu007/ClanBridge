// 067 — the database half of the October 2026 security audit.
//
// Most of these are refusals. Each rule also has the case it must still allow,
// because a hardening migration that breaks the feature is one nobody applies.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const OWNER = "11111111-0000-4000-8000-0000000000aa";
const LEADER_A = "22222222-0000-4000-8000-0000000000aa";
const LEADER_B = "33333333-0000-4000-8000-0000000000aa";
const MEMBER_A = "44444444-0000-4000-8000-0000000000aa";
const IN_BOTH = "55555555-0000-4000-8000-0000000000aa";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";

const FCM = "https://fcm.googleapis.com/fcm/send/abc123";
const KEY = "k".repeat(40);

describe("067 — security hardening", () => {
  let h: Harness;

  async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    const res = await h.db.query<Record<string, T>>(sql, params);
    return Object.values(res.rows[0]!)[0] as T;
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
      truncate feedback, notifications, account_messages, audit_log, push_subscriptions,
               base_layouts, player_nicknames, players, clan_roles, users, clans cascade;
      delete from auth.users;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');

      insert into auth.users (id, email) values
        ('${OWNER}',    'owner@example.com'),
        ('${LEADER_A}', 'leader-a@example.com'),
        ('${LEADER_B}', 'leader-b@example.com'),
        ('${MEMBER_A}', 'member-a@example.com'),
        ('${IN_BOTH}',  'both@example.com');

      insert into users (id, email, username, status, is_platform_admin) values
        ('${OWNER}',    'owner@example.com',    'owner',   'approved', true),
        ('${LEADER_A}', 'leader-a@example.com', 'leadera', 'approved', false),
        ('${LEADER_B}', 'leader-b@example.com', 'leaderb', 'approved', false),
        ('${MEMBER_A}', 'member-a@example.com', 'membera', 'approved', false),
        ('${IN_BOTH}',  'both@example.com',     'both',    'approved', false);

      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER_A}', '${CLAN_A}', 'leader'),
        ('${LEADER_B}', '${CLAN_A}', 'leader'),
        ('${LEADER_B}', '${CLAN_B}', 'leader'),
        ('${MEMBER_A}', '${CLAN_A}', 'member'),
        ('${IN_BOTH}',  '${CLAN_A}', 'member'),
        ('${IN_BOTH}',  '${CLAN_B}', 'elder');
    `);
  });

  describe("table privileges", () => {
    it.each(["anon", "authenticated", "service_role"])("leaves %s no TRUNCATE on any table", async (role) => {
      const res = await h.db.query<{ table_name: string }>(
        `select table_name from information_schema.role_table_grants
          where table_schema = 'public' and grantee = $1 and privilege_type = 'TRUNCATE'`,
        [role],
      );
      expect(res.rows).toEqual([]);
    });

    it("stops a session truncating a table, which RLS would not", async () => {
      await h.asUser(MEMBER_A);
      await expect(h.db.exec(`truncate clan_roles cascade`)).rejects.toThrow(/permission denied/i);
    });

    it("applies to tables created after this migration", async () => {
      await h.db.exec(`create table privilege_probe (id int)`);
      const res = await h.db.query<{ n: number }>(
        `select count(*)::int as n from information_schema.role_table_grants
          where table_name = 'privilege_probe' and grantee = 'anon' and privilege_type = 'TRUNCATE'`,
      );
      await h.db.exec(`drop table privilege_probe`);
      expect(res.rows[0]!.n).toBe(0);
    });
  });

  describe("remove_account", () => {
    it("refuses a leader removing a fellow leader", async () => {
      await h.asUser(LEADER_A);
      await expect(h.db.query("select remove_account($1)", [LEADER_B])).rejects.toThrow(/platform admin/);

      await h.asSuperuser();
      const status = await scalar<string>("select status from users where id = $1", [LEADER_B]);
      expect(status).toBe("approved");
    });

    it("refuses a leader reaching a role in a clan they do not lead", async () => {
      await h.asUser(LEADER_A);
      await expect(h.db.query("select remove_account($1)", [IN_BOTH])).rejects.toThrow(/do not lead/);

      await h.asSuperuser();
      const live = await scalar<number>(
        "select count(*)::int from clan_roles where user_id = $1 and deleted_at is null",
        [IN_BOTH],
      );
      expect(live).toBe(2);
    });

    it("lets a leader who leads every clan the account is in remove it", async () => {
      await h.asUser(LEADER_B);
      expect(await scalar<boolean>("select remove_account($1)", [IN_BOTH])).toBe(true);
    });

    it("still lets a leader remove their own member", async () => {
      await h.asUser(LEADER_A);
      expect(await scalar<boolean>("select remove_account($1)", [MEMBER_A])).toBe(true);
    });

    it("still lets the platform admin remove a leader", async () => {
      await h.asUser(OWNER);
      expect(await scalar<boolean>("select remove_account($1)", [LEADER_B])).toBe(true);
    });

    it("tells a caller with no authority nothing", async () => {
      await h.asUser(MEMBER_A);
      expect(await scalar<boolean>("select remove_account($1)", [LEADER_B])).toBe(false);
    });
  });

  describe("platform_has_owner", () => {
    it("is true for a member, who cannot read the admin's row", async () => {
      await h.asUser(MEMBER_A);
      const seen = await scalar<number>("select count(*)::int from users where is_platform_admin");
      expect(seen).toBe(0); // exactly why /admin always thought it was unclaimed
      expect(await scalar<boolean>("select platform_has_owner()")).toBe(true);
    });

    it("is false only when nobody holds the platform", async () => {
      await h.db.exec(`update users set is_platform_admin = false`);
      await h.asUser(MEMBER_A);
      expect(await scalar<boolean>("select platform_has_owner()")).toBe(false);
    });

    it("is not open to anon", async () => {
      await h.asAnon();
      await expect(h.db.query("select platform_has_owner()")).rejects.toThrow(/permission denied/i);
    });
  });

  describe("push endpoints", () => {
    it.each([
      FCM,
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/abc",
      "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ])("accepts %s", async (endpoint) => {
      await h.asUser(MEMBER_A);
      expect(await scalar<boolean>("select claim_push_subscription($1, $2, $3)", [endpoint, KEY, KEY])).toBe(true);
    });

    it.each([
      "https://attacker.example/x",
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com.attacker.example/x",
      "https://attacker.example/https://fcm.googleapis.com/x",
      "https://169.254.169.254/latest/meta-data/",
      "https://notify.windows.com.attacker.example/x",
    ])("refuses %s", async (endpoint) => {
      await h.asUser(MEMBER_A);
      expect(await scalar<boolean>("select claim_push_subscription($1, $2, $3)", [endpoint, KEY, KEY])).toBe(false);
    });

    it("refuses a direct insert, which went round the function", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.query(
          "insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $3)",
          [MEMBER_A, "https://attacker.example/x", KEY],
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it("refuses repointing a stored row", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query("select claim_push_subscription($1, $2, $3)", [FCM, KEY, KEY]);
      await expect(
        h.db.query("update push_subscriptions set endpoint = 'https://attacker.example/x'"),
      ).rejects.toThrow(/permission denied/i);
    });

    it("still lets a member turn off their own device", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query("select claim_push_subscription($1, $2, $3)", [FCM, KEY, KEY]);
      await h.db.query("update push_subscriptions set deleted_at = now() where endpoint = $1", [FCM]);
      const live = await scalar<number>("select count(*)::int from push_subscriptions where deleted_at is null");
      expect(live).toBe(0);
    });
  });

  describe("base_layouts", () => {
    const add = (link: string, extra = "", value = "") =>
      h.db.query(
        `insert into base_layouts (clan_id, uploaded_by, th_level, layout_type, copy_link${extra})
         values ($1, $2, 16, 'war', $3${value})`,
        [CLAN_A, MEMBER_A, link],
      );

    it("accepts a real copy link", async () => {
      await h.asUser(MEMBER_A);
      await expect(add("https://link.clashofclans.com/en?action=OpenLayout&id=abc")).resolves.toBeDefined();
    });

    it("refuses any other link, which the upload form alone used to stop", async () => {
      await h.asUser(MEMBER_A);
      await expect(add("https://evil.example/?x=link.clashofclans.com")).rejects.toThrow(/copy_link/);
    });

    it("refuses setting votes on the way in", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        add("https://link.clashofclans.com/en?id=abc", ", votes", ", 999"),
      ).rejects.toThrow(/permission denied/i);
    });

    it("refuses inflating votes afterwards", async () => {
      await h.asUser(MEMBER_A);
      await add("https://link.clashofclans.com/en?id=abc");
      await expect(h.db.query("update base_layouts set votes = 999")).rejects.toThrow(/permission denied/i);
    });

    it("still lets the uploader remove their layout", async () => {
      await h.asUser(MEMBER_A);
      await add("https://link.clashofclans.com/en?id=abc");
      await h.db.query("update base_layouts set deleted_at = now()");
      const live = await scalar<number>("select count(*)::int from base_layouts where deleted_at is null");
      expect(live).toBe(0);
    });
  });

  describe("approve_account after a removal", () => {
    async function pendingAfterRemoval(): Promise<void> {
      await h.asUser(LEADER_A);
      await h.db.query("select remove_account($1)", [MEMBER_A]);
      await h.asSuperuser();
      await h.db.exec(`
        select set_config('clanbridge.bootstrap', 'on', false);
        update users
           set status = 'pending', deleted_at = null, requested_clan_id = '${CLAN_A}'
         where id = '${MEMBER_A}';
      `);
    }

    it("gives the account its seat back", async () => {
      await pendingAfterRemoval();
      await h.asUser(OWNER);
      expect(await scalar<boolean>("select approve_account($1)", [MEMBER_A])).toBe(true);

      await h.asSuperuser();
      const role = await h.db.query<{ role: string }>(
        "select role from clan_roles where user_id = $1 and deleted_at is null",
        [MEMBER_A],
      );
      expect(role.rows).toEqual([{ role: "member" }]);
    });

    it("never downgrades a live role", async () => {
      await h.db.exec(`
        select set_config('clanbridge.bootstrap', 'on', false);
        update users set status = 'pending', requested_clan_id = '${CLAN_A}' where id = '${LEADER_B}';
      `);
      await h.asUser(OWNER);
      await h.db.query("select approve_account($1)", [LEADER_B]);

      await h.asSuperuser();
      const role = await scalar<string>(
        "select role from clan_roles where user_id = $1 and clan_id = $2",
        [LEADER_B, CLAN_A],
      );
      expect(role).toBe("leader");
    });
  });
});
