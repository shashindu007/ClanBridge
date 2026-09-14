// Phase 11 — a member's own bases at the database layer (031).
//
// The file exists for ONE assertion above all the others: widening `players`
// with an owner-filtered SELECT policy (T11.1) must not widen anything else.
// Every other table stays clan-filtered, so a village in a clan the member
// holds no role in is readable as a tag, a name and a town hall level — and
// nothing more. Not its donations, not its wars, not even the clan's NAME.
//
// That is why the fixture puts TWO clans in with identically shaped rows. A leak
// then shows up as a visible row rather than as an absence, which is the one
// failure mode an isolation test can silently miss.
//
// Also worth more than the rest: auth_owned_player_ids() IS DEFINER AND MUST
// STAY OWNER-SCOPED. 031's own policy depends on it, and so will 033's
// player_nicknames policies — so a bug in it is a bug in both, and its tests
// live here rather than beside whichever caller was written first.
//
// T11.3 extends this file with the nickname table's policies and privileges.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";

/** Approved into clan A, and owns a village in each clan. The subject. */
const OWNER = "11111111-0000-4000-8000-0000000000a2";
/** Also in clan A, owns nothing. Proves a nickname is not clan-wide. */
const OTHER_A = "22222222-0000-4000-8000-0000000000a3";
/** In clan B only. The mirror, so a leak has somewhere to show up. */
const MEMBER_B = "33333333-0000-4000-8000-0000000000b2";

/** OWNER's village in clan A — the one with a full report. */
const BASE_IN_A = "44444444-0000-4000-8000-00000000001a";
/** OWNER's village in clan B — the one 031 exists for. */
const BASE_IN_B = "55555555-0000-4000-8000-00000000001b";
/** Somebody else's village in clan A. Visible to OWNER, but not theirs to name. */
const OTHER_BASE = "66666666-0000-4000-8000-00000000001c";
/** Somebody else's village in clan B. Invisible to OWNER entirely. */
const STRANGER_BASE = "77777777-0000-4000-8000-00000000001d";

