// T3.7 — the authorisation test, automated.
//
// IMPLEMENTATION.md states it as a manual ritual: "Sign in as an ordinary member
// of clan 1, then request clan 2's data by editing the URL directly. Repeat this
// test at the end of every later phase."
//
// A test you must remember to perform is a test that gets performed until it is
// inconvenient. This is the same check, run by `npm test`, so "repeat at the end
// of every phase" happens whether anyone remembers or not.
//
// It asserts at the DATABASE layer, deliberately. Architecture.md §7.3: the
// application layer produces good error messages, and the database layer is the
// one that cannot be bypassed by a forgotten filter or a route added in a hurry
// at midnight. A route test proves one route; this proves that no route CAN leak,
// including routes nobody has written yet.
//
// Every table with a clan_id gets its own case. Adding a clan-scoped table
// without adding it here is how the coverage rots.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const MEMBER_A = "11111111-0000-4000-8000-0000000000a1";
const LEADER_A = "22222222-0000-4000-8000-0000000000a2";
const MEMBER_B = "33333333-0000-4000-8000-0000000000b1";
const PENDING = "44444444-0000-4000-8000-0000000000c1";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";

const SEASON_A = "dddddddd-0000-4000-8000-0000000000a1";
const SEASON_B = "dddddddd-0000-4000-8000-0000000000b1";
const WAR_A = "eeeeeeee-0000-4000-8000-0000000000a1";
const WAR_B = "eeeeeeee-0000-4000-8000-0000000000b1";

/** Every table holding clan-scoped data, with the column that scopes it. */
const CLAN_SCOPED = [
  "players",
  "clan_roles",
  "cwl_seasons",
  "wars",
  // 024. Holds the leader's intended war lineup, and a draft on it is invisible
  // even to the members of its own clan — so a leak across clans would be a leak
  // of something nobody outside leadership was ever meant to see.
  "war_lineups",
  "announcements",
  "base_layouts",
  "member_snapshots",
] as const;

