// 058 — purge_cwl_scouting(), against real Postgres.
//
// It deletes across every clan and cannot be undone. The ways it could be
// wrong without raising anything:
//
//   1. clearing a season still being played — the scouting a war is planned on
//   2. touching our own history: standings and medals (cwl_group_clans/wars)
//   3. letting someone who is not the platform admin run it
//   4. a dry run that deletes
//   5. (059) deleting OUR clan's rows — a group's lineups and roster hold both
//      sides, and the button promises to touch the other clans only

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000001";
const ADMIN = "aaaaaaaa-0000-4000-8000-0000000000ad";
const MEMBER = "bbbbbbbb-0000-4000-8000-0000000000be";

/** Last year's season of clan A: finished by date. */
const OLD = "11111111-0000-4000-8000-0000000000a1";
/** This month's season of clan A, day 7 over: finished. */
const DONE = "11111111-0000-4000-8000-0000000000a2";
/** This month's season of clan B, day 3 in battle: being played. */
const LIVE = "11111111-0000-4000-8000-0000000000b1";

const THIS_MONTH = `to_char(now() at time zone 'UTC', 'YYYY-MM')`;

interface Purge {
  seasons_cleared: number;
  villages_removed: number;
  lineups_removed: number;
  rosters_removed: number;
}

/**
 * One enemy village, roster row and lineup row in a season — and, beside them,
 * our own clan's roster and lineup rows in the same group, which must survive.
 */
function scouting(season: string, n: string): string {
  return `
    insert into cwl_group_members (season_id, clan_tag, tag, th_level) values
      ('${season}', '#2QQ', '#P${n}', 17),
      ('${season}', '#2PP0JCCL', '#U${n}', 17);
    insert into cwl_group_war_members (season_id, war_tag, clan_tag, tag, attack_stars) values
      ('${season}', '#W${n}', '#2QQ', '#P${n}', 2),
      ('${season}', '#W${n}', '#2PP0JCCL', '#U${n}', 3);
    insert into cwl_scout_players (season_id, clan_tag, tag, hero_pct) values ('${season}', '#2QQ', '#P${n}', 80);
    insert into cwl_group_clans (season_id, clan_tag, name) values
      ('${season}', '#2QQ', 'Rival'),
      ('${season}', '#2PP0JCCL', 'Clan A');
  `;
}

async function count(h: Harness, table: string, where = "true"): Promise<number> {
  await h.asSuperuser();
  const res = await h.db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`);
  return res.rows[0]!.n;
}

describe("058 — purge_cwl_scouting", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await h.asSuperuser();
    await h.db.exec(`
      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');
      insert into auth.users (id, email) values
        ('${ADMIN}', 'owner@example.com'),
        ('${MEMBER}', 'member@example.com');
      insert into users (id, email, status, is_platform_admin) values
        ('${ADMIN}', 'owner@example.com', 'approved', true),
        ('${MEMBER}', 'member@example.com', 'approved', false);
      insert into clan_roles (user_id, clan_id, role) values ('${MEMBER}', '${CLAN_B}', 'leader');

      insert into cwl_seasons (id, clan_id, season) values
        ('${OLD}',  '${CLAN_A}', '2025-09'),
        ('${DONE}', '${CLAN_A}', ${THIS_MONTH}),
        ('${LIVE}', '${CLAN_B}', ${THIS_MONTH});

      insert into cwl_group_wars (season_id, war_tag, day_number, state, clan_tag, opponent_tag) values
        ('${DONE}', '#W7', 7, 'warEnded', '#2PP0JCCL', '#2QQ'),
        ('${LIVE}', '#W3', 3, 'inWar',    '#8QUCLJY0', '#2QQ');

      ${scouting(OLD, "1")}
      ${scouting(DONE, "2")}
      ${scouting(LIVE, "3")}
    `);
  });
  afterAll(async () => {
    await h?.close();
  });

  const purge = async (dryRun: boolean) => {
    const res = await h.db.query<Purge>(`select * from purge_cwl_scouting($1)`, [dryRun]);
    return res.rows[0]!;
  };

  it("refuses anyone who is not the platform admin (risk 3)", async () => {
    await h.asUser(MEMBER);
    await expect(purge(false)).rejects.toThrow(/platform admin only/);
    await expect(purge(true)).rejects.toThrow(/platform admin only/);
  });

  it("names each finished season's other clans in the preview, and nobody else's", async () => {
    await h.asUser(MEMBER);
    const none = await h.db.query(`select * from cwl_scouting_purge_preview()`);
    expect(none.rows).toEqual([]);

    await h.asUser(ADMIN);
    const res = await h.db.query<{
      clan_name: string;
      season: string;
      other_clans: string[];
      villages: number;
      lineups: number;
      rosters: number;
    }>(`select * from cwl_scouting_purge_preview()`);
    expect(res.rows.map((r) => r.season)).toEqual([
      (await h.db.query<{ m: string }>(`select ${THIS_MONTH} as m`)).rows[0]!.m,
      "2025-09",
    ]);
    for (const row of res.rows) {
      expect(row.clan_name).toBe("Clan A");
      expect(row.other_clans).toEqual(["Rival"]);
      expect([row.villages, row.lineups, row.rosters]).toEqual([1, 1, 1]);
    }
  });

  it("counts on a dry run and removes nothing (risk 4)", async () => {
    await h.asUser(ADMIN);
    expect(await purge(true)).toEqual({
      seasons_cleared: 2,
      villages_removed: 2,
      lineups_removed: 2,
      rosters_removed: 2,
    });
    expect(await count(h, "cwl_scout_players")).toBe(3);
  });

  it("clears finished seasons only, and keeps standings and medals (risks 1, 2)", async () => {
    await h.asUser(ADMIN);
    expect(await purge(false)).toEqual({
      seasons_cleared: 2,
      villages_removed: 2,
      lineups_removed: 2,
      rosters_removed: 2,
    });

    expect(await count(h, "cwl_scout_players")).toBe(1);
    for (const table of ["cwl_scout_players", "cwl_group_war_members", "cwl_group_members"]) {
      expect(await count(h, table, `clan_tag = '#2QQ'`), table).toBe(1);
      expect(await count(h, table, `clan_tag = '#2QQ' and season_id = '${LIVE}'`), table).toBe(1);
    }
    // Risk 5 — every row of our clan survives, finished seasons included.
    expect(await count(h, "cwl_group_war_members", `clan_tag = '#2PP0JCCL'`)).toBe(3);
    expect(await count(h, "cwl_group_members", `clan_tag = '#2PP0JCCL'`)).toBe(3);
    expect(await count(h, "cwl_group_clans")).toBe(6);
    expect(await count(h, "cwl_group_wars")).toBe(2);
    expect(await count(h, "audit_log", `entity = 'cwl_scouting'`)).toBe(1);
  });

  it("has nothing left to clear the second time", async () => {
    await h.asUser(ADMIN);
    expect((await purge(false)).seasons_cleared).toBe(0);
    expect(await count(h, "audit_log", `entity = 'cwl_scouting'`)).toBe(1);
  });
});
