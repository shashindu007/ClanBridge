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

/** Every table holding clan-scoped data, with the column that scopes it. */
const CLAN_SCOPED = [
  "players",
  "clan_roles",
  "cwl_seasons",
  "wars",
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
      truncate member_snapshots, clan_roles, players, announcements, base_layouts,
               cwl_seasons, wars, sync_log, audit_log, users, clans cascade;
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

      insert into cwl_seasons (clan_id, season) values
        ('${CLAN_A}', '2026-08'), ('${CLAN_B}', '2026-08');

      insert into wars (clan_id, start_time) values
        ('${CLAN_A}', now()), ('${CLAN_B}', now());

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
