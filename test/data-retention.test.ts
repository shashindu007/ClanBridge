// 053 — thin_old_data() and storage_usage(), against real Postgres.
//
// This deletes, across every clan, and cannot be undone. The ways it could be
// wrong without raising anything:
//
//   1. deleting a stay's last reading, which silently changes a season total
//   2. deleting a stay's first reading, so the profile loses when they arrived
//   3. touching recent readings the pages still read hour by hour
//   4. letting someone who is not the platform admin run it
//   5. deleting a job's only sync_log row, so freshness says "never run"

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000001";
const ADMIN = "aaaaaaaa-0000-4000-8000-0000000000ad";
const MEMBER = "bbbbbbbb-0000-4000-8000-0000000000be";
const PLAYER = "aaaaaaaa-0000-4000-8000-000000000003";

const OLD = `date_trunc('day', now() - interval '200 days')`;

interface Run {
  snapshots_removed: number;
  progress_removed: number;
  sync_runs_removed: number;
  more: boolean;
}

describe("053 — thin_old_data", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await h.asSuperuser();

    // Day one: six hours in A, then a move to B for four. Day two: B climbs,
    // then the monthly reset drops the counter to zero.
    const day1 = [10, 20, 30, 40, 50, 60]
      .map((d, i) => `('${CLAN_A}', ${OLD} + interval '${i + 1} hours', ${d}, 0)`)
      .concat(
        [5, 15, 25, 35].map((d, i) => `('${CLAN_B}', ${OLD} + interval '${i + 7} hours', ${d}, 0)`),
      );
    const day2 = [40, 50, 0, 10].map(
      (d, i) => `('${CLAN_B}', ${OLD} + interval '1 day ${i + 1} hours', ${d}, 0)`,
    );
    const recent = [100, 110, 120].map(
      (d, i) => `('${CLAN_B}', now() - interval '10 days' + interval '${i} hours', ${d}, 0)`,
    );

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
      insert into players (id, clan_id, tag, name) values ('${PLAYER}', '${CLAN_B}', '#PY0LQGRJ', 'P');

      insert into member_snapshots (clan_id, player_id, captured_at, donations, donations_received)
      select v.clan_id::uuid, '${PLAYER}', v.at, v.given, v.received
      from (values ${[...day1, ...day2, ...recent].join(",\n")}) as v(clan_id, at, given, received);

      -- Three days of progress in one week, and one recent reading.
      insert into player_progress (player_id, clan_id, captured_at, units) values
        ('${PLAYER}', '${CLAN_B}', date_trunc('week', now() - interval '200 days') + interval '1 hour', '[]'),
        ('${PLAYER}', '${CLAN_B}', date_trunc('week', now() - interval '200 days') + interval '1 day 1 hour', '[]'),
        ('${PLAYER}', '${CLAN_B}', date_trunc('week', now() - interval '200 days') + interval '2 days 1 hour', '[]'),
        ('${PLAYER}', '${CLAN_B}', now() - interval '1 day', '[]');

      -- Two old clan runs superseded by a recent one; one old war run that is
      -- the only war run there is.
      insert into sync_log (job_type, started_at, status) values
        ('clans', now() - interval '200 days', 'success'),
        ('clans', now() - interval '199 days', 'success'),
        ('clans', now() - interval '1 hour',   'success'),
        ('war',   now() - interval '200 days', 'success');
    `);
  });
  afterAll(async () => {
    await h?.close();
  });

  const thin = async (months: number) => {
    const res = await h.db.query<Run>(`select * from thin_old_data($1)`, [months]);
    return res.rows[0]!;
  };

  it("refuses anyone who is not the platform admin (risk 4)", async () => {
    await h.asUser(MEMBER);
    await expect(thin(3)).rejects.toThrow(/platform admin only/);
  });

  it("refuses to keep fewer than three months", async () => {
    await h.asUser(ADMIN);
    await expect(thin(2)).rejects.toThrow(/between 3 and 24/);
  });

  it("works a month at a time until everything old enough is thinned", async () => {
    await h.asUser(ADMIN);
    const totals = { snapshots: 0, progress: 0, sync: 0 };
    let run: Run;
    let calls = 0;
    do {
      run = await thin(3);
      totals.snapshots += run.snapshots_removed;
      totals.progress += run.progress_removed;
      totals.sync += run.sync_runs_removed;
      calls += 1;
    } while (run.more && calls < 20);

    expect(run.more).toBe(false);
    expect(calls).toBeGreaterThan(1);
    expect(totals).toEqual({ snapshots: 7, progress: 2, sync: 2 });
  });

  it("keeps each stay's first and last reading and each day's last (risks 1, 2)", async () => {
    await h.asSuperuser();
    const res = await h.db.query<{ donations: number }>(
      `select donations from member_snapshots
       where captured_at < now() - interval '100 days' order by captured_at`,
    );
    // Day one: A's first (10) and last (60), B's first (5), the day's last (35).
    // Day two: the last before the reset (50), the first after it (0), the day's last (10).
    expect(res.rows.map((r) => r.donations)).toEqual([10, 60, 5, 35, 50, 0, 10]);
  });

  it("leaves recent readings alone (risk 3)", async () => {
    await h.asSuperuser();
    const res = await h.db.query<{ n: number }>(
      `select count(*)::int as n from member_snapshots where captured_at > now() - interval '30 days'`,
    );
    expect(res.rows[0]!.n).toBe(3);
  });

  it("keeps the newest run of every job (risk 5)", async () => {
    await h.asSuperuser();
    const res = await h.db.query<{ job_type: string }>(
      `select job_type from sync_log order by job_type`,
    );
    expect(res.rows.map((r) => r.job_type)).toEqual(["clans", "war"]);
  });

  it("has nothing left to do on a second pass", async () => {
    await h.asUser(ADMIN);
    expect(await thin(3)).toMatchObject({ snapshots_removed: 0, progress_removed: 0, more: false });
  });

  it("puts every run on the record", async () => {
    await h.asSuperuser();
    const audit = await h.db.query<{ n: number }>(
      `select count(*)::int as n from audit_log where entity = 'data_retention'`,
    );
    expect(audit.rows[0]!.n).toBeGreaterThan(1);

    const state = await h.db.query<{ keep_months: number; thinned_until: unknown }>(
      `select keep_months, thinned_until from data_retention`,
    );
    expect(state.rows[0]!.keep_months).toBe(3);
    expect(state.rows[0]!.thinned_until).not.toBeNull();
  });
});

describe("053 — storage_usage", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await h.asSuperuser();
    await h.db.exec(`
      insert into auth.users (id, email) values
        ('${ADMIN}', 'owner@example.com'), ('${MEMBER}', 'member@example.com');
      insert into users (id, email, status, is_platform_admin) values
        ('${ADMIN}', 'owner@example.com', 'approved', true),
        ('${MEMBER}', 'member@example.com', 'approved', false);
    `);
  });
  afterAll(async () => {
    await h?.close();
  });

  it("shows the platform admin the database and its tables", async () => {
    await h.asUser(ADMIN);
    const res = await h.db.query<{ name: string; bytes: string }>(`select * from storage_usage()`);
    const names = res.rows.map((r) => r.name);
    expect(names[0]).toBe("(database)");
    expect(names).toContain("member_snapshots");
    expect(Number(res.rows[0]!.bytes)).toBeGreaterThan(0);
  });

  it("shows anyone else nothing", async () => {
    await h.asUser(MEMBER);
    const res = await h.db.query(`select * from storage_usage()`);
    expect(res.rows).toEqual([]);
  });
});
