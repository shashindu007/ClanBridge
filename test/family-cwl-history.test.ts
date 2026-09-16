// T11C.6 — family_cwl_history() (037), against real Postgres roles.
//
// The fixture is SK FLASH's situation reduced to its shape: a village that
// played its CWL in the family's CWL clan (B) and now lives in its home clan (A).
//
// Four things this file exists to hold, each of which fails silently if wrong:
//
//   1. THE SEASON PLAYED IN ANOTHER CLAN IS RETURNED — with that clan's name — to
//      a member of the home clan. That is the bug.
//   2. IT IS FAMILY-WIDE, AND NO WIDER. A member of any platform clan sees it; a
//      signed-in account with no role sees only its own villages; anon nothing.
//   3. ONLY TOTALS LEAK. The CWL tables' own policies are untouched, so the same
//      member still reads ZERO of clan B's seasons, wars and attacks directly.
//   4. THE ARITHMETIC MATCHES WHAT IT REPLACED — rostered-and-idle counts as a
//      war with no attack, an attack from off the roster does not count, and
//      soft-deleted rows are gone.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1"; // home clan
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1"; // the CWL clan

const MEMBER_A = "11111111-0000-4000-8000-0000000000a2"; // role in A only
const MEMBER_B = "22222222-0000-4000-8000-0000000000b2"; // role in B only
const OWNER = "33333333-0000-4000-8000-0000000000c3"; // no role, owns FLASH
const NOBODY = "44444444-0000-4000-8000-0000000000d4"; // no role, owns nothing

/** Now in A. Played CWL in B. */
const FLASH = "55555555-0000-4000-8000-00000000001a";
/** Rostered in B's war and never attacked. */
const IDLE = "66666666-0000-4000-8000-00000000001b";
/** Attacked in B's war without being on its roster. */
const STRAY = "77777777-0000-4000-8000-00000000001c";

const S_AUG = "88888888-0000-4000-8000-000000000801";
const S_SEP = "88888888-0000-4000-8000-000000000802";
const W_AUG1 = "99999999-0000-4000-8000-000000000901";
const W_AUG2 = "99999999-0000-4000-8000-000000000902";
const W_SEP1 = "99999999-0000-4000-8000-000000000903";
/** Soft-deleted. Nothing in it may count. */
const W_GONE = "99999999-0000-4000-8000-000000000904";

interface Row {
  player_id: string;
  clan_id: string;
  clan_tag: string;
  clan_name: string;
  season: string;
  wars_rostered: number;
  attacks_used: number;
  stars: number;
}

