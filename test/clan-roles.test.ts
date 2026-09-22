// T12.9 — set_clan_role() (044).
//
// Choosing a member's role is the escalation surface of the whole product:
// every permission reads clan_roles. So most of this file is refusals.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const OWNER = "11111111-0000-4000-8000-0000000000ee";
const LEADER_A = "22222222-0000-4000-8000-0000000000ee";
const MEMBER_A = "33333333-0000-4000-8000-0000000000ee";
const COLEAD_A = "44444444-0000-4000-8000-0000000000ee";
const LEADER_2A = "55555555-0000-4000-8000-0000000000ee";
const PENDING = "66666666-0000-4000-8000-0000000000ee";
const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000ee";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000ee";

describe("044 — set_clan_role", () => {
  let h: Harness;

  async function setRole(user: string, clan: string, role: string | null): Promise<boolean> {
    const res = await h.db.query<{ ok: boolean }>(
      "select set_clan_role($1, $2, $3) as ok",
      [user, clan, role],
    );
    return res.rows[0]!.ok;
  }

  async function roleOf(user: string, clan: string): Promise<string | null> {
    await h.asSuperuser();
    const res = await h.db.query<{ role: string }>(
      `select role from clan_roles
        where user_id = $1 and clan_id = $2 and deleted_at is null`,
      [user, clan],
    );
    return res.rows[0]?.role ?? null;
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
      truncate feedback, notifications, audit_log, clan_roles, users, clans cascade;
      delete from auth.users;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');

      insert into auth.users (id, email) values
        ('${OWNER}', 'o@x.com'), ('${LEADER_A}', 'l@x.com'), ('${MEMBER_A}', 'm@x.com'),
        ('${COLEAD_A}', 'c@x.com'), ('${LEADER_2A}', 'l2@x.com'), ('${PENDING}', 'p@x.com');

      insert into users (id, email, status, is_platform_admin) values
        ('${OWNER}',     'o@x.com',  'approved', true),
        ('${LEADER_A}',  'l@x.com',  'approved', false),
        ('${MEMBER_A}',  'm@x.com',  'approved', false),
        ('${COLEAD_A}',  'c@x.com',  'approved', false),
        ('${LEADER_2A}', 'l2@x.com', 'approved', false),
        ('${PENDING}',   'p@x.com',  'pending',  false);

      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER_A}',  '${CLAN_A}', 'leader'),
        ('${MEMBER_A}',  '${CLAN_A}', 'member'),
        ('${COLEAD_A}',  '${CLAN_A}', 'co-leader'),
        ('${LEADER_2A}', '${CLAN_A}', 'leader');
    `);
  });

  describe("what a leader may do", () => {
    it("promotes a member to elder and to co-leader", async () => {
      await h.asUser(LEADER_A);
      expect(await setRole(MEMBER_A, CLAN_A, "elder")).toBe(true);
      expect(await roleOf(MEMBER_A, CLAN_A)).toBe("elder");

      await h.asUser(LEADER_A);
      expect(await setRole(MEMBER_A, CLAN_A, "co-leader")).toBe(true);
      expect(await roleOf(MEMBER_A, CLAN_A)).toBe("co-leader");
    });

    it("demotes a co-leader back to member", async () => {
      await h.asUser(LEADER_A);
      expect(await setRole(COLEAD_A, CLAN_A, "member")).toBe(true);
      expect(await roleOf(COLEAD_A, CLAN_A)).toBe("member");
    });

    it("records the change with before and after", async () => {
      await h.asUser(LEADER_A);
      await setRole(MEMBER_A, CLAN_A, "elder");

      await h.asSuperuser();
      const res = await h.db.query<{ before: unknown; after: unknown; clan_id: string }>(
        "select before, after, clan_id from audit_log where action = 'role'",
      );
      expect(res.rows).toEqual([
        { before: { role: "member" }, after: { role: "elder" }, clan_id: CLAN_A },
      ]);
    });

    it("treats setting the same role again as success, and records nothing", async () => {
      await h.asUser(LEADER_A);
      expect(await setRole(MEMBER_A, CLAN_A, "member")).toBe(true);

      await h.asSuperuser();
      expect((await h.db.query("select 1 from audit_log")).rows).toHaveLength(0);
    });

    it("takes a member out of the clan, and brings the same row back", async () => {
      await h.asUser(LEADER_A);
      expect(await setRole(MEMBER_A, CLAN_A, null)).toBe(true);
      expect(await roleOf(MEMBER_A, CLAN_A)).toBeNull();

      // clan_roles is unique (user_id, clan_id): a second INSERT would collide.
      await h.asUser(LEADER_A);
      expect(await setRole(MEMBER_A, CLAN_A, "elder")).toBe(true);
      expect(await roleOf(MEMBER_A, CLAN_A)).toBe("elder");

      await h.asSuperuser();
      const rows = await h.db.query(
        `select 1 from clan_roles where user_id = '${MEMBER_A}' and clan_id = '${CLAN_A}'`,
      );
      expect(rows.rows).toHaveLength(1);
    });
  });

  describe("what a leader may NOT do", () => {
    it("grant leader", async () => {
      await h.asUser(LEADER_A);
      expect(await setRole(MEMBER_A, CLAN_A, "leader")).toBe(false);
      expect(await roleOf(MEMBER_A, CLAN_A)).toBe("member");
    });

    // Two leaders able to demote each other is a clan fighting over a dropdown.
    it("change another leader's role", async () => {
      await h.asUser(LEADER_A);
      expect(await setRole(LEADER_2A, CLAN_A, "member")).toBe(false);
      expect(await roleOf(LEADER_2A, CLAN_A)).toBe("leader");
    });

    it("change their own role", async () => {
      await h.asUser(LEADER_A);
      expect(await setRole(LEADER_A, CLAN_A, "member")).toBe(false);
    });

    it("act in a clan they do not lead", async () => {
      await h.asUser(LEADER_A);
      expect(await setRole(MEMBER_A, CLAN_B, "member")).toBe(false);
      expect(await roleOf(MEMBER_A, CLAN_B)).toBeNull();
    });

    it("touch the platform admin", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `insert into clan_roles (user_id, clan_id, role) values ('${OWNER}', '${CLAN_A}', 'member')`,
      );
      await h.asUser(LEADER_A);
      expect(await setRole(OWNER, CLAN_A, "elder")).toBe(false);
    });
  });

  // A co-leader promoting a friend who promotes them back is the loop this
  // rule closes.
  it("refuses a co-leader", async () => {
    await h.asUser(COLEAD_A);
    expect(await setRole(MEMBER_A, CLAN_A, "elder")).toBe(false);
  });

  it("refuses an ordinary member", async () => {
    await h.asUser(MEMBER_A);
    expect(await setRole(COLEAD_A, CLAN_A, "member")).toBe(false);
  });

  // The first role comes from approve_account(), which IS the approval.
  it("refuses a pending account", async () => {
    await h.asUser(OWNER);
    expect(await setRole(PENDING, CLAN_A, "member")).toBe(false);
  });

  it("refuses a role that does not exist", async () => {
    await h.asUser(OWNER);
    expect(await setRole(MEMBER_A, CLAN_A, "overlord")).toBe(false);
  });

  describe("the platform admin", () => {
    it("grants and removes leader", async () => {
      await h.asUser(OWNER);
      expect(await setRole(MEMBER_A, CLAN_A, "leader")).toBe(true);
      expect(await roleOf(MEMBER_A, CLAN_A)).toBe("leader");

      await h.asUser(OWNER);
      expect(await setRole(LEADER_2A, CLAN_A, "co-leader")).toBe(true);
      expect(await roleOf(LEADER_2A, CLAN_A)).toBe("co-leader");
    });

    it("adds a member to a second clan", async () => {
      await h.asUser(OWNER);
      expect(await setRole(MEMBER_A, CLAN_B, "member")).toBe(true);
      expect(await roleOf(MEMBER_A, CLAN_B)).toBe("member");
    });
  });

  it("is not callable by anon at all", async () => {
    await h.asAnon();
    await expect(setRole(MEMBER_A, CLAN_A, "elder")).rejects.toThrow(/permission denied/);
  });
});
