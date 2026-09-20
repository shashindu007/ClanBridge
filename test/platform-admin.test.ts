// Leader-managed clans, replacing T1.10's hardcoded seed.
//
// The escalation tests are the point. This migration introduces the only
// platform-wide permission in the system and the first write policies, so the
// question is not "does adding a clan work" but "can anyone give themselves this".

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const OWNER = "11111111-0000-4000-8000-00000000000a";
const STRANGER = "22222222-0000-4000-8000-00000000000a";
const LEADER_B = "33333333-0000-4000-8000-00000000000a";
const CLAN_B = "bbbbbbbb-0000-4000-8000-00000000000b";

async function count(h: Harness, table: string, where = "true"): Promise<number> {
  const res = await h.db.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
  );
  return res.rows[0]!.n;
}

describe("015 — bootstrap and leader-managed clans", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.asSuperuser();
    await h.db.exec(`
      truncate notifications, member_snapshots, clan_roles, players, audit_log, users, clans cascade;
      delete from auth.users;

      insert into auth.users (id, email) values
        ('${OWNER}',    'owner@example.com'),
        ('${STRANGER}', 'stranger@example.com'),
        ('${LEADER_B}', 'leaderb@example.com');

      insert into users (id, email) values
        ('${OWNER}',    'owner@example.com'),
        ('${STRANGER}', 'stranger@example.com'),
        ('${LEADER_B}', 'leaderb@example.com');
    `);
  });

  describe("claiming ownership", () => {
    it("succeeds for the first caller when the platform has no admin", async () => {
      await h.asUser(OWNER);
      const res = await h.db.query<{ claim_platform_ownership: boolean }>(
        "select claim_platform_ownership()",
      );
      expect(res.rows[0]!.claim_platform_ownership).toBe(true);

      await h.asSuperuser();
      const row = await h.db.query<{ is_platform_admin: boolean; status: string }>(
        `select is_platform_admin, status from users where id = '${OWNER}'`,
      );
      expect(row.rows[0]!.is_platform_admin).toBe(true);
      // Auto-approved too, or the new owner would be locked out by T3.8.
      expect(row.rows[0]!.status).toBe("approved");
    });

    // The condition can only ever be true once. That is the whole safety model.
    it("refuses a second claimant", async () => {
      await h.asUser(OWNER);
      await h.db.query("select claim_platform_ownership()");

      await h.asUser(STRANGER);
      const res = await h.db.query<{ claim_platform_ownership: boolean }>(
        "select claim_platform_ownership()",
      );
      expect(res.rows[0]!.claim_platform_ownership).toBe(false);

      await h.asSuperuser();
      expect(await count(h, "users", "is_platform_admin")).toBe(1);
    });

    it("refuses an anonymous caller", async () => {
      await h.asAnon();
      // anon has no execute grant, so this is denied outright.
      await expect(h.db.query("select claim_platform_ownership()")).rejects.toThrow();
    });

    it("records the claim in audit_log (R4)", async () => {
      await h.asUser(OWNER);
      await h.db.query("select claim_platform_ownership()");
      await h.asSuperuser();
      expect(await count(h, "audit_log", `action = 'claim-ownership'`)).toBe(1);
    });
  });

  describe("adding a clan", () => {
    beforeEach(async () => {
      await h.asUser(OWNER);
      await h.db.query("select claim_platform_ownership()");
    });

    it("lets the platform admin insert a clan", async () => {
      await h.asUser(OWNER);
      await h.db.exec(
        `insert into clans (tag, name) values ('#2PP0JCCL', 'Pending sync')`,
      );
      await h.asSuperuser();
      expect(await count(h, "clans")).toBe(1);
    });

    it("lets the platform admin read a clan they just made, before any role exists", async () => {
      await h.asUser(OWNER);
      await h.db.exec(`insert into clans (tag, name) values ('#2PP0JCCL', 'x')`);
      // Without the "platform admin reads all clans" policy this returns 0 and the
      // admin cannot see what they just created.
      expect(await count(h, "clans")).toBe(1);
    });

    it("still rejects a malformed tag at the database level", async () => {
      await h.asUser(OWNER);
      await expect(
        h.db.exec(`insert into clans (tag, name) values ('#2ppojccl', 'x')`),
      ).rejects.toThrow(/clans_tag_format/);
    });

    it("lets the admin grant themselves leader of the new clan", async () => {
      await h.asUser(OWNER);
      await h.db.exec(`
        insert into clans (id, tag, name) values ('${CLAN_B}', '#8QUCLJY0', 'B');
        insert into clan_roles (user_id, clan_id, role)
          values ('${OWNER}', '${CLAN_B}', 'leader');
      `);
      await h.asSuperuser();
      expect(await count(h, "clan_roles")).toBe(1);
    });
  });

  // ── The tests that matter ────────────────────────────────────────────────
  describe("escalation is blocked", () => {
    beforeEach(async () => {
      await h.asUser(OWNER);
      await h.db.query("select claim_platform_ownership()");
      await h.asSuperuser();
      await h.db.exec(`
        insert into clans (id, tag, name) values ('${CLAN_B}', '#8QUCLJY0', 'B');
        insert into clan_roles (user_id, clan_id, role)
          values ('${LEADER_B}', '${CLAN_B}', 'leader');
        update users set status = 'approved' where id = '${LEADER_B}';
      `);
    });

    it("an ordinary user cannot add a clan", async () => {
      await h.asUser(STRANGER);
      await expect(
        h.db.exec(`insert into clans (tag, name) values ('#9V2GRJPY', 'mine')`),
      ).rejects.toThrow(/row-level security/i);
    });

    // A clan leader is not a platform admin. Adding clans is not part of the role.
    it("a clan leader cannot add a clan", async () => {
      await h.asUser(LEADER_B);
      await expect(
        h.db.exec(`insert into clans (tag, name) values ('#9V2GRJPY', 'mine')`),
      ).rejects.toThrow(/row-level security/i);
    });

    // "own profile update" exists so a user can set their display name. The
    // trigger stops it being a route to owning the platform.
    it("a user cannot make themselves platform admin", async () => {
      await h.asUser(STRANGER);
      await expect(
        h.db.exec(`update users set is_platform_admin = true where id = '${STRANGER}'`),
      ).rejects.toThrow(/is_platform_admin cannot be set directly/);
    });

    it("a user cannot approve themselves by writing status directly", async () => {
      await h.asUser(STRANGER);
      await expect(
        h.db.exec(`update users set status = 'approved' where id = '${STRANGER}'`),
      ).rejects.toThrow(/status is set by approve_account/);
    });

    it("a user cannot approve themselves through the function either", async () => {
      await h.asUser(STRANGER);
      await expect(
        h.db.query(`select approve_account('${STRANGER}')`),
      ).rejects.toThrow(/cannot approve themselves/);
    });

    it("an ordinary member cannot approve anyone", async () => {
      await h.asSuperuser();
      await h.db.exec(`
        update users set requested_clan_id = '${CLAN_B}' where id = '${STRANGER}';
        insert into clan_roles (user_id, clan_id, role)
          values ('${OWNER}', '${CLAN_B}', 'member')
          on conflict do nothing;
      `);
      // OWNER is platform admin here, so use a fresh plain member instead.
      const plain = "77777777-0000-4000-8000-00000000000a";
      await h.db.exec(`
        insert into auth.users (id, email) values ('${plain}', 'p@example.com');
        insert into users (id, email, status) values ('${plain}', 'p@example.com', 'approved');
        insert into clan_roles (user_id, clan_id, role) values ('${plain}', '${CLAN_B}', 'member');
      `);

      await h.asUser(plain);
      const res = await h.db.query<{ approve_account: boolean }>(
        `select approve_account('${STRANGER}')`,
      );
      expect(res.rows[0]!.approve_account).toBe(false);
    });

    it("a user cannot grant themselves a clan role", async () => {
      await h.asUser(STRANGER);
      await expect(
        h.db.exec(
          `insert into clan_roles (user_id, clan_id, role) values ('${STRANGER}', '${CLAN_B}', 'leader')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("a leader cannot grant a role in a clan they do not lead", async () => {
      await h.asSuperuser();
      const otherClan = "cccccccc-0000-4000-8000-00000000000c";
      await h.db.exec(
        `insert into clans (id, tag, name) values ('${otherClan}', '#9V2GRJPY', 'C')`,
      );

      await h.asUser(LEADER_B);
      await expect(
        h.db.exec(
          `insert into clan_roles (user_id, clan_id, role) values ('${STRANGER}', '${otherClan}', 'member')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("a leader CAN approve an applicant to their own clan", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `update users set requested_clan_id = '${CLAN_B}' where id = '${STRANGER}'`,
      );

      await h.asUser(LEADER_B);
      const res = await h.db.query<{ approve_account: boolean }>(
        `select approve_account('${STRANGER}')`,
      );
      expect(res.rows[0]!.approve_account).toBe(true);

      await h.asSuperuser();
      const row = await h.db.query<{ status: string; approved_by: string }>(
        `select status, approved_by from users where id = '${STRANGER}'`,
      );
      expect(row.rows[0]!.status).toBe("approved");
      // R4 — who approved, recorded on the row and in the audit log.
      expect(row.rows[0]!.approved_by).toBe(LEADER_B);
      expect(await count(h, "audit_log", `action = 'approve'`)).toBe(1);
    });

    it("a leader cannot approve an applicant to a different clan", async () => {
      await h.asSuperuser();
      const otherClan = "cccccccc-0000-4000-8000-00000000000c";
      await h.db.exec(`
        insert into clans (id, tag, name) values ('${otherClan}', '#9V2GRJPY', 'C');
        update users set requested_clan_id = '${otherClan}' where id = '${STRANGER}';
      `);

      await h.asUser(LEADER_B);
      const res = await h.db.query<{ approve_account: boolean }>(
        `select approve_account('${STRANGER}')`,
      );
      expect(res.rows[0]!.approve_account).toBe(false);

      await h.asSuperuser();
      const row = await h.db.query<{ status: string }>(
        `select status from users where id = '${STRANGER}'`,
      );
      expect(row.rows[0]!.status).toBe("pending");
      expect(await count(h, "audit_log", `action = 'approve'`)).toBe(0);
    });

    it("the platform admin can approve someone with no clan yet", async () => {
      await h.asUser(OWNER);
      const res = await h.db.query<{ approve_account: boolean }>(
        `select approve_account('${STRANGER}')`,
      );
      expect(res.rows[0]!.approve_account).toBe(true);
    });

    it("rejection is recorded rather than left pending", async () => {
      await h.asUser(OWNER);
      const res = await h.db.query<{ reject_account: boolean }>(
        `select reject_account('${STRANGER}')`,
      );
      expect(res.rows[0]!.reject_account).toBe(true);

      await h.asSuperuser();
      const row = await h.db.query<{ status: string }>(
        `select status from users where id = '${STRANGER}'`,
      );
      expect(row.rows[0]!.status).toBe("rejected");
      expect(await count(h, "audit_log", `action = 'reject'`)).toBe(1);
    });

    it("anon still sees nothing, with all these policies in place", async () => {
      await h.asAnon();
      expect(await count(h, "clans")).toBe(0);
      expect(await count(h, "users")).toBe(0);
      expect(await count(h, "clan_roles")).toBe(0);
    });
  });
});
