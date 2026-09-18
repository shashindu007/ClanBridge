// T12.1 — family_clans() and family_clan_roster() (038), against real Postgres roles.
//
// This file is the security review for the visitor tier, and it exists to hold
// five things, each of which fails SILENTLY if it is wrong:
//
//   1. A MEMBER OF ONE CLAN READS ANOTHER CLAN'S OVERVIEW AND ROSTER through
//      these functions. That is the feature.
//
//   2. THE SAME MEMBER STILL READS NOTHING OF THAT CLAN DIRECTLY. The policies on
//      `clans` and `players` were not touched, and this is asserted beside the
//      new access rather than in a different file — exactly as
//      family-cwl-history.test.ts does for 037. If this block ever goes red, the
//      approach has drifted into widening policies and the fix is to go back,
//      not to update the expectation.
//
//   3. IT IS FAMILY-WIDE AND NO WIDER. An account holding no clan role anywhere
//      gets nothing, which is also how a PENDING account is refused — it has no
//      clan_roles row, so T3.8's gate holds here without this file knowing that
//      `status` exists.
//
//   4. THE SEARCH CANNOT BE USED TO ENUMERATE. Tags match exactly and never by
//      prefix, and LIKE metacharacters in a name term are literals — a bare '%'
//      must not become "list the clan".
//
//   5. ELDER EQUALS MEMBER IN SQL. 038 deliberately does not add
//      auth_elder_clan_ids(), and the elder tier is enforced in the application
//      only. Asserting the equality stops somebody later assuming a net that is
//      not there.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";
/** Soft-deleted. Must appear in neither function. */
const CLAN_GONE = "cccccccc-0000-4000-8000-0000000000c1";

const MEMBER_A = "11111111-0000-4000-8000-0000000000a2"; // member of A only
const ELDER_A = "22222222-0000-4000-8000-0000000000a3"; // elder of A only
const NOBODY = "33333333-0000-4000-8000-0000000000d4"; // approved, no role anywhere

const P_A1 = "55555555-0000-4000-8000-00000000001a";
const P_B1 = "55555555-0000-4000-8000-00000000001b";
const P_B2 = "55555555-0000-4000-8000-00000000001c";
/** In B, and has left. Hidden unless asked for. */
const P_B_LEFT = "55555555-0000-4000-8000-00000000001d";
/** In B, soft-deleted. Never returned. */
const P_B_DEAD = "55555555-0000-4000-8000-00000000001e";
/** In the soft-deleted clan. Never returned. */
const P_GONE = "55555555-0000-4000-8000-00000000001f";
/** A name carrying LIKE metacharacters. */
const P_ODD = "55555555-0000-4000-8000-000000000020";

interface ClanRow {
  id: string;
  tag: string;
  name: string;
  badge_url: string | null;
  level: number | null;
  war_league: string | null;
  member_count: number | null;
}

interface RosterRow {
  clan_id: string;
  player_id: string;
  tag: string;
  name: string;
  th_level: number | null;
  clan_role: string | null;
  left_at: string | null;
}

