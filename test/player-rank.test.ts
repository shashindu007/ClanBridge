// 075 — rank in family_player_ratings() and player_rating_history(), against real
// Postgres roles.
//
// The first thing it holds is that the two can never disagree, because a player
// seeing different numbers on Home and on /rating is the failure this exists to end.
// R3 is unchanged and family-ratings.test.ts is its review; the guard is restated
// here only for the new function.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { familyRatings, playerRatingHistory } from "@/repositories/player-ratings";
import { rankHistories } from "@/lib/player-rank-data";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";
const CLAN_GONE = "cccccccc-0000-4000-8000-0000000000c1";

const MEMBER_A = "11111111-0000-4000-8000-0000000000a2";
const NOBODY = "33333333-0000-4000-8000-0000000000d4";

const P_TOP = "55555555-0000-4000-8000-00000000001a";
const P_TIE_1 = "55555555-0000-4000-8000-00000000001b";
const P_TIE_2 = "55555555-0000-4000-8000-00000000001c";
const P_NEXT = "55555555-0000-4000-8000-00000000001d";
const P_ZERO = "55555555-0000-4000-8000-00000000001e";
const P_NEGATIVE = "55555555-0000-4000-8000-00000000001f";
const P_LEFT = "55555555-0000-4000-8000-000000000020";
const P_GONE = "55555555-0000-4000-8000-000000000021";

const OLD_RUN = "2026-10-20T06:00:00Z";
const NEW_RUN = "2026-10-20T12:00:00Z";

/** Marks of `marks` in war, so a zero is a player with no marks at all. */
function row(month: string, player: string, clan: string, rating: number, marks: number, at = NEW_RUN) {
  return `('${month}', '${player}', '${clan}', 0, ${marks}, 0, 0, 0, 0, ${rating}, 0, 0, 0, ${rating}, '${at}')`;
}

