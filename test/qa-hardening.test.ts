// 046 — the QA hardening migration, tested as the caller who would exploit it.
//
// Each block is a hole that the app's own forms never opened but a direct
// PostgREST call, a second village or a second clan's leader did. Raw SQL under
// `asUser`, because what matters is what Postgres refuses, not what a page offers.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";
import { leftClanInGame } from "@/repositories/accounts";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";

const LEADER_A = "11111111-0000-4000-8000-0000000000a1";
const MEMBER_A = "22222222-0000-4000-8000-0000000000a2";
const LEADER_B = "33333333-0000-4000-8000-0000000000b1";
const PENDING = "44444444-0000-4000-8000-0000000000c1";
const NEWBIE = "55555555-0000-4000-8000-0000000000d1";

// MEMBER_A's two villages. The one in clan B sorts FIRST, so a lookup that takes
// "any one of the caller's villages" is steered toward the wrong one.
const VILLAGE_IN_B = "0aaaaaaa-0000-4000-8000-00000000f002";
const VILLAGE_IN_A = "aaaaaaaa-0000-4000-8000-00000000f001";
const PLAYER_B = "bbbbbbbb-0000-4000-8000-00000000f001";

const WAR = "66666666-0000-4000-8000-000000000001";
const POLL_OPEN = "77777777-0000-4000-8000-000000000001";
const POLL_CLOSED = "77777777-0000-4000-8000-000000000002";
const OPT_OPEN = "88888888-0000-4000-8000-000000000001";
const OPT_CLOSED = "88888888-0000-4000-8000-000000000002";
const ROSTER_A = "99999999-0000-4000-8000-0000000000a1";
const ROSTER_B = "99999999-0000-4000-8000-0000000000b1";

async function one<T>(h: Harness, sql: string): Promise<T> {
  const res = await h.db.query<T>(sql);
  return res.rows[0]!;
}

