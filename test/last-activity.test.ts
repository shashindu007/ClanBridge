// 055 — last_activity(), against real Postgres.
//
// The bug it fixes was silent: last activity was derived from the newest 1,000
// readings, so a member quiet for longer than that window was invisible — the
// 14-day flag could never fire, and nothing said so. The first test rebuilds
// exactly that situation.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000001";
const USER_A = "aaaaaaaa-0000-4000-8000-000000000002";
const QUIET = "aaaaaaaa-0000-4000-8000-00000000000a";
const BUSY = "aaaaaaaa-0000-4000-8000-00000000000b";
const RESET = "aaaaaaaa-0000-4000-8000-00000000000c";
const TROPHIES = "aaaaaaaa-0000-4000-8000-00000000000d";
const OTHER_CLAN = "bbbbbbbb-0000-4000-8000-00000000000e";

describe("055 — last_activity", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await h.asSuperuser();
    await h.db.exec(`
      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');
      insert into auth.users (id, email) values ('${USER_A}', 'a@example.com');
      insert into users (id, email, status) values ('${USER_A}', 'a@example.com', 'approved');
      insert into clan_roles (user_id, clan_id, role) values ('${USER_A}', '${CLAN_A}', 'member');
      insert into players (id, clan_id, tag, name) values
        ('${QUIET}', '${CLAN_A}', '#PY0LQGRJ', 'Quiet'),
        ('${BUSY}', '${CLAN_A}', '#PY0LQGRC', 'Busy'),
        ('${RESET}', '${CLAN_A}', '#L2QYGJ9P', 'Reset'),
        ('${TROPHIES}', '${CLAN_A}', '#8QUCLJY2', 'Trophies'),
        ('${OTHER_CLAN}', '${CLAN_B}', '#8QUCLJY0', 'Elsewhere');

      -- QUIET gave once, 20 days ago, then nothing: a reading every 30 minutes
      -- with the same values ever since. BUSY adds another ~960 rows alongside,
      -- so the clan has well over the 1,000 readings the old window stopped at.
      insert into member_snapshots (clan_id, player_id, captured_at, donations, donations_received, trophies)
      select '${CLAN_A}'::uuid, '${QUIET}'::uuid, now() - interval '20 days' - interval '30 minutes', 100, 0, 5000
      union all
      select '${CLAN_A}'::uuid, '${QUIET}'::uuid, now() - interval '20 days' + (n * interval '30 minutes'), 120, 0, 5000
      from generate_series(0, 955) as n;

      insert into member_snapshots (clan_id, player_id, captured_at, donations, donations_received, trophies)
      select '${CLAN_A}'::uuid, '${BUSY}'::uuid, now() - interval '20 days' + (n * interval '30 minutes'), n, 0, 5000
      from generate_series(0, 955) as n;

      -- RESET gave, then the monthly reset dropped the counter. The drop is not
      -- activity; neither is a missing reading.
      insert into member_snapshots (clan_id, player_id, captured_at, donations, donations_received, trophies) values
        ('${CLAN_A}', '${RESET}', now() - interval '5 days', 10, 0, 4000),
        ('${CLAN_A}', '${RESET}', now() - interval '4 days', 50, 0, 4000),
        ('${CLAN_A}', '${RESET}', now() - interval '3 days', 0, 0, 4000),
        ('${CLAN_A}', '${RESET}', now() - interval '2 days', null, null, null),
        ('${CLAN_A}', '${RESET}', now() - interval '1 day', 0, 0, 4000);

      -- TROPHIES only lost trophies. Losing them is still playing.
      insert into member_snapshots (clan_id, player_id, captured_at, donations, donations_received, trophies) values
        ('${CLAN_A}', '${TROPHIES}', now() - interval '3 days', 0, 0, 4100),
        ('${CLAN_A}', '${TROPHIES}', now() - interval '2 days', 0, 0, 4050);

      insert into member_snapshots (clan_id, player_id, captured_at, donations, donations_received, trophies) values
        ('${CLAN_B}', '${OTHER_CLAN}', now() - interval '2 days', 0, 0, 3000),
        ('${CLAN_B}', '${OTHER_CLAN}', now() - interval '1 day', 5, 0, 3000);
    `);
  });
  afterAll(async () => {
    await h?.close();
  });

  /** Days since each player's last activity, rounded; null for none. */
  async function daysAgo(clanIds: string[]): Promise<Record<string, number | null>> {
    const res = await h.db.query<{ player_id: string; days: number | null }>(
      `select player_id,
              round(extract(epoch from now() - last_activity_at) / 86400)::int as days
       from last_activity($1::uuid[], now() - interval '35 days')`,
      [`{${clanIds.join(",")}}`],
    );
    return Object.fromEntries(res.rows.map((r) => [r.player_id, r.days]));
  }

  it("finds activity 20 days back, behind more than 1,000 newer readings", async () => {
    await h.asSuperuser();
    expect((await daysAgo([CLAN_A]))[QUIET]).toBe(20);
  });

  it("does not count a reset or a missing reading as activity", async () => {
    await h.asSuperuser();
    expect((await daysAgo([CLAN_A]))[RESET]).toBe(4);
  });

  it("counts losing trophies as playing", async () => {
    await h.asSuperuser();
    expect((await daysAgo([CLAN_A]))[TROPHIES]).toBe(2);
  });

  it("returns only the clans asked for, and only what RLS allows", async () => {
    await h.asUser(USER_A);
    const seen = await daysAgo([CLAN_A, CLAN_B]);
    expect(Object.keys(seen)).not.toContain(OTHER_CLAN);
    expect(Object.keys(seen)).toContain(QUIET);
  });
});
