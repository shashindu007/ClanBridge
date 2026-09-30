// 052 — donation_segments(), executed against real Postgres.
//
// The function is the only place hourly readings are cut into stays, and every
// per-clan season figure is built on the cuts. Wrong here means wrong
// everywhere, silently.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000001";
const USER_A = "aaaaaaaa-0000-4000-8000-000000000002";
const MOVER = "aaaaaaaa-0000-4000-8000-000000000003";

interface Row {
  clan_id: string;
  start_reason: string;
  given: number;
  received: number;
}

describe("052 — donation_segments", () => {
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
      insert into players (id, clan_id, tag, name) values ('${MOVER}', '${CLAN_B}', '#PY0LQGRJ', 'Mover');

      -- In A, climbing. Then the monthly reset. Then a move to B, whose counter
      -- starts from zero. A null reading in the middle must not read as a reset.
      insert into member_snapshots (clan_id, player_id, captured_at, donations, donations_received) values
        ('${CLAN_A}', '${MOVER}', '2026-09-27 10:17+00', 100, 50),
        ('${CLAN_A}', '${MOVER}', '2026-09-28 10:17+00', 300, 80),
        ('${CLAN_A}', '${MOVER}', '2026-09-28 11:17+00', null, null),
        ('${CLAN_A}', '${MOVER}', '2026-09-29 04:17+00', 450, 90),
        ('${CLAN_A}', '${MOVER}', '2026-09-29 05:17+00', 0, 0),
        ('${CLAN_A}', '${MOVER}', '2026-09-30 10:17+00', 60, 20),
        ('${CLAN_B}', '${MOVER}', '2026-09-30 11:17+00', 5, 0),
        ('${CLAN_B}', '${MOVER}', '2026-10-01 11:17+00', 40, 10);
    `);
  });
  afterAll(async () => {
    await h?.close();
  });

  async function segments(clanIds: string[]): Promise<Row[]> {
    const res = await h.db.query<Row>(
      `select clan_id, start_reason, given, received
       from donation_segments($1::uuid[], '2026-09-01'::timestamptz)`,
      [`{${clanIds.join(",")}}`],
    );
    return res.rows;
  }

  it("cuts at the reset and at the move, and totals each stay by its last reading", async () => {
    await h.asSuperuser();
    expect(await segments([CLAN_A, CLAN_B])).toEqual([
      { clan_id: CLAN_A, start_reason: "first", given: 450, received: 90 },
      { clan_id: CLAN_A, start_reason: "drop", given: 60, received: 20 },
      { clan_id: CLAN_B, start_reason: "clan", given: 40, received: 10 },
    ]);
  });

  it("returns only what the caller's RLS lets them read", async () => {
    await h.asUser(USER_A);
    // Asking for both clans does not help: B's readings are not theirs.
    const rows = await segments([CLAN_A, CLAN_B]);
    expect(rows.map((r) => r.clan_id)).toEqual([CLAN_A, CLAN_A]);
  });

  it("honours the explicit clan filter even where RLS would allow more (R3)", async () => {
    await h.asSuperuser();
    const rows = await segments([CLAN_B]);
    expect(rows).toEqual([{ clan_id: CLAN_B, start_reason: "first", given: 40, received: 10 }]);
  });
});
