// T3.3 / T3.8 — player verification and the approval it feeds.
//
// Covers migrations 016 (link_verified_player, requested_clan_id guard) and 017
// (approval also grants membership).
//
// The interesting cases are all refusals. Linking a tag is the easy half; the
// half worth testing is that a member cannot link a tag that is not theirs, put
// themselves in a leader's queue without verifying, or end up approved into an
// application with no clans in it.
//
// Driven through raw SQL rather than the supabase-js shim because
// test/pglite-supabase.ts implements no .rpc().

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const LEADER_A = "11111111-0000-4000-8000-0000000000aa";
const MEMBER_A = "22222222-0000-4000-8000-0000000000aa";
const STRANGER = "33333333-0000-4000-8000-0000000000aa";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";

const PLAYER_A = "#2PP0JCCL"; // in clan A
const PLAYER_GONE = "#2PP0JCCP"; // in clan A but left_at set
const PLAYER_NONE = "#2PP0JCCU"; // exists, but belongs to no clan

async function count(h: Harness, table: string, where = "true"): Promise<number> {
  const res = await h.db.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
  );
  return res.rows[0]!.n;
}

async function link(h: Harness, tag: string) {
  const res = await h.db.query<{ link_verified_player: { ok: boolean; reason?: string } }>(
    "select link_verified_player($1)",
    [tag],
  );
  return res.rows[0]!.link_verified_player;
}