describe("Phase 11 — a member's own bases (031)", () => {
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
      delete from audit_log;
      delete from member_snapshots;
      delete from wars;
      delete from players;
      delete from clan_roles;
      delete from users;
      delete from auth.users;
      delete from clans;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#20PP0JCC', 'Clan B');

      insert into auth.users (id, email) values
        ('${OWNER}',    'owner@example.com'),
        ('${OTHER_A}',  'other@example.com'),
        ('${MEMBER_B}', 'b@example.com');

      insert into users (id, email, status) values
        ('${OWNER}',    'owner@example.com', 'approved'),
        ('${OTHER_A}',  'other@example.com', 'approved'),
        ('${MEMBER_B}', 'b@example.com',     'approved');

      -- OWNER holds a role in clan A ONLY. That is the whole point: their
      -- second village sits in a clan they were never approved into.
      insert into clan_roles (user_id, clan_id, role) values
        ('${OWNER}',    '${CLAN_A}', 'member'),
        ('${OTHER_A}',  '${CLAN_A}', 'member'),
        ('${MEMBER_B}', '${CLAN_B}', 'member');

      insert into players (id, clan_id, user_id, tag, name, th_level, verified) values
        ('${BASE_IN_A}',     '${CLAN_A}', '${OWNER}',    '#PY0LQGRJ', 'Owner Main', 16, true),
        ('${BASE_IN_B}',     '${CLAN_B}', '${OWNER}',    '#C2V89UGL', 'Owner Alt',  13, true),
        ('${OTHER_BASE}',    '${CLAN_A}', '${OTHER_A}',  '#L2QYGJ9P', 'Other',      15, true),
        ('${STRANGER_BASE}', '${CLAN_B}', '${MEMBER_B}', '#8QUCLJY0', 'Stranger',   14, true);

      -- Identically shaped rows in both clans, so a leak is a row and not a gap.
      insert into member_snapshots (clan_id, player_id, donations, trophies) values
        ('${CLAN_A}', '${BASE_IN_A}',     100, 5000),
        ('${CLAN_B}', '${BASE_IN_B}',     200, 3000),
        ('${CLAN_B}', '${STRANGER_BASE}', 300, 4000);

      insert into wars (clan_id, state, start_time) values
        ('${CLAN_A}', 'warEnded', '2026-09-01T00:00:00Z'),
        ('${CLAN_B}', 'warEnded', '2026-09-02T00:00:00Z');
    `);
  });

  /** Rows of `table` visible to whoever the session currently is. */
  async function visible(table: string): Promise<number> {
    const res = await h.db.query<{ n: number }>(
      `select count(*)::int as n from ${table}`,
    );
    return res.rows[0]!.n;
  }

  /** The tags of the `players` rows the current session can see, sorted. */
  async function visibleTags(): Promise<string[]> {
    const res = await h.db.query<{ tag: string }>(
      `select tag from players order by tag`,
    );
    return res.rows.map((r) => r.tag);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // T11.1 — the owner-filtered read, and its containment.
  // ─────────────────────────────────────────────────────────────────────────
  describe("031 — read own players", () => {
    it("shows a member the village they own in a clan they have no role in", async () => {
      await h.asUser(OWNER);

      // Clan A's two rows (their own main, and OTHER_A's) under 006's policy,
      // plus their own village in clan B under 031's. Postgres ORs permissive
      // SELECT policies, so the two sets union rather than intersect.
      expect(await visibleTags()).toEqual([
        "#C2V89UGL", // BASE_IN_B — owned, cross-clan. Only 031 admits this one.
        "#L2QYGJ9P", // OTHER_BASE — clan A, not owned.
        "#PY0LQGRJ", // BASE_IN_A — owned, same clan.
      ]);

      // The stranger's village in clan B stays invisible: not owned, and not in
      // a clan they hold a role in. If this appears, 031 has been written as a
      // clan widening rather than an owner filter.
      expect(await visibleTags()).not.toContain("#8QUCLJY0");
    });

    it("widens nothing but players — THE assertion this file exists for", async () => {
      await h.asUser(OWNER);

      // Clan B is not theirs. Owning a village inside it must buy them nothing
      // about the clan itself or about anybody else in it.
      const clanB = async (table: string, column = "clan_id") => {
        const res = await h.db.query<{ n: number }>(
          `select count(*)::int as n from ${table} where ${column} = $1`,
          [CLAN_B],
        );
        return res.rows[0]!.n;
      };

      expect(await clanB("clans", "id"), "clans").toBe(0);
      expect(await clanB("clan_roles"), "clan_roles").toBe(0);
      expect(await clanB("member_snapshots"), "member_snapshots").toBe(0);
      expect(await clanB("wars"), "wars").toBe(0);

      // Their own village's snapshots are included in that zero, deliberately.
      // The degraded state on /account/bases/[tag] is a consequence of this
      // line, not a design compromise — there is no history to render.
      const own = await h.db.query<{ n: number }>(
        `select count(*)::int as n from member_snapshots where player_id = $1`,
        [BASE_IN_B],
      );
      expect(own.rows[0]!.n, "own cross-clan snapshots").toBe(0);
    });

    it("leaves the clan-filtered read working for a member who owns nothing", async () => {
      // OTHER_A owns OTHER_BASE but nothing outside clan A, so 031 adds no rows
      // for them. This is the regression guard on 006's untouched policy.
      await h.asUser(OTHER_A);
      expect(await visibleTags()).toEqual(["#L2QYGJ9P", "#PY0LQGRJ"]);
    });

    it("shows a member nothing of another member's villages", async () => {
      await h.asUser(MEMBER_B);
      // Clan B's two rows, and neither of clan A's.
      expect(await visibleTags()).toEqual(["#8QUCLJY0", "#C2V89UGL"]);
    });

    it("returns no players at all to an anonymous request", async () => {
      // 006's done-when, restated because 031 adds a policy to this table and a
      // policy with a null auth.uid() is the classic way that stops being true.
      await h.asAnon();
      expect(await visible("players")).toBe(0);
    });

    it("grants the session no write on players (R11)", async () => {
      // 016 asserts this and the whole verification design rests on it: the only
      // member-initiated write is link_verified_player(), a definer function.
      // Adding a SELECT policy must not have changed it.
      await h.asSuperuser();
      const res = await h.db.query<{ update: boolean; insert: boolean }>(
        `select has_table_privilege('authenticated', 'players', 'update') as update,
                has_table_privilege('authenticated', 'players', 'insert') as insert`,
      );
      expect(res.rows[0]!.update).toBe(false);
      expect(res.rows[0]!.insert).toBe(false);
    });
  });

  describe("031 — auth_owned_player_ids()", () => {
    it("returns only the caller's own villages", async () => {
      await h.asUser(OWNER);
      const res = await h.db.query<{ id: string }>(
        `select t as id from auth_owned_player_ids() t order by t`,
      );
      expect(res.rows.map((r) => r.id).sort()).toEqual([BASE_IN_A, BASE_IN_B].sort());
    });

    it("returns nothing for a member who has verified nothing", async () => {
      await h.asSuperuser();
      await h.db.exec(`update players set user_id = null where id = '${OTHER_BASE}'`);
      await h.asUser(OTHER_A);
      const res = await h.db.query(`select t from auth_owned_player_ids() t`);
      expect(res.rows).toHaveLength(0);
    });

    it("is not executable by anon", async () => {
      await h.asAnon();
      await expect(h.db.query(`select t from auth_owned_player_ids() t`)).rejects.toThrow(
        /permission denied/i,
      );
    });
  });
});