describe("037 — family_cwl_history", () => {
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
      delete from cwl_attacks;
      delete from cwl_war_members;
      delete from cwl_wars;
      delete from cwl_seasons;
      delete from player_progress;
      delete from player_nicknames;
      delete from players;
      delete from clan_roles;
      delete from users;
      delete from auth.users;
      delete from clans;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Dark Hell'),
        ('${CLAN_B}', '#20PP0JCC', 'DH CWL ONLY');

      insert into auth.users (id, email) values
        ('${MEMBER_A}', 'a@example.com'),
        ('${MEMBER_B}', 'b@example.com'),
        ('${OWNER}',    'o@example.com'),
        ('${NOBODY}',   'n@example.com');

      insert into users (id, email, status) values
        ('${MEMBER_A}', 'a@example.com', 'approved'),
        ('${MEMBER_B}', 'b@example.com', 'approved'),
        ('${OWNER}',    'o@example.com', 'pending'),
        ('${NOBODY}',   'n@example.com', 'pending');

      insert into clan_roles (user_id, clan_id, role) values
        ('${MEMBER_A}', '${CLAN_A}', 'member'),
        ('${MEMBER_B}', '${CLAN_B}', 'member');

      insert into players (id, clan_id, user_id, tag, name) values
        ('${FLASH}', '${CLAN_A}', '${OWNER}', '#PY0LQGRJ', 'SK FLASH'),
        ('${IDLE}',  '${CLAN_B}', null,       '#C2V89UGL', 'Idle'),
        ('${STRAY}', '${CLAN_B}', null,       '#L2QYGJ9P', 'Stray');

      insert into cwl_seasons (id, clan_id, season) values
        ('${S_AUG}', '${CLAN_B}', '2026-08'),
        ('${S_SEP}', '${CLAN_B}', '2026-09');

      insert into cwl_wars (id, season_id, war_tag, day_number, state, deleted_at) values
        ('${W_AUG1}', '${S_AUG}', '#99GQ220', 1, 'warEnded', null),
        ('${W_AUG2}', '${S_AUG}', '#99GQ221', 2, 'warEnded', null),
        ('${W_SEP1}', '${S_SEP}', '#99GQ222', 1, 'warEnded', null),
        ('${W_GONE}', '${S_SEP}', '#99GQ228', 2, 'warEnded', now());

      insert into cwl_war_members (war_id, player_id, map_position) values
        ('${W_AUG1}', '${FLASH}', 1),
        ('${W_AUG2}', '${FLASH}', 1),
        ('${W_SEP1}', '${FLASH}', 1),
        ('${W_SEP1}', '${IDLE}',  2),
        ('${W_GONE}', '${FLASH}', 1);

      insert into cwl_attacks (war_id, player_id, attack_order, stars, destruction, deleted_at) values
        ('${W_AUG1}', '${FLASH}', 1, 3, 100, null),
        ('${W_AUG2}', '${FLASH}', 1, 2, 80,  null),
        ('${W_SEP1}', '${FLASH}', 1, 1, 40,  now()),   -- soft-deleted: not counted
        ('${W_SEP1}', '${STRAY}', 2, 3, 100, null),    -- not on the roster
        ('${W_GONE}', '${FLASH}', 1, 3, 100, null);    -- in a deleted war
    `);
  });

  async function history(ids: string[]): Promise<Row[]> {
    const res = await h.db.query<Row>(
      `select * from family_cwl_history($1::uuid[])`,
      [ids],
    );
    return res.rows;
  }

  it("gives a home-clan member the seasons played in the CWL clan, named, newest first", async () => {
    await h.asUser(MEMBER_A);
    const rows = await history([FLASH]);

    expect(rows).toEqual([
      {
        player_id: FLASH,
        clan_id: CLAN_B,
        clan_tag: "#20PP0JCC",
        clan_name: "DH CWL ONLY",
        season: "2026-09",
        wars_rostered: 1, // W_GONE is deleted
        attacks_used: 0, // its one attack is deleted
        stars: 0,
      },
      {
        player_id: FLASH,
        clan_id: CLAN_B,
        clan_tag: "#20PP0JCC",
        clan_name: "DH CWL ONLY",
        season: "2026-08",
        wars_rostered: 2,
        attacks_used: 2,
        stars: 5,
      },
    ]);
  });

  it("is family-wide: a member of a different platform clan sees the same", async () => {
    await h.asUser(MEMBER_B);
    expect(await history([FLASH])).toHaveLength(2);
  });

  it("still gives that member ZERO rows of the other clan's CWL tables directly", async () => {
    await h.asUser(MEMBER_A);
    for (const table of ["cwl_seasons", "cwl_wars", "cwl_war_members", "cwl_attacks"]) {
      const res = await h.db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
      expect(res.rows[0]!.n, table).toBe(0);
    }
  });

  it("counts a rostered player who never attacked, and ignores an attacker off the roster", async () => {
    await h.asUser(MEMBER_A);
    const rows = await history([IDLE, STRAY]);
    expect(rows.map((r) => [r.player_id, r.season, r.wars_rostered, r.attacks_used])).toEqual([
      [IDLE, "2026-09", 1, 0],
    ]);
  });

  it("answers an account with no clan role for its own villages only", async () => {
    await h.asUser(OWNER);
    expect(await history([FLASH, IDLE])).toSatisfy((rows: Row[]) =>
      rows.length === 2 && rows.every((r) => r.player_id === FLASH),
    );
  });

  it("answers an account with no role and no village with nothing", async () => {
    await h.asUser(NOBODY);
    expect(await history([FLASH, IDLE])).toEqual([]);
  });

  it("cannot be called anonymously at all", async () => {
    await h.asSuperuser();
    const res = await h.db.query<{ anon: boolean; authed: boolean }>(
      `select has_function_privilege('anon', 'family_cwl_history(uuid[])', 'execute') as anon,
              has_function_privilege('authenticated', 'family_cwl_history(uuid[])', 'execute') as authed`,
    );
    expect(res.rows[0]).toEqual({ anon: false, authed: true });
  });

  it("returns nothing for an empty list, and refuses more than 500 players", async () => {
    await h.asUser(MEMBER_A);
    expect(await history([])).toEqual([]);

    const tooMany = Array.from(
      { length: 501 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    await expect(history(tooMany)).rejects.toThrow(/at most 500/);
  });
});