describe("016/017 — verification and approval", () => {
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
      truncate member_snapshots, clan_roles, players, audit_log, users, clans cascade;
      delete from auth.users;

      insert into auth.users (id, email) values
        ('${LEADER_A}', 'leader@example.com'),
        ('${MEMBER_A}', 'member@example.com'),
        ('${STRANGER}', 'stranger@example.com');

      insert into users (id, email, status) values
        ('${LEADER_A}', 'leader@example.com', 'approved'),
        ('${MEMBER_A}', 'member@example.com', 'pending'),
        ('${STRANGER}', 'stranger@example.com', 'pending');

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#2PP0JCCQ', 'Clan B');

      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER_A}', '${CLAN_A}', 'leader');

      -- Game facts, as scripts/sync/clans.ts would have written them.
      insert into players (clan_id, tag, name) values
        ('${CLAN_A}', '${PLAYER_A}', 'Member A'),
        (null,        '${PLAYER_NONE}', 'Outsider');

      insert into players (clan_id, tag, name, left_at) values
        ('${CLAN_A}', '${PLAYER_GONE}', 'Departed', now());
    `);
  });

  describe("link_verified_player", () => {
    it("links a tag that is a current member of one of the clans", async () => {
      await h.asUser(MEMBER_A);
      expect(await link(h, PLAYER_A)).toMatchObject({ ok: true });

      await h.asSuperuser();
      const row = await h.db.query<{ verified: boolean; user_id: string }>(
        `select verified, user_id from players where tag = '${PLAYER_A}'`,
      );
      expect(row.rows[0]!.verified).toBe(true);
      expect(row.rows[0]!.user_id).toBe(MEMBER_A);
    });

    // This is what routes the applicant to the right leader's queue. Without it
    // 013's "leaders read pending applicants" policy matches nothing and the
    // account is invisible to everyone who could approve it.
    it("sets requested_clan_id to the clan the player actually plays in", async () => {
      await h.asUser(MEMBER_A);
      await link(h, PLAYER_A);

      await h.asSuperuser();
      const row = await h.db.query<{ requested_clan_id: string }>(
        `select requested_clan_id from users where id = '${MEMBER_A}'`,
      );
      expect(row.rows[0]!.requested_clan_id).toBe(CLAN_A);
    });

    it("records the verification in audit_log (R4)", async () => {
      await h.asUser(MEMBER_A);
      await link(h, PLAYER_A);
      await h.asSuperuser();
      expect(await count(h, "audit_log", `action = 'verify'`)).toBe(1);
    });

    // T3.8's done-when, in the database: "an account created with a random email
    // and a stranger's verified tag can see no clan data."
    it("refuses a tag that belongs to no clan on this platform", async () => {
      await h.asUser(STRANGER);
      expect(await link(h, PLAYER_NONE)).toMatchObject({
        ok: false,
        reason: "not_a_member",
      });

      await h.asSuperuser();
      const row = await h.db.query<{ requested_clan_id: string | null }>(
        `select requested_clan_id from users where id = '${STRANGER}'`,
      );
      expect(row.rows[0]!.requested_clan_id).toBeNull();
    });

    it("refuses a tag that is unknown entirely", async () => {
      await h.asUser(STRANGER);
      expect(await link(h, "#2PP0JCCV")).toMatchObject({
        ok: false,
        reason: "not_a_member",
      });
    });

    // A departed member must be re-added in game and re-approved, not walk back
    // in on a tag the system still remembers for its history (T3.9).
    it("refuses a player who has left all the clans", async () => {
      await h.asUser(STRANGER);
      expect(await link(h, PLAYER_GONE)).toMatchObject({
        ok: false,
        reason: "not_a_member",
      });
    });

    it("refuses to move a player already linked to someone else", async () => {
      await h.asUser(MEMBER_A);
      await link(h, PLAYER_A);

      await h.asUser(STRANGER);
      await expect(link(h, PLAYER_A)).rejects.toThrow(
        /already linked to another account/,
      );

      await h.asSuperuser();
      const row = await h.db.query<{ user_id: string }>(
        `select user_id from players where tag = '${PLAYER_A}'`,
      );
      expect(row.rows[0]!.user_id).toBe(MEMBER_A);
    });

    // Re-verifying is ordinary: the token rotates and members retry.
    it("is idempotent for the same user", async () => {
      await h.asUser(MEMBER_A);
      expect(await link(h, PLAYER_A)).toMatchObject({ ok: true });
      expect(await link(h, PLAYER_A)).toMatchObject({ ok: true });

      await h.asSuperuser();
      expect(await count(h, "players", `user_id = '${MEMBER_A}'`)).toBe(1);
    });

    it("refuses an anonymous caller", async () => {
      await h.asAnon();
      await expect(h.db.query("select link_verified_player($1)", [PLAYER_A])).rejects.toThrow();
    });
  });

  describe("players stays closed to sessions", () => {
    // The whole reason link_verified_player exists. If this ever passes, the
    // function has been made redundant by a grant and a member can rewrite any
    // player's name, clan or town hall.
    it("gives authenticated no direct update on players", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.query(`update players set verified = true where tag = '${PLAYER_A}'`),
      ).rejects.toThrow(/permission denied|row-level security/i);
    });

    it("gives authenticated no direct insert on players", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.query(
          `insert into players (clan_id, tag, name) values ('${CLAN_A}', '#2PP0JCCY', 'Invented')`,
        ),
      ).rejects.toThrow(/permission denied|row-level security/i);
    });
  });

  describe("requested_clan_id guard (016)", () => {
    // Without this a stranger sets requested_clan_id themselves and appears in a
    // leader's pending list having proven nothing.
    it("refuses a direct write from a session", async () => {
      await h.asUser(STRANGER);
      await expect(
        h.db.query(
          `update users set requested_clan_id = '${CLAN_A}' where id = '${STRANGER}'`,
        ),
      ).rejects.toThrow(/requested_clan_id is set by link_verified_player/);
    });

    it("still allows a member to edit their own display name", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(
        `update users set display_name = 'Chosen Name' where id = '${MEMBER_A}'`,
      );
      await h.asSuperuser();
      const row = await h.db.query<{ display_name: string }>(
        `select display_name from users where id = '${MEMBER_A}'`,
      );
      expect(row.rows[0]!.display_name).toBe("Chosen Name");
    });

    // The two guards 015 already had must survive the 016 replacement.
    it("still blocks status and is_platform_admin", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.query(`update users set status = 'approved' where id = '${MEMBER_A}'`),
      ).rejects.toThrow(/status is set by approve_account/);
      await expect(
        h.db.query(`update users set is_platform_admin = true where id = '${MEMBER_A}'`),
      ).rejects.toThrow(/is_platform_admin cannot be set directly/);
    });
  });

  describe("approve_account grants membership (017)", () => {
    async function approve(target: string): Promise<boolean> {
      const res = await h.db.query<{ approve_account: boolean }>(
        "select approve_account($1)",
        [target],
      );
      return res.rows[0]!.approve_account;
    }

    beforeEach(async () => {
      // The applicant verifies first, as the real flow requires.
      await h.asUser(MEMBER_A);
      await link(h, PLAYER_A);
    });

    it("approves and grants member of the requested clan in one act", async () => {
      await h.asUser(LEADER_A);
      expect(await approve(MEMBER_A)).toBe(true);

      await h.asSuperuser();
      const user = await h.db.query<{ status: string }>(
        `select status from users where id = '${MEMBER_A}'`,
      );
      expect(user.rows[0]!.status).toBe("approved");

      const role = await h.db.query<{ role: string; clan_id: string }>(
        `select role, clan_id from clan_roles where user_id = '${MEMBER_A}'`,
      );
      expect(role.rows).toHaveLength(1);
      expect(role.rows[0]!.role).toBe("member");
      expect(role.rows[0]!.clan_id).toBe(CLAN_A);
    });

    // The defect 017 fixes: approved, past the /pending redirect, and no clans.
    it("leaves nobody approved without a clan role", async () => {
      await h.asUser(LEADER_A);
      await approve(MEMBER_A);
      await h.asSuperuser();

      const orphaned = await count(
        h,
        "users u",
        `u.status = 'approved'
           and u.is_platform_admin = false
           and not exists (select 1 from clan_roles r where r.user_id = u.id)`,
      );
      expect(orphaned).toBe(0);
    });

    // The in-game rank is a game fact; the app permission is not. Copying one
    // into the other would let a promotion in game grant roster-publishing rights.
    it("always grants 'member', never the in-game rank", async () => {
      await h.asSuperuser();
      await h.db.query(
        `update players set clan_role = 'co-leader' where tag = '${PLAYER_A}'`,
      );

      await h.asUser(LEADER_A);
      await approve(MEMBER_A);

      await h.asSuperuser();
      const role = await h.db.query<{ role: string }>(
        `select role from clan_roles where user_id = '${MEMBER_A}'`,
      );
      expect(role.rows[0]!.role).toBe("member");
    });

    // A leader has nothing to approve a clanless applicant INTO, and no way to
    // give them a role afterwards.
    it("refuses a leader approving an applicant who has not verified", async () => {
      await h.asUser(LEADER_A);
      expect(await approve(STRANGER)).toBe(false);

      await h.asSuperuser();
      expect(await count(h, "clan_roles", `user_id = '${STRANGER}'`)).toBe(0);
    });

    // 018 — the platform admin keeps the escape hatch 015 created for them,
    // because they can add the clan and grant the role afterwards.
    it("lets the platform admin approve a clanless applicant, without a role", async () => {
      await h.asSuperuser();
      await h.db.query(
        `update users set is_platform_admin = true where id = '${LEADER_A}'`,
      );

      await h.asUser(LEADER_A);
      expect(await approve(STRANGER)).toBe(true);

      await h.asSuperuser();
      const user = await h.db.query<{ status: string }>(
        `select status from users where id = '${STRANGER}'`,
      );
      expect(user.rows[0]!.status).toBe("approved");
      expect(await count(h, "clan_roles", `user_id = '${STRANGER}'`)).toBe(0);
    });

    it("refuses a leader of a different clan", async () => {
      await h.asSuperuser();
      await h.db.query(
        `insert into clan_roles (user_id, clan_id, role) values ('${STRANGER}', '${CLAN_B}', 'leader')`,
      );

      await h.asUser(STRANGER);
      expect(await approve(MEMBER_A)).toBe(false);
    });

    it("still refuses self-approval", async () => {
      await h.asUser(MEMBER_A);
      await expect(approve(MEMBER_A)).rejects.toThrow(/cannot approve themselves/);
    });

    // Re-approving must not silently demote someone who has since been promoted.
    it("does not downgrade an existing role", async () => {
      await h.asUser(LEADER_A);
      await approve(MEMBER_A);

      await h.asSuperuser();
      await h.db.query(
        `update clan_roles set role = 'co-leader' where user_id = '${MEMBER_A}'`,
      );
      await h.db.query(
        `update users set status = 'pending' where id = '${MEMBER_A}'`,
      );

      await h.asUser(LEADER_A);
      await approve(MEMBER_A);

      await h.asSuperuser();
      const role = await h.db.query<{ role: string }>(
        `select role from clan_roles where user_id = '${MEMBER_A}'`,
      );
      expect(role.rows[0]!.role).toBe("co-leader");
    });
  });
});
