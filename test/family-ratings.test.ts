// T13.10 — family_player_ratings() and family_rating_months() (073), against real
// Postgres roles.
//
// This file is the security review for the third deliberate R3 exception, beside
// family-cwl-history.test.ts and family-directory.test.ts. What it holds, each of
// which fails SILENTLY if wrong:
//
//   1. A MEMBER OF ONE CLAN READS EVERY FAMILY PLAYER'S RATING. That is the feature.
//
//   2. THE SAME MEMBER STILL READS NOTHING OF THAT CLAN DIRECTLY. If this goes red
//      the approach has drifted into widening policies, and the fix is to go back.
//
//   3. IT IS FAMILY-WIDE AND NO WIDER. No clan role anywhere means no rows, which
//      is also how a pending account is refused. Anon cannot call it at all.
//
//   4. WHAT COMES BACK IS MARKS AND SHARES. No raw donations and no account links.
//
//   5. ONLY THE NEWEST RUN COUNTS. R4 keeps a departed member's row, and it must
//      not reappear in this month's ranking.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { familyRatings, ratingMonths } from "@/repositories/player-ratings";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";
const CLAN_GONE = "cccccccc-0000-4000-8000-0000000000c1";

const MEMBER_A = "11111111-0000-4000-8000-0000000000a2";
const NOBODY = "33333333-0000-4000-8000-0000000000d4";

const P_A = "55555555-0000-4000-8000-00000000001a";
const P_B = "55555555-0000-4000-8000-00000000001b";
/** Was in B, and left before the newest run. */
const P_LEFT = "55555555-0000-4000-8000-00000000001c";
/** In the soft-deleted clan. */
const P_GONE = "55555555-0000-4000-8000-00000000001d";

const OLD_RUN = "2026-10-20T06:00:00Z";
const NEW_RUN = "2026-10-20T12:00:00Z";

function row(month: string, player: string, clan: string, rating: number, computedAt: string) {
  return `('${month}', '${player}', '${clan}', 1.5, 2, 3, 4, 5, 10, 20, 30, 40, 50, ${rating}, '${computedAt}')`;
}