describe("038 — the family directory", () => {
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
      delete from player_progress;
      delete from player_nicknames;
      delete from players;
      delete from clan_roles;
      delete from users;
      delete from auth.users;
      delete from clans;

      insert into clans (id, tag, name, badge_url, level, war_league, member_count, deleted_at) values
        ('${CLAN_A}',    '#2PP0JCCL', 'Dark Hell',   'https://x/a.png', 12, 'Crystal League I', 42, null),
        ('${CLAN_B}',    '#20PP0JCC', 'DH CWL ONLY', 'https://x/b.png',  8, 'Gold League II',   15, null),
        ('${CLAN_GONE}', '#20PP0JCV', 'Retired',     null,               3, null,                0, now());

      insert into auth.users (id, email) values
        ('${MEMBER_A}', 'a@example.com'),
        ('${ELDER_A}',  'e@example.com'),
        ('${NOBODY}',   'n@example.com');

      insert into users (id, email, status) values
        ('${MEMBER_A}', 'a@example.com', 'approved'),
        ('${ELDER_A}',  'e@example.com', 'approved'),
        ('${NOBODY}',   'n@example.com', 'approved');

      insert into clan_roles (user_id, clan_id, role) values
        ('${MEMBER_A}', '${CLAN_A}', 'member'),
        ('${ELDER_A}',  '${CLAN_A}', 'elder');

      insert into players (id, clan_id, tag, name, th_level, clan_role, left_at, deleted_at) values
        ('${P_A1}',     '${CLAN_A}',    '#PY0LQGRJ', 'Ann',        16, 'leader',   null,  null),
        ('${P_B1}',     '${CLAN_B}',    '#C2V89UGL', 'SK FLASH',   15, 'elder',    null,  null),
        ('${P_B2}',     '${CLAN_B}',    '#L2QYGJ9P', 'Bob',        13, 'member',   null,  null),
        ('${P_B_LEFT}', '${CLAN_B}',    '#JYU8P2V0', 'Gone Guy',   11, 'member',   now(), null),
        ('${P_B_DEAD}', '${CLAN_B}',    '#QQ9C2L0V', 'Deleted',    10, 'member',   null,  now()),
        ('${P_GONE}',   '${CLAN_GONE}', '#V0L2GYUP', 'Retiree',     9, 'member',   null,  null),
        ('${P_ODD}',    '${CLAN_B}',    '#8YC2QL0G', '100% effort', 12, 'member',  null,  null);
    `);
  });

  async function clans(): Promise<ClanRow[]> {
    return (await h.db.query<ClanRow>(`select * from family_clans()`)).rows;
  }

  async function roster(
    ids: string[],
    term: string | null = null,
    departed = false,
  ): Promise<RosterRow[]> {
    const res = await h.db.query<RosterRow>(
      `select * from family_clan_roster($1::uuid[], $2::text, $3::boolean)`,
      [ids, term, departed],
    );
    return res.rows;
  }

  // ── 1. The feature ─────────────────────────────────────────────────────────

  describe("a member of one clan reads the whole family", () => {
    it("gets every live clan's overview, by tag", async () => {
      await h.asUser(MEMBER_A);
      const rows = await clans();

      expect(rows.map((c) => c.name)).toEqual(["DH CWL ONLY", "Dark Hell"]);
      expect(rows.find((c) => c.id === CLAN_B)).toMatchObject({
        tag: "#20PP0JCC",
        badge_url: "https://x/b.png",
        level: 8,
        war_league: "Gold League II",
        member_count: 15,
      });
    });

    it("gets the roster of a clan it holds no role in", async () => {
      await h.asUser(MEMBER_A);
      const rows = await roster([CLAN_B]);

      expect(rows.map((r) => r.name)).toEqual(["100% effort", "Bob", "SK FLASH"]);
      expect(rows.find((r) => r.player_id === P_B1)).toMatchObject({
        clan_id: CLAN_B,
        tag: "#C2V89UGL",
        th_level: 15,
        clan_role: "elder",
      });
    });

    it("reads several clans in one call", async () => {
      await h.asUser(MEMBER_A);
      const rows = await roster([CLAN_A, CLAN_B]);
      expect(new Set(rows.map((r) => r.clan_id))).toEqual(new Set([CLAN_A, CLAN_B]));
    });
  });

  // ── 2. THE NET. If this block fails, the approach drifted. ─────────────────

  describe("the tables' own policies are untouched", () => {
    it("still returns only its own clan from a direct select on clans", async () => {
      await h.asUser(MEMBER_A);
      const rows = await h.db.query<{ tag: string }>(`select tag from clans`);
      expect(rows.rows.map((r) => r.tag)).toEqual(["#2PP0JCCL"]);
    });

    it("still returns only its own clan's players from a direct select", async () => {
      await h.asUser(MEMBER_A);
      const rows = await h.db.query<{ name: string }>(`select name from players`);
      expect(rows.rows.map((r) => r.name)).toEqual(["Ann"]);
    });

    it("cannot reach another clan's member snapshots at all", async () => {
      await h.asUser(MEMBER_A);
      const rows = await h.db.query(`select 1 from member_snapshots`);
      expect(rows.rows).toHaveLength(0);
    });

    // The columns the function deliberately does not return. Widening `players`
    // would have handed these over along with everything else.
    it("returns no verified flag and no user_id", async () => {
      await h.asUser(MEMBER_A);
      const rows = await roster([CLAN_B]);
      for (const row of rows) {
        expect(row).not.toHaveProperty("verified");
        expect(row).not.toHaveProperty("user_id");
      }
    });
  });

  // ── 3. Family-wide, and no wider ───────────────────────────────────────────

  describe("who is answered", () => {
    it("gives an account with no clan role anywhere nothing at all", async () => {
      await h.asUser(NOBODY);
      expect(await clans()).toHaveLength(0);
      expect(await roster([CLAN_A, CLAN_B])).toHaveLength(0);
    });

    it("is executable by authenticated and not by anon", async () => {
      await h.asSuperuser();
      const res = await h.db.query<{ anon: boolean; authed: boolean }>(
        `select has_function_privilege('anon', 'family_clans()', 'execute') as anon,
                has_function_privilege('authenticated', 'family_clans()', 'execute') as authed`,
      );
      expect(res.rows[0]).toEqual({ anon: false, authed: true });

      const res2 = await h.db.query<{ anon: boolean; authed: boolean }>(
        `select has_function_privilege('anon', 'family_clan_roster(uuid[],text,boolean)', 'execute') as anon,
                has_function_privilege('authenticated', 'family_clan_roster(uuid[],text,boolean)', 'execute') as authed`,
      );
      expect(res2.rows[0]).toEqual({ anon: false, authed: true });
    });

    it("refuses more clans than any real caller needs", async () => {
      await h.asUser(MEMBER_A);
      const many = Array.from({ length: 21 }, () => CLAN_A);
      await expect(roster(many)).rejects.toThrow(/at most 20 clans/);
    });

    it("returns nothing for an empty clan list rather than everything", async () => {
      await h.asUser(MEMBER_A);
      expect(await roster([])).toHaveLength(0);
    });
  });

  // ── 4. The search cannot enumerate ─────────────────────────────────────────

  describe("searching", () => {
    it("matches part of a name, case-insensitively", async () => {
      await h.asUser(MEMBER_A);
      expect((await roster([CLAN_B], "flash")).map((r) => r.name)).toEqual(["SK FLASH"]);
    });

    it("matches a full tag exactly", async () => {
      await h.asUser(MEMBER_A);
      expect((await roster([CLAN_B], "#c2v89ugl")).map((r) => r.name)).toEqual([
        "SK FLASH",
      ]);
    });

    // The anti-enumeration rule. A prefix match here would be a way to walk the
    // family's tags a page at a time, in clans the caller has no role in.
    it("matches nothing for a partial tag", async () => {
      await h.asUser(MEMBER_A);
      expect(await roster([CLAN_B], "#C2V")).toHaveLength(0);
    });

    it("treats a bare percent sign as a literal, not as list-everything", async () => {
      await h.asUser(MEMBER_A);
      const rows = await roster([CLAN_B], "%");
      expect(rows.map((r) => r.name)).toEqual(["100% effort"]);
    });

    it("treats an underscore as a literal too", async () => {
      await h.asUser(MEMBER_A);
      expect(await roster([CLAN_B], "_")).toHaveLength(0);
    });
  });

  // ── Soft deletes and departures (R4) ───────────────────────────────────────

  describe("what is hidden", () => {
    it("omits a soft-deleted clan from the overview", async () => {
      await h.asUser(MEMBER_A);
      expect((await clans()).map((c) => c.id)).not.toContain(CLAN_GONE);
    });

    it("omits a soft-deleted clan's roster even when asked for it by id", async () => {
      await h.asUser(MEMBER_A);
      expect(await roster([CLAN_GONE])).toHaveLength(0);
    });

    it("omits a soft-deleted player", async () => {
      await h.asUser(MEMBER_A);
      expect((await roster([CLAN_B])).map((r) => r.name)).not.toContain("Deleted");
    });

    it("hides a departed member by default and includes them when asked", async () => {
      await h.asUser(MEMBER_A);
      expect((await roster([CLAN_B])).map((r) => r.name)).not.toContain("Gone Guy");

      const withDeparted = await roster([CLAN_B], null, true);
      const gone = withDeparted.find((r) => r.name === "Gone Guy");
      expect(gone).toBeDefined();
      expect(gone!.left_at).not.toBeNull();
    });
  });

  // ── 5. Elder equals member in SQL, deliberately ────────────────────────────

  describe("the elder tier has no database net, on purpose", () => {
    // 038's closing note argues this at length: an elder-only policy would need
    // the first DROP POLICY in the tree, and would blank the raids and clan-games
    // panels of a player profile every member is meant to see. The tier is
    // enforced in src/lib/visibility.ts instead. Asserting the equality here
    // stops somebody later assuming a net that does not exist.
    it("gives an elder and a member of the same clan identical reads", async () => {
      await h.asUser(MEMBER_A);
      const asMember = await roster([CLAN_A, CLAN_B]);
      const memberClans = (await clans()).map((c) => c.id);

      await h.asUser(ELDER_A);
      const asElder = await roster([CLAN_A, CLAN_B]);
      const elderClans = (await clans()).map((c) => c.id);

      expect(asElder.map((r) => r.player_id)).toEqual(asMember.map((r) => r.player_id));
      expect(elderClans).toEqual(memberClans);
    });
  });
});
