// The Clan Games rating from the stored scores to shares: the page's own loader
// reads the rows back through the real repositories — as a member, under RLS.
//
// The unit tests hand the service rows. This checks the path between: a month
// read under the wrong clan, a running month rated as if it had ended, an
// unmeasured member slipping into the total.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { loadGamesMonth } from "@/lib/games-rating-data";
import { gamesForClan } from "@/repositories/clan-games";

const CLAN = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_CLAN = "bbbbbbbb-0000-4000-8000-000000000001";
const MEMBER = "aaaaaaaa-0000-4000-8000-0000000000e1";
const OUTSIDER = "bbbbbbbb-0000-4000-8000-0000000000e1";
const SEPT = "aaaaaaaa-0000-4000-8000-0000000000c9";
const OCT = "aaaaaaaa-0000-4000-8000-0000000000ca";
const OTHER_SEPT = "bbbbbbbb-0000-4000-8000-0000000000c9";
const P = (n: number) => `aaaaaaaa-0000-4000-8000-00000000010${n}`;
const Q = (n: number) => `bbbbbbbb-0000-4000-8000-00000000010${n}`;

describe("the Clan Games rating, from the stored scores to shares", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);

    await h.asSuperuser();
    await h.db.exec(`
      insert into clans (id, tag, name) values
        ('${CLAN}', '#2PP0JCCL', 'Clan A'),
        ('${OTHER_CLAN}', '#8QUCLJY0', 'Clan B');
      insert into players (id, clan_id, tag, name) values
        ('${P(1)}', '${CLAN}', '#PYLQ0GR', 'Ann'),
        ('${P(2)}', '${CLAN}', '#PYLQ2GR', 'Ben'),
        ('${P(3)}', '${CLAN}', '#PYLQ8GR', 'Cat'),
        ('${P(4)}', '${CLAN}', '#PYLQ9GR', 'Dan'),
        ('${Q(1)}', '${OTHER_CLAN}', '#PYLQCGR', 'Eve');

      insert into clan_games (id, clan_id, season, start_time, end_time, settled_at) values
        ('${SEPT}', '${CLAN}', '2026-09', '2026-09-22T08:00:00Z', '2026-09-28T08:00:00Z', '2026-09-28T08:41:00Z'),
        ('${OCT}', '${CLAN}', '2026-10', '2026-10-22T08:00:00Z', '2026-10-28T08:00:00Z', null),
        ('${OTHER_SEPT}', '${OTHER_CLAN}', '2026-09', '2026-09-22T08:00:00Z', '2026-09-28T08:00:00Z', '2026-09-28T08:41:00Z');

      -- September: 7,000 + 12,000 (capped to 10,000) + 3,000 = 20 marks;
      -- Dan joined mid-period and has no opening reading.
      insert into clan_games_scores (clan_games_id, player_id, start_value, end_value, points) values
        ('${SEPT}', '${P(1)}', 100000, 107000, 7000),
        ('${SEPT}', '${P(2)}', 50000, 62000, 12000),
        ('${SEPT}', '${P(3)}', 20000, 23000, 3000),
        ('${SEPT}', '${P(4)}', null, null, null),
        ('${OCT}', '${P(1)}', 107000, null, null),
        ('${OTHER_SEPT}', '${Q(1)}', 1000, 5000, 4000);

      insert into auth.users (id, email) values
        ('${MEMBER}', 'member@example.com'),
        ('${OUTSIDER}', 'outsider@example.com');
      insert into users (id, email, status) values
        ('${MEMBER}', 'member@example.com', 'approved'),
        ('${OUTSIDER}', 'outsider@example.com', 'approved');
      insert into clan_roles (user_id, clan_id, role) values
        ('${MEMBER}', '${CLAN}', 'member'),
        ('${OUTSIDER}', '${OTHER_CLAN}', 'member');
    `);

    await h.asUser(MEMBER);
  });

  afterAll(async () => {
    await h?.close();
  });

  it("finds the clan's months, newest first", async () => {
    expect((await gamesForClan(client, CLAN)).map((g) => g.season)).toEqual(["2026-10", "2026-09"]);
  });

  it("rates a finished month by each player's share of the clan's marks", async () => {
    const { rating } = await loadGamesMonth(client, { id: CLAN }, "2026-09");
    expect(rating.settled).toBe(true);
    expect(rating.totalMarks).toBe(20);
    expect(rating.players.map((p) => [p.name, p.counted, p.marks, p.share])).toEqual([
      ["Ben", 10_000, 10, 50],
      ["Ann", 7_000, 7, 35],
      ["Cat", 3_000, 3, 15],
    ]);
  });

  it("lists the member who joined mid-period apart, not as a zero", async () => {
    const { rating } = await loadGamesMonth(client, { id: CLAN }, "2026-09");
    expect(rating.unmeasured.map((p) => p.name)).toEqual(["Dan"]);
  });

  it("rates nothing while the month's games are running", async () => {
    const view = await loadGamesMonth(client, { id: CLAN }, "2026-10");
    expect(view.games?.season).toBe("2026-10");
    expect(view.rating.settled).toBe(false);
    expect(view.rating.players).toEqual([]);
  });

  // R3 — a member of another clan reads none of it, through the same loader.
  it("shows another clan's member nothing", async () => {
    await h.asUser(OUTSIDER);
    try {
      expect(await gamesForClan(client, CLAN)).toEqual([]);
      const view = await loadGamesMonth(client, { id: CLAN }, "2026-09");
      expect(view.games).toBeNull();
      expect(view.rating.players).toEqual([]);
    } finally {
      await h.asUser(MEMBER);
    }
  });
});