describe("073 — the family ranking", () => {
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
      truncate feedback, notifications, player_ratings, clan_roles, players, users, clans cascade;
      delete from auth.users;

      insert into clans (id, tag, name, deleted_at) values
        ('${CLAN_A}', '#2PP0JCCL', 'Dark Hell', null),
        ('${CLAN_B}', '#20PP0JCC', 'DH CWL ONLY', null),
        ('${CLAN_GONE}', '#20PP0JCV', 'Retired', now());

      insert into auth.users (id, email) values
        ('${MEMBER_A}', 'a@example.com'),
        ('${NOBODY}', 'n@example.com');
      insert into users (id, email, status) values
        ('${MEMBER_A}', 'a@example.com', 'approved'),
        ('${NOBODY}', 'n@example.com', 'approved');
      insert into clan_roles (user_id, clan_id, role) values
        ('${MEMBER_A}', '${CLAN_A}', 'member');

      insert into players (id, clan_id, tag, name, th_level) values
        ('${P_A}', '${CLAN_A}', '#PY0LQGRJ', 'Ann', 16),
        ('${P_B}', '${CLAN_B}', '#C2V89UGL', 'Ben', 15),
        ('${P_LEFT}', '${CLAN_B}', '#L2QYGJ9P', 'Left', 14),
        ('${P_GONE}', '${CLAN_GONE}', '#V0L2GYUP', 'Retiree', 9);

      insert into player_ratings (month, player_id, clan_id, donation_marks, war_marks, cwl_marks,
                                  games_marks, raid_marks, donation_share, war_share, cwl_share,
                                  games_share, raid_share, rating, computed_at) values
        ${row("2026-10", P_A, CLAN_A, 40, NEW_RUN)},
        ${row("2026-10", P_B, CLAN_B, 60, NEW_RUN)},
        ${row("2026-10", P_GONE, CLAN_GONE, 99, NEW_RUN)},
        ${row("2026-10", P_LEFT, CLAN_B, 80, OLD_RUN)},
        ${row("2026-09", P_LEFT, CLAN_B, 100, OLD_RUN)};
    `);
  });

  const client = () => createPgliteSupabase(h.db);

  it("gives a member of one clan the whole family, best first (1)", async () => {
    await h.asUser(MEMBER_A);
    const rows = await familyRatings(client(), "2026-10");

    expect(rows.map((r) => [r.name, r.clanName, r.rating])).toEqual([
      ["Ben", "DH CWL ONLY", 60],
      ["Ann", "Dark Hell", 40],
    ]);
    expect(rows[1]).toMatchObject({
      tag: "#PY0LQGRJ",
      clanTag: "#2PP0JCCL",
      thLevel: 16,
      marks: { donations: 1.5, war: 2, cwl: 3, games: 4, raids: 5 },
      shares: { donations: 10, war: 20, cwl: 30, games: 40, raids: 50 },
    });
  });

  it("lists every month with a ranking, newest first", async () => {
    await h.asUser(MEMBER_A);
    expect(await ratingMonths(client())).toEqual(["2026-10", "2026-09"]);
  });

  it("leaves a direct read of the table to that member's own clan (2)", async () => {
    await h.asUser(MEMBER_A);
    const res = await h.db.query<{ player_id: string }>(`select player_id from player_ratings`);
    expect(res.rows).toEqual([{ player_id: P_A }]);
  });

  it("answers nobody holding no clan role, and a pending account is one (3)", async () => {
    await h.asUser(NOBODY);
    expect(await familyRatings(client(), "2026-10")).toEqual([]);
    expect(await ratingMonths(client())).toEqual([]);
  });

  it("is not callable by a signed-out visitor (3)", async () => {
    await h.asAnon();
    await expect(h.db.query(`select * from family_player_ratings('2026-10')`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(h.db.query(`select * from family_rating_months()`)).rejects.toThrow(/permission denied/);
  });

  it("answers the sync job", async () => {
    await h.asServiceRole();
    expect(await ratingMonths(client())).toEqual(["2026-10", "2026-09"]);
  });

  it("returns marks and shares, and no donation counts or account link (4)", async () => {
    await h.asUser(MEMBER_A);
    const res = await h.db.query<Record<string, unknown>>(`select * from family_player_ratings('2026-10')`);
    const columns = Object.keys(res.rows[0]!);

    for (const hidden of ["user_id", "verified", "donations", "donations_received", "given", "received", "other"]) {
      expect(columns).not.toContain(hidden);
    }
  });

  it("drops a player the newest run no longer has, without deleting them (5)", async () => {
    await h.asUser(MEMBER_A);
    expect((await familyRatings(client(), "2026-10")).map((r) => r.name)).not.toContain("Left");

    await h.asSuperuser();
    const kept = await h.db.query(`select 1 from player_ratings where player_id = '${P_LEFT}'`);
    expect(kept.rows).toHaveLength(2);
  });

  it("keeps a month no longer recalculated as its last run left it (5)", async () => {
    await h.asUser(MEMBER_A);
    expect((await familyRatings(client(), "2026-09")).map((r) => r.name)).toEqual(["Left"]);
  });

  it("does not bring back a soft-deleted clan or player", async () => {
    await h.asUser(MEMBER_A);
    expect((await familyRatings(client(), "2026-10")).map((r) => r.name)).not.toContain("Retiree");

    await h.asSuperuser();
    await h.db.exec(`update players set deleted_at = now() where id = '${P_B}'`);
    await h.asUser(MEMBER_A);
    expect((await familyRatings(client(), "2026-10")).map((r) => r.name)).toEqual(["Ann"]);
  });

  it("lets the sync job write and update, but never delete (R4)", async () => {
    await h.asServiceRole();
    await h.db.exec(`update player_ratings set rating = 1 where player_id = '${P_A}'`);
    await expect(h.db.exec(`delete from player_ratings`)).rejects.toThrow(/permission denied/);
  });

  it("gives a member no way to write", async () => {
    await h.asUser(MEMBER_A);
    await expect(h.db.exec(`update player_ratings set rating = 100`)).rejects.toThrow(/permission denied/);
  });
});
