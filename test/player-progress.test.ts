// T11B.4 — player_progress at the database layer (036).
//
// Four things the migration claims, each of which fails silently if wrong:
//
//   1. A LEADER READS ONLY THEIR OWN CLAN'S VILLAGES. 006's shape, asserted with
//      identically shaped rows in two clans so a leak is a row, not a gap.
//   2. AN OWNER READS EVERY VILLAGE THEY OWN — including one in a clan they hold
//      no role in, and one that has left every platform clan (clan_id null).
//      That is what the owner policy is for, and it inherits 031's R3 argument.
//   3. THE OWNER POLICY GRANTS NOTHING ELSE. A member cannot read a stranger's
//      village in the other clan through it.
//   4. A SNAPSHOT CANNOT BE REWRITTEN (R5). The sync role inserts and never
//      updates or deletes, and a second capture on the same day is a no-op.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";

/** Member of clan A. Owns a village in A, one in B, and one in no clan. */
const OWNER = "11111111-0000-4000-8000-0000000000a2";
/** Leader of clan B, owns nothing. */
const LEADER_B = "33333333-0000-4000-8000-0000000000b2";

const BASE_IN_A = "44444444-0000-4000-8000-00000000001a";
const BASE_IN_B = "55555555-0000-4000-8000-00000000001b";
/** Left every platform clan; T3.9 kept the row. */
const BASE_CLANLESS = "66666666-0000-4000-8000-00000000001c";
/** Somebody else's village in clan B. */
const STRANGER_B = "77777777-0000-4000-8000-00000000001d";

describe("036 — player_progress", () => {
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
      delete from players;
      delete from clan_roles;
      delete from users;
      delete from auth.users;
      delete from clans;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#20PP0JCC', 'Clan B');

      insert into auth.users (id, email) values
        ('${OWNER}', 'owner@example.com'),
        ('${LEADER_B}', 'leader@example.com');

      insert into users (id, email, status) values
        ('${OWNER}', 'owner@example.com', 'approved'),
        ('${LEADER_B}', 'leader@example.com', 'approved');

      insert into clan_roles (user_id, clan_id, role) values
        ('${OWNER}', '${CLAN_A}', 'member'),
        ('${LEADER_B}', '${CLAN_B}', 'leader');

      insert into players (id, clan_id, user_id, tag, name, th_level, verified, left_at) values
        ('${BASE_IN_A}',     '${CLAN_A}', '${OWNER}', '#PY0LQGRJ', 'Main',     16, true, null),
        ('${BASE_IN_B}',     '${CLAN_B}', '${OWNER}', '#C2V89UGL', 'Alt',      13, true, null),
        ('${BASE_CLANLESS}', null,        '${OWNER}', '#L2QYGJ9P', 'Old',      11, true, now()),
        ('${STRANGER_B}',    '${CLAN_B}', null,       '#8QUCLJY0', 'Stranger', 14, false, null);

      insert into player_progress (player_id, clan_id, th_level, units) values
        ('${BASE_IN_A}',     '${CLAN_A}', 16, '[]'),
        ('${BASE_IN_B}',     '${CLAN_B}', 13, '[]'),
        ('${BASE_CLANLESS}', null,        11, '[]'),
        ('${STRANGER_B}',    '${CLAN_B}', 14, '[]');
    `);
  });

  async function visiblePlayers(): Promise<string[]> {
    const res = await h.db.query<{ player_id: string }>(
      `select player_id from player_progress order by player_id`,
    );
    return res.rows.map((r) => r.player_id);
  }

  it("shows a leader their own clan's villages and nothing else", async () => {
    await h.asUser(LEADER_B);
    expect(await visiblePlayers()).toEqual([BASE_IN_B, STRANGER_B].sort());
  });

  it("shows an owner every village they own, across clans and outside them", async () => {
    await h.asUser(OWNER);
    // BASE_IN_A through the clan policy; BASE_IN_B and BASE_CLANLESS only
    // through the owner policy. STRANGER_B through neither.
    expect(await visiblePlayers()).toEqual([BASE_IN_A, BASE_IN_B, BASE_CLANLESS].sort());
  });

  it("shows an anonymous visitor nothing", async () => {
    await h.asAnon();
    expect(await visiblePlayers()).toEqual([]);
  });

  it("gives a signed-in member no write of any kind (R11)", async () => {
    await h.asUser(OWNER);
    await expect(
      h.db.exec(
        `insert into player_progress (player_id, clan_id, units) values ('${BASE_IN_A}', '${CLAN_A}', '[]')`,
      ),
    ).rejects.toThrow();
  });

  it("lets the sync role insert but never update or delete (R5)", async () => {
    const res = await h.db.query<{ ins: boolean; upd: boolean; del: boolean }>(
      `select has_table_privilege('service_role', 'player_progress', 'insert') as ins,
              has_table_privilege('service_role', 'player_progress', 'update') as upd,
              has_table_privilege('service_role', 'player_progress', 'delete') as del`,
    );
    expect(res.rows[0]).toEqual({ ins: true, upd: false, del: false });
  });

  it("keeps one row per village per UTC day, whatever the session timezone", async () => {
    await h.asServiceRole();
    await h.db.exec(`set time zone 'Asia/Colombo'`);
    await h.db.exec(`
      insert into player_progress (player_id, clan_id, th_level, units)
      values ('${BASE_IN_A}', '${CLAN_A}', 17, '[]')
      on conflict (player_id, captured_day) do nothing
    `);
    await h.asSuperuser();
    await h.db.exec(`reset time zone`);
    const res = await h.db.query<{ n: number; th: number }>(
      `select count(*)::int as n, max(th_level)::int as th
         from player_progress where player_id = '${BASE_IN_A}'`,
    );
    // Still one row, still the first reading: a re-run cannot rewrite it.
    expect(res.rows[0]).toEqual({ n: 1, th: 16 });
  });

  it("refuses a units value that is not an array", async () => {
    await h.asSuperuser();
    await expect(
      h.db.exec(
        `insert into player_progress (player_id, clan_id, units, captured_at)
         values ('${BASE_IN_A}', '${CLAN_A}', '{}', now() - interval '3 days')`,
      ),
    ).rejects.toThrow(/player_progress_units_array/);
  });
});