async function rows(h: Harness, sql: string): Promise<number> {
  const res = await h.db.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`);
  return res.rows[0]!.n;
}

describe("046 — QA hardening", () => {
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
      truncate feedback, notifications, audit_log, cwl_roster_members, cwl_rosters,
               poll_responses, poll_options, polls, war_targets, war_members, wars,
               clan_roles, players, users, clans cascade;
      delete from auth.users;

      insert into auth.users (id, email) values
        ('${LEADER_A}', 'leader-a@example.com'),
        ('${MEMBER_A}', 'member-a@example.com'),
        ('${LEADER_B}', 'leader-b@example.com'),
        ('${PENDING}',  'pending@example.com'),
        ('${NEWBIE}',   'newbie@example.com');

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');

      insert into users (id, email, status, requested_clan_id) values
        ('${LEADER_A}', 'leader-a@example.com', 'approved', '${CLAN_A}'),
        ('${MEMBER_A}', 'member-a@example.com', 'approved', '${CLAN_A}'),
        -- An approved leader of B who once applied to A.
        ('${LEADER_B}', 'leader-b@example.com', 'approved', '${CLAN_A}'),
        ('${PENDING}',  'pending@example.com',  'pending',  '${CLAN_A}');

      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER_A}', '${CLAN_A}', 'leader'),
        ('${MEMBER_A}', '${CLAN_A}', 'member'),
        ('${LEADER_B}', '${CLAN_B}', 'leader'),
        -- A live role on a pending account: exactly what 015's direct-write
        -- policy let a leader create.
        ('${PENDING}',  '${CLAN_A}', 'member');

      insert into players (id, clan_id, user_id, tag, name) values
        ('${VILLAGE_IN_A}', '${CLAN_A}', '${MEMBER_A}', '#PY0LQGRJ', 'Main'),
        ('${VILLAGE_IN_B}', '${CLAN_B}', '${MEMBER_A}', '#PY0LQGRC', 'Alt'),
        ('${PLAYER_B}',     '${CLAN_B}', '${LEADER_B}', '#C2V89UGL', 'Leader B');
    `);
  });

  describe("users — a session cannot write its own privileges", () => {
    it("coerces a self-inserted row to a plain pending account", async () => {
      await h.asUser(NEWBIE);
      await h.db.exec(`
        insert into users (id, email, status, is_platform_admin, requested_clan_id)
        values ('${NEWBIE}', 'newbie@example.com', 'approved', true, '${CLAN_A}')
      `);
      await h.asSuperuser();
      const row = await one<{
        status: string;
        is_platform_admin: boolean;
        requested_clan_id: string | null;
      }>(h, `select status, is_platform_admin, requested_clan_id from users where id = '${NEWBIE}'`);
      expect(row).toEqual({ status: "pending", is_platform_admin: false, requested_clan_id: null });
    });

    it("refuses clearing your own deleted_at", async () => {
      await h.db.exec(`update users set deleted_at = now() where id = '${MEMBER_A}'`);
      await h.asUser(MEMBER_A);
      await expect(
        h.db.exec(`update users set deleted_at = null where id = '${MEMBER_A}'`),
      ).rejects.toThrow(/deleted_at/);
    });

    it("refuses rewriting your email or approval stamps", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.exec(`update users set email = 'x@evil.test' where id = '${MEMBER_A}'`),
      ).rejects.toThrow(/email/);
      await expect(
        h.db.exec(`update users set approved_at = now() where id = '${MEMBER_A}'`),
      ).rejects.toThrow(/approval/);
    });

    it("still lets you change your username", async () => {
      await h.asUser(MEMBER_A);
      await h.db.exec(`update users set username = 'member_a' where id = '${MEMBER_A}'`);
      await h.asSuperuser();
      expect(
        (await one<{ username: string }>(h, `select username from users where id = '${MEMBER_A}'`))
          .username,
      ).toBe("member_a");
    });
  });

  describe("membership needs a live, approved account", () => {
    it("gives a pending account with a stray role no clan data", async () => {
      await h.asUser(PENDING);
      expect(await rows(h, "select id from clans")).toBe(0);
      expect(await rows(h, "select id from players")).toBe(0);
    });

    it("cuts off an account that has been removed, whatever its roles say", async () => {
      await h.db.exec(`update users set deleted_at = now() where id = '${MEMBER_A}'`);
      await h.asUser(MEMBER_A);
      expect(await rows(h, "select id from clans")).toBe(0);
    });

    it("leaves an approved member's access alone", async () => {
      await h.asUser(MEMBER_A);
      expect(await rows(h, "select id from clans")).toBe(1);
    });
  });

  describe("reject_account — applicants only", () => {
    it("will not reject an approved leader of another clan", async () => {
      await h.asUser(LEADER_A);
      const res = await one<{ reject_account: boolean }>(
        h,
        `select reject_account('${LEADER_B}')`,
      );
      expect(res.reject_account).toBe(false);
      await h.asSuperuser();
      expect(
        (await one<{ status: string }>(h, `select status from users where id = '${LEADER_B}'`))
          .status,
      ).toBe("approved");
    });

    it("still rejects a pending applicant", async () => {
      await h.asUser(LEADER_A);
      const res = await one<{ reject_account: boolean }>(h, `select reject_account('${PENDING}')`);
      expect(res.reject_account).toBe(true);
    });
  });

  describe("claim_war_target — the village that is in this war", () => {
    beforeEach(async () => {
      await h.asSuperuser();
      await h.db.exec(`
        insert into wars (id, clan_id, state, team_size, start_time, end_time)
        values ('${WAR}', '${CLAN_A}', 'inWar', 5, now() - interval '1 hour', now() + interval '1 day');
        insert into war_members (war_id, player_id, map_position)
        values ('${WAR}', '${VILLAGE_IN_A}', 1);
      `);
    });

    it("claims for the caller's village in the war, not an arbitrary one", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(`select claim_war_target('${WAR}', 3::smallint)`);
      await h.asSuperuser();
      const row = await one<{ player_id: string }>(h, 
        `select player_id from war_targets where war_id = '${WAR}'`,
      );
      expect(row.player_id).toBe(VILLAGE_IN_A);
    });

    it("refuses a named village that is not in the war", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.query(
          `select claim_war_target('${WAR}', 3::smallint, null, '${VILLAGE_IN_B}'::uuid)`,
        ),
      ).rejects.toThrow(/not in this war/);
    });

    it("refuses a village the caller does not own", async () => {
      await h.db.exec(
        `insert into war_members (war_id, player_id, map_position) values ('${WAR}', '${PLAYER_B}', 2)`,
      );
      await h.asUser(MEMBER_A);
      await expect(
        h.db.query(`select claim_war_target('${WAR}', 3::smallint, null, '${PLAYER_B}'::uuid)`),
      ).rejects.toThrow(/not in this war/);
    });

    it("releases the named village's claim", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(`select claim_war_target('${WAR}', 3::smallint)`);
      const res = await one<{ release_war_target: boolean }>(h, 
        `select release_war_target('${WAR}', '${VILLAGE_IN_A}'::uuid)`,
      );
      expect(res.release_war_target).toBe(true);
    });
  });

  describe("poll answers — the option must be this poll's", () => {
    beforeEach(async () => {
      await h.asSuperuser();
      await h.db.exec(`
        insert into polls (id, scope, clan_id, poll_type, title, created_by, status) values
          ('${POLL_OPEN}',   'clan', '${CLAN_A}', 'general', 'Open',   '${LEADER_A}', 'open'),
          ('${POLL_CLOSED}', 'clan', '${CLAN_A}', 'general', 'Closed', '${LEADER_A}', 'closed');
        insert into poll_options (id, poll_id, label, sort_order) values
          ('${OPT_OPEN}',   '${POLL_OPEN}',   'Yes', 1),
          ('${OPT_CLOSED}', '${POLL_CLOSED}', 'Yes', 1);
      `);
    });

    it("refuses an answer carrying another poll's option", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.exec(`
          insert into poll_responses (poll_id, player_id, option_id)
          values ('${POLL_OPEN}', '${VILLAGE_IN_A}', '${OPT_CLOSED}')
        `),
      ).rejects.toThrow(/row-level security/i);
    });

    it("refuses moving an answer onto a closed poll", async () => {
      await h.asUser(MEMBER_A);
      await h.db.exec(`
        insert into poll_responses (poll_id, player_id, option_id)
        values ('${POLL_OPEN}', '${VILLAGE_IN_A}', '${OPT_OPEN}')
      `);
      await expect(
        h.db.exec(`
          update poll_responses set poll_id = '${POLL_CLOSED}', option_id = '${OPT_CLOSED}'
          where player_id = '${VILLAGE_IN_A}'
        `),
      ).rejects.toThrow(/row-level security/i);
    });

    // A clan B village answering clan A's poll counted toward A's "In".
    it("refuses a village from another clan on a clan poll", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.exec(`
          insert into poll_responses (poll_id, player_id, option_id)
          values ('${POLL_OPEN}', '${VILLAGE_IN_B}', '${OPT_OPEN}')
        `),
      ).rejects.toThrow(/row-level security/i);
    });

    it("accepts a normal answer", async () => {
      await h.asUser(MEMBER_A);
      await h.db.exec(`
        insert into poll_responses (poll_id, player_id, option_id)
        values ('${POLL_OPEN}', '${VILLAGE_IN_A}', '${OPT_OPEN}')
      `);
      await h.asSuperuser();
      expect(await rows(h, "select id from poll_responses")).toBe(1);
    });
  });

  describe("the roster guard sees every clan's rosters", () => {
    it("refuses a player already in another clan's DRAFT roster", async () => {
      await h.asSuperuser();
      await h.db.exec(`
        insert into cwl_rosters (id, season, clan_id, created_by) values
          ('${ROSTER_A}', '2026-10', '${CLAN_A}', '${LEADER_A}'),
          ('${ROSTER_B}', '2026-10', '${CLAN_B}', '${LEADER_B}');
        insert into cwl_roster_members (roster_id, player_id, added_by)
        values ('${ROSTER_B}', '${VILLAGE_IN_B}', '${LEADER_B}');
      `);

      // Leader A cannot read B's draft roster — which is exactly why a guard
      // running as Leader A used to find no clash.
      await h.asUser(LEADER_A);
      expect(await rows(h, `select id from cwl_rosters where id = '${ROSTER_B}'`)).toBe(0);
      await expect(
        h.db.exec(`
          insert into cwl_roster_members (roster_id, player_id, added_by)
          values ('${ROSTER_A}', '${VILLAGE_IN_B}', '${LEADER_A}')
        `),
      ).rejects.toThrow(/already in the Clan B roster/);
    });
  });
});

describe("leftClanInGame — the flag on /admin/members", () => {
  const role = (clanId: string) => ({ clanId, clan: clanId, tag: "#X", role: "member" });
  const village = (clanId: string | null, leftAt: string | null = null) => ({
    tag: "#P",
    name: "P",
    thLevel: 15,
    clanId,
    leftAt,
  });

  it("flags a member whose only village has left every clan", () => {
    expect(
      leftClanInGame({ memberships: [role("a")], players: [village("a", "2026-09-01")] }),
    ).toBe(true);
  });

  it("flags a member who moved to a clan they hold no role in", () => {
    expect(leftClanInGame({ memberships: [role("a")], players: [village("b")] })).toBe(true);
  });

  it("leaves alone a member with any village still in a clan they hold a role in", () => {
    expect(
      leftClanInGame({ memberships: [role("a")], players: [village("b"), village("a")] }),
    ).toBe(false);
  });

  it("does not flag an account with no villages or no roles", () => {
    expect(leftClanInGame({ memberships: [role("a")], players: [] })).toBe(false);
    expect(leftClanInGame({ memberships: [], players: [village("a")] })).toBe(false);
  });
});