async function rows(h: Harness, sql: string): Promise<number> {
  const res = await h.db.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`);
  return res.rows[0]!.n;
}

describe("T3.7 — cross-clan authorisation", () => {
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
      truncate feedback, notifications, member_snapshots, clan_roles, players, announcements, base_layouts,
               cwl_attacks, cwl_war_members, cwl_wars, cwl_seasons,
               wars, sync_log, audit_log, users, clans cascade;
      delete from auth.users;

      insert into auth.users (id, email) values
        ('${MEMBER_A}', 'member-a@example.com'),
        ('${LEADER_A}', 'leader-a@example.com'),
        ('${MEMBER_B}', 'member-b@example.com'),
        ('${PENDING}',  'pending@example.com');

      insert into users (id, email, status) values
        ('${MEMBER_A}', 'member-a@example.com', 'approved'),
        ('${LEADER_A}', 'leader-a@example.com', 'approved'),
        ('${MEMBER_B}', 'member-b@example.com', 'approved'),
        ('${PENDING}',  'pending@example.com',  'pending');

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#2PP0JCCQ', 'Clan B');

      insert into clan_roles (user_id, clan_id, role) values
        ('${MEMBER_A}', '${CLAN_A}', 'member'),
        ('${LEADER_A}', '${CLAN_A}', 'leader'),
        ('${MEMBER_B}', '${CLAN_B}', 'member');

      -- Identical data in both clans, so a leak is unmistakable rather than a
      -- count that happens to be zero for an unrelated reason.
      insert into players (id, clan_id, tag, name) values
        ('cccccccc-0000-4000-8000-0000000000a1', '${CLAN_A}', '#2PP0JCCU', 'Player A'),
        ('cccccccc-0000-4000-8000-0000000000b1', '${CLAN_B}', '#2PP0JCCV', 'Player B');

      insert into cwl_seasons (id, clan_id, season) values
        ('${SEASON_A}', '${CLAN_A}', '2026-08'),
        ('${SEASON_B}', '${CLAN_B}', '2026-08');

      -- cwl_wars, cwl_war_members and cwl_attacks have NO clan_id. They are
      -- reached through cwl_seasons, which is why they need their own cases
      -- below rather than joining the CLAN_SCOPED sweep.
      insert into cwl_wars (id, season_id, war_tag, day_number, state) values
        ('${WAR_A}', '${SEASON_A}', '#8G9QRVJL', 1, 'warEnded'),
        ('${WAR_B}', '${SEASON_B}', '#9CUVPYQ2', 1, 'warEnded');

      insert into cwl_war_members (war_id, player_id, map_position) values
        ('${WAR_A}', 'cccccccc-0000-4000-8000-0000000000a1', 1),
        ('${WAR_B}', 'cccccccc-0000-4000-8000-0000000000b1', 1);

      insert into cwl_attacks (war_id, player_id, attack_order, stars, destruction) values
        ('${WAR_A}', 'cccccccc-0000-4000-8000-0000000000a1', 1, 3, 100.00),
        ('${WAR_B}', 'cccccccc-0000-4000-8000-0000000000b1', 1, 3, 100.00);

      insert into wars (clan_id, start_time) values
        ('${CLAN_A}', now()), ('${CLAN_B}', now());

      -- PUBLISHED on both sides, deliberately. The CLAN_SCOPED sweep asserts a
      -- member sees their OWN clan's rows and none of clan B's, and a draft is
      -- invisible to members of its own clan too (024) — which would satisfy
      -- "sees nothing from clan B" for the wrong reason and stop testing the
      -- clan boundary at all. Draft invisibility has its own case in
      -- test/war-schema.test.ts.
      insert into war_lineups (clan_id, size, status, created_by) values
        ('${CLAN_A}', 15, 'published', '${LEADER_A}'),
        ('${CLAN_B}', 15, 'published', '${MEMBER_B}');

      insert into announcements (clan_id, author_id, title, body) values
        ('${CLAN_A}', '${LEADER_A}', 'A notice', 'body'),
        ('${CLAN_B}', '${MEMBER_B}', 'B notice', 'body');

      insert into base_layouts (clan_id, uploaded_by, th_level, layout_type, copy_link) values
        ('${CLAN_A}', '${MEMBER_A}', 15, 'war', 'https://example.com/a'),
        ('${CLAN_B}', '${MEMBER_B}', 15, 'war', 'https://example.com/b');

      insert into member_snapshots (clan_id, player_id, trophies) values
        ('${CLAN_A}', 'cccccccc-0000-4000-8000-0000000000a1', 5000),
        ('${CLAN_B}', 'cccccccc-0000-4000-8000-0000000000b1', 5000);

      insert into sync_log (job_type, clan_id, status) values
        ('clans', '${CLAN_A}', 'success'),
        ('clans', '${CLAN_B}', 'success');

      insert into audit_log (user_id, clan_id, action, entity) values
        ('${LEADER_A}', '${CLAN_A}', 'approve', 'users'),
        ('${MEMBER_B}', '${CLAN_B}', 'approve', 'users');
    `);
  });

  describe("an ordinary member of clan A", () => {
    beforeEach(async () => {
      await h.asUser(MEMBER_A);
    });

    it("sees only clan A in clans", async () => {
      expect(await rows(h, "select id from clans")).toBe(1);
      expect(await rows(h, `select id from clans where id = '${CLAN_B}'`)).toBe(0);
    });

    // The URL-editing attack, expressed as what it actually becomes: a query
    // naming clan B explicitly. This is the exact shape R3 warns generated code
    // produces, so it is the exact shape worth asserting against.
    it.each(CLAN_SCOPED)("sees nothing from clan B in %s", async (table) => {
      expect(await rows(h, `select id from ${table} where clan_id = '${CLAN_B}'`)).toBe(0);
      expect(await rows(h, `select id from ${table} where clan_id = '${CLAN_A}'`)).toBeGreaterThan(0);
    });

    it("sees nothing from clan B even with no filter at all", async () => {
      for (const table of CLAN_SCOPED) {
        const leaked = await rows(
          h,
          `select id from ${table} where clan_id not in ('${CLAN_A}')`,
        );
        expect(leaked, `${table} leaked rows outside clan A`).toBe(0);
      }
    });

    // The CWL tables carry no clan_id at all, so their policies are joins:
    // cwl_wars -> cwl_seasons, and cwl_attacks/cwl_war_members -> cwl_wars ->
    // cwl_seasons. migrations.test.ts calls the two-level version "the policy
    // most likely to be written wrongly", and a join policy fails in a way a
    // column filter cannot — it can silently match every row.
    it.each([
      ["cwl_wars", WAR_A, WAR_B],
      ["cwl_war_members", WAR_A, WAR_B],
      ["cwl_attacks", WAR_A, WAR_B],
    ] as const)("sees nothing from clan B in %s, through the season join", async (table, ours, theirs) => {
      const column = table === "cwl_wars" ? "id" : "war_id";
      expect(await rows(h, `select id from ${table} where ${column} = '${theirs}'`)).toBe(0);
      expect(await rows(h, `select id from ${table} where ${column} = '${ours}'`)).toBe(1);
      // And with no filter at all, which is how a broken join policy shows up.
      expect(await rows(h, `select id from ${table}`)).toBe(1);
    });

    it("cannot reach clan B's CWL data by joining up from the attack", async () => {
      // The shape a report query would take. If any link in the chain leaks,
      // this returns clan B's row.
      expect(
        await rows(
          h,
          `select a.id from cwl_attacks a
             join cwl_wars w on w.id = a.war_id
             join cwl_seasons s on s.id = w.season_id
            where s.clan_id = '${CLAN_B}'`,
        ),
      ).toBe(0);
    });

    // T3B.6 — cross-clan search is the first feature that queries players
    // WITHOUT a clan in the where clause, which is exactly the shape that leaks.
    // The page filters per clan itself; this asserts the net underneath holds
    // even when it does not.
    it("searching every player by name returns only its own clan", async () => {
      // Both fixtures are named "Player …", so a naive search matches both and
      // a leak is unmistakable.
      const n = await rows(h, `select 1 from players where name ilike '%Player%'`);
      expect(n).toBe(1);

      const names = await h.db.query<{ name: string }>(
        `select name from players where name ilike '%Player%'`,
      );
      expect(names.rows.map((r) => r.name)).toEqual(["Player A"]);
    });

    it("searching by tag cannot confirm another clan's player exists", async () => {
      // Guessing an exact tag must not be a way to test whether it is real —
      // an empty result is the same answer as "no such player".
      const n = await rows(h, `select 1 from players where tag = '#2PP0JCCV'`);
      expect(n).toBe(0);
    });

    it("cannot read another member's profile", async () => {
      expect(await rows(h, `select id from users where id = '${MEMBER_B}'`)).toBe(0);
      expect(await rows(h, `select id from users where id = '${MEMBER_A}'`)).toBe(1);
    });

    it("sees only clan A's sync_log", async () => {
      expect(await rows(h, `select id from sync_log where clan_id = '${CLAN_B}'`)).toBe(0);
    });

    // audit_log is leadership-only, so an ordinary member sees none of it —
    // including their own clan's.
    it("sees no audit_log at all", async () => {
      expect(await rows(h, "select id from audit_log")).toBe(0);
    });

    it("cannot write to another clan", async () => {
      await expect(
        h.db.query(
          `insert into announcements (clan_id, author_id, title, body)
           values ('${CLAN_B}', '${MEMBER_A}', 'injected', 'body')`,
        ),
      ).rejects.toThrow(/permission denied|row-level security/i);
    });

    it("cannot grant itself a role in another clan", async () => {
      await expect(
        h.db.query(
          `insert into clan_roles (user_id, clan_id, role)
           values ('${MEMBER_A}', '${CLAN_B}', 'leader')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe("a leader of clan A", () => {
    beforeEach(async () => {
      await h.asUser(LEADER_A);
    });

    it("reads clan A's audit_log but not clan B's", async () => {
      expect(await rows(h, `select id from audit_log where clan_id = '${CLAN_A}'`)).toBe(1);
      expect(await rows(h, `select id from audit_log where clan_id = '${CLAN_B}'`)).toBe(0);
    });

    it("still sees nothing of clan B's data", async () => {
      for (const table of CLAN_SCOPED) {
        expect(
          await rows(h, `select id from ${table} where clan_id = '${CLAN_B}'`),
          `${table} leaked to a leader of another clan`,
        ).toBe(0);
      }
    });

    it("cannot grant a role in a clan it does not lead", async () => {
      await expect(
        h.db.query(
          `insert into clan_roles (user_id, clan_id, role)
           values ('${MEMBER_A}', '${CLAN_B}', 'member')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // T3.8's done-when: "an account created with a random email and a stranger's
  // verified tag can see no clan data."
  describe("a pending account", () => {
    beforeEach(async () => {
      await h.asUser(PENDING);
    });

    it("sees no clans", async () => {
      expect(await rows(h, "select id from clans")).toBe(0);
    });

    it.each(CLAN_SCOPED)("sees no rows in %s", async (table) => {
      expect(await rows(h, `select id from ${table}`)).toBe(0);
    });

    it("sees its own profile and nobody else's", async () => {
      expect(await rows(h, "select id from users")).toBe(1);
      expect(await rows(h, `select id from users where id = '${PENDING}'`)).toBe(1);
    });
  });

  describe("no session at all", () => {
    beforeEach(async () => {
      await h.asAnon();
    });

    it("sees nothing anywhere", async () => {
      for (const table of [...CLAN_SCOPED, "clans", "users", "sync_log", "audit_log"]) {
        expect(await rows(h, `select id from ${table}`), `${table} leaked to anon`).toBe(0);
      }
    });
  });
});