describe("075 — one rank", () => {
  let h: Harness;
  const client = () => createPgliteSupabase(h.db);

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

      insert into players (id, clan_id, tag, name) values
        ('${P_TOP}', '${CLAN_A}', '#PY0LQGRJ', 'Top'),
        ('${P_TIE_1}', '${CLAN_A}', '#C2V89UGL', 'Zed'),
        ('${P_TIE_2}', '${CLAN_B}', '#L2QYGJ9P', 'Amy'),
        ('${P_NEXT}', '${CLAN_B}', '#V0L2GYUP', 'Next'),
        ('${P_ZERO}', '${CLAN_A}', '#GJUUGRVCU', 'Zero'),
        ('${P_NEGATIVE}', '${CLAN_B}', '#8QUCLJY0', 'Taker'),
        ('${P_LEFT}', '${CLAN_B}', '#2PP0JCV', 'Left'),
        ('${P_GONE}', '${CLAN_GONE}', '#2PP0JCL', 'Retiree');

      insert into player_ratings (month, player_id, clan_id, donation_marks, war_marks, cwl_marks,
                                  games_marks, raid_marks, donation_share, war_share, cwl_share,
                                  games_share, raid_share, rating, computed_at) values
        ${row("2026-10", P_TOP, CLAN_A, 40, 8)},
        ${row("2026-10", P_TIE_1, CLAN_A, 20, 4)},
        ${row("2026-10", P_TIE_2, CLAN_B, 20, 4)},
        ${row("2026-10", P_NEXT, CLAN_B, 10, 2)},
        ${row("2026-10", P_ZERO, CLAN_A, 0, 0)},
        ${row("2026-10", P_NEGATIVE, CLAN_B, -5, -1)},
        ${row("2026-10", P_GONE, CLAN_GONE, 90, 9)},
        ${row("2026-10", P_LEFT, CLAN_B, 80, 8, OLD_RUN)},
        ${row("2026-09", P_TOP, CLAN_A, 30, 6, OLD_RUN)},
        ${row("2026-08", P_ZERO, CLAN_A, 0, 0, OLD_RUN)};
    `);
    await h.asUser(MEMBER_A);
  });

  it("gives ties one rank and skips the next", async () => {
    const rows = await familyRatings(client(), "2026-10");
    expect(rows.map((r) => [r.name, r.familyRank, r.tied, r.clanRank])).toEqual([
      ["Top", 1, false, 1],
      ["Amy", 2, true, 1],
      ["Zed", 2, true, 2],
      ["Next", 4, false, 2],
      ["Zero", 5, false, 3],
      ["Taker", 6, false, 3],
    ]);
  });

  it("does the same inside a clan", async () => {
    await h.asSuperuser();
    await h.db.exec(`update player_ratings set rating = 40 where player_id = '${P_TIE_1}'`);
    await h.asUser(MEMBER_A);

    const rows = await familyRatings(client(), "2026-10");
    expect(rows.filter((r) => r.clanId === CLAN_A).map((r) => [r.name, r.clanRank])).toEqual([
      ["Top", 1],
      ["Zed", 1],
      ["Zero", 3],
    ]);
  });

  it("counts the family and the clan, leaving out departed and removed players", async () => {
    const [top] = await familyRatings(client(), "2026-10");
    expect(top).toMatchObject({ familySize: 6, clanSize: 3 });
  });

  it("counts players with marks, so a negative counts and a zero does not", async () => {
    const [top] = await familyRatings(client(), "2026-10");
    expect(top!.ratedPlayers).toBe(5);
  });

  it("never disagrees with the ranking page, for anyone", async () => {
    const page = await familyRatings(client(), "2026-10");
    const history = await playerRatingHistory(client(), page.map((p) => p.playerId), 1);

    for (const player of page) {
      expect(history.get(player.playerId)?.[0]?.placed).toMatchObject({
        familyRank: player.familyRank,
        tied: player.tied,
        clanRank: player.clanRank,
        rating: player.rating,
      });
    }
  });

  it("returns a player's months newest first, with a gap where they are absent", async () => {
    const months = (await playerRatingHistory(client(), [P_TOP], 3)).get(P_TOP)!;

    expect(months.map((m) => [m.month, m.placed?.familyRank ?? null])).toEqual([
      ["2026-10", 1],
      ["2026-09", 1],
      ["2026-08", null],
    ]);
  });

  it("names a month's size even for a player absent from it", async () => {
    const months = (await playerRatingHistory(client(), [P_TIE_1], 3)).get(P_TIE_1)!;
    expect(months[1]).toMatchObject({ month: "2026-09", familySize: 1, ratedPlayers: 1, placed: null });
  });

  it("does not bring back a departed player or a removed clan's", async () => {
    const history = await playerRatingHistory(client(), [P_LEFT, P_GONE], 1);
    expect(history.get(P_LEFT)?.[0]?.placed).toBeNull();
    expect(history.get(P_GONE)?.[0]?.placed).toBeNull();
  });

  it("reads a whole month for one player, not just their own rows", async () => {
    const [october] = (await playerRatingHistory(client(), [P_NEXT], 1)).get(P_NEXT)!;
    expect(october!.placed?.familyRank).toBe(4);
  });

  it("asks nothing with no players", async () => {
    expect((await playerRatingHistory(client(), [], 3)).size).toBe(0);
  });

  it("stops at 12 months, and treats a nonsense count as one", async () => {
    await h.asSuperuser();
    const values = Array.from({ length: 14 }, (_, i) =>
      row(`2025-${String(i % 12 + 1).padStart(2, "0")}`, P_TOP, CLAN_A, 1, 1, OLD_RUN).replace(
        "2025-",
        i < 12 ? "2025-" : "2024-",
      ),
    ).join(",");
    await h.db.exec(`
      insert into player_ratings (month, player_id, clan_id, donation_marks, war_marks, cwl_marks,
                                  games_marks, raid_marks, donation_share, war_share, cwl_share,
                                  games_share, raid_share, rating, computed_at) values ${values};
    `);
    await h.asUser(MEMBER_A);

    expect((await playerRatingHistory(client(), [P_TOP], 99)).get(P_TOP)).toHaveLength(12);
    expect((await playerRatingHistory(client(), [P_TOP], -4)).get(P_TOP)).toHaveLength(1);
  });

  it("refuses more than 500 players", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `55555555-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await expect(playerRatingHistory(client(), ids, 1)).rejects.toThrow(/at most 500/);
  });

  it("answers nobody holding no clan role", async () => {
    await h.asUser(NOBODY);
    expect((await playerRatingHistory(client(), [P_TOP], 3)).size).toBe(0);
  });

  it("is not callable by a signed-out visitor", async () => {
    await h.asAnon();
    await expect(
      h.db.query(`select * from player_rating_history(array['${P_TOP}']::uuid[], 1)`),
    ).rejects.toThrow(/permission denied/);
  });

  it("returns no account link or raw donation count", async () => {
    const res = await h.db.query<Record<string, unknown>>(
      `select * from player_rating_history(array['${P_TOP}']::uuid[], 1)`,
    );
    const columns = Object.keys(res.rows[0]!);
    for (const hidden of ["user_id", "verified", "donations", "donations_received"]) {
      expect(columns).not.toContain(hidden);
    }
  });

  it("gives a page null, not a crash, when the read fails", async () => {
    const failing = {
      rpc: async () => ({ data: null, error: { message: "down" } }),
    } as unknown as ReturnType<typeof client>;

    expect(await rankHistories(failing, [P_TOP], 3)).toBeNull();
  });
});
