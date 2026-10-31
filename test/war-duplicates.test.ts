// 066 — clearing the wars recorded twice.
//
// The harness runs every migration on an empty database, where 066 finds nothing.
// So these seed the rows and run the file again. The rows it must LEAVE are the
// point: it runs against the only copy of the war history.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000002";
const PLAYER = "cccccccc-0000-4000-8000-000000000003";
const SQL = readFileSync(join(process.cwd(), "supabase", "migrations", "066_war_duplicates.sql"), "utf8");

describe("066 — wars recorded twice", () => {
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
      truncate war_attacks, war_targets, wars, sync_log, players, clans cascade;
      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP', 'A'), ('${CLAN_B}', '#2QQ', 'B');
      insert into players (id, tag, name, clan_id) values ('${PLAYER}', '#9VV', 'One', '${CLAN_A}');
    `);
  });

  async function war(clan: string, opponent: string, start: string, attacks: number): Promise<string> {
    const res = await h.db.query<{ id: string }>(
      `insert into wars (clan_id, state, opponent_tag, start_time, end_time)
       values ($1, 'warEnded', $2, $3::timestamptz, $3::timestamptz + interval '1 day') returning id`,
      [clan, opponent, start],
    );
    const id = res.rows[0]!.id;
    for (let n = 1; n <= attacks; n += 1) {
      await h.db.query(
        `insert into war_attacks (war_id, player_id, attack_order, stars, destruction)
         values ($1, $2, $3, 3, 100)`,
        [id, PLAYER, n],
      );
    }
    return id;
  }

  async function alive(): Promise<string[]> {
    const res = await h.db.query<{ id: string }>(`select id from wars where deleted_at is null`);
    return res.rows.map((r) => r.id);
  }

  it("removes the empty row of a pair, as in October", async () => {
    const stale = await war(CLAN_A, "#O1", "2026-10-20T19:55:00Z", 0);
    const live = await war(CLAN_A, "#O1", "2026-10-20T20:30:00Z", 2);

    await h.db.exec(SQL);

    expect(await alive()).toEqual([live]);
    const row = await h.db.query<{ deleted_at: Date | null }>(`select deleted_at from wars where id = $1`, [stale]);
    expect(row.rows[0]!.deleted_at).not.toBeNull(); // soft, not gone (R4)
  });

  it("keeps a real rematch against the same opponent", async () => {
    const first = await war(CLAN_A, "#O1", "2026-10-20T19:55:00Z", 0);
    const second = await war(CLAN_A, "#O1", "2026-10-22T19:55:00Z", 2);

    await h.db.exec(SQL);

    expect((await alive()).sort()).toEqual([first, second].sort());
  });

  it("keeps wars against different opponents, however close", async () => {
    const one = await war(CLAN_A, "#O1", "2026-10-20T19:55:00Z", 0);
    const two = await war(CLAN_A, "#O2", "2026-10-20T20:30:00Z", 2);

    await h.db.exec(SQL);

    expect((await alive()).sort()).toEqual([one, two].sort());
  });

  it("keeps the same opponent in another clan's war", async () => {
    const ours = await war(CLAN_A, "#O1", "2026-10-20T19:55:00Z", 0);
    const theirs = await war(CLAN_B, "#O1", "2026-10-20T20:30:00Z", 2);

    await h.db.exec(SQL);

    expect((await alive()).sort()).toEqual([ours, theirs].sort());
  });

  it("keeps a pair with no attacks on either side, since neither is shown to be the real one", async () => {
    const one = await war(CLAN_A, "#O1", "2026-10-20T19:55:00Z", 0);
    const two = await war(CLAN_A, "#O1", "2026-10-20T20:30:00Z", 0);

    await h.db.exec(SQL);

    expect((await alive()).sort()).toEqual([one, two].sort());
  });

  it("keeps a row a leader assigned targets on", async () => {
    const stale = await war(CLAN_A, "#O1", "2026-10-20T19:55:00Z", 0);
    const live = await war(CLAN_A, "#O1", "2026-10-20T20:30:00Z", 2);
    await h.db.query(
      `insert into war_targets (war_id, player_id, target_position) values ($1, $2, 1)`,
      [stale, PLAYER],
    );

    await h.db.exec(SQL);

    expect((await alive()).sort()).toEqual([stale, live].sort());
  });

  it("closes a sync row that died, and leaves one that may still be running", async () => {
    await h.db.exec(`
      insert into sync_log (job_type, status, started_at) values
        ('cwl', 'running', now() - interval '28 days'),
        ('war', 'running', now() - interval '5 minutes');
    `);

    await h.db.exec(SQL);

    const rows = await h.db.query<{ job_type: string; status: string; finished_at: Date | null }>(
      `select job_type, status, finished_at from sync_log order by job_type`,
    );
    expect(rows.rows[0]).toMatchObject({ job_type: "cwl", status: "failed" });
    expect(rows.rows[0]!.finished_at).not.toBeNull();
    expect(rows.rows[1]).toMatchObject({ job_type: "war", status: "running", finished_at: null });
  });
});
