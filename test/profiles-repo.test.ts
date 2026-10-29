// 065 — repositories/profiles.ts through the PGlite stand-in, and 065's policies.
//
// Two things are under test, and they are kept apart on purpose:
//
//   1. The repository's OWN filtering, as the superuser (RLS off): the clan
//      scope really filters by clan, and "owner" really does not.
//   2. 065's policies, as a signed-in member: a member reads their own clan's
//      rows and no other clan's, and the owner of a village that left every
//      platform clan still reads its profile.
//
// The roster builder's warPreferences() is checked for the same thing: a
// leader's pool is the clans they run, and a village filed under another clan
// must not answer for them.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { clanProfile, playerProfile, warPreferences } from "@/repositories/profiles";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";
const IN_A = "44444444-0000-4000-8000-00000000001a";
const IN_B = "44444444-0000-4000-8000-00000000001b";
const GONE = "44444444-0000-4000-8000-00000000001c";
const MEMBER_A = "11111111-0000-4000-8000-0000000000a1";

const achievements = JSON.stringify([
  { name: "Bigger Coffers", stars: 3, value: 17, target: 10, info: "Upgrade a Gold Storage", village: "home" },
]);

describe("065 — profiles", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
  });
  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.asSuperuser();
    await h.db.exec(`
      truncate clan_profiles, player_profiles, clan_roles, players, users, clans cascade;
      delete from auth.users;
      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#20PP0JCC', 'Clan B');
      insert into auth.users (id, email) values ('${MEMBER_A}', 'a@example.com');
      insert into users (id, email, status) values ('${MEMBER_A}', 'a@example.com', 'approved');
      insert into clan_roles (user_id, clan_id, role) values ('${MEMBER_A}', '${CLAN_A}', 'member');

      -- GONE is MEMBER_A's own village, and has left every platform clan.
      insert into players (id, clan_id, user_id, tag, name, left_at) values
        ('${IN_A}', '${CLAN_A}', null,          '#PY0LQGRJ', 'In A', null),
        ('${IN_B}', '${CLAN_B}', null,          '#PY0LQGRL', 'In B', null),
        ('${GONE}', '${CLAN_A}', '${MEMBER_A}', '#PY0LQGRP', 'Gone', now());

      insert into clan_profiles (clan_id, war_wins, war_ties, war_losses, war_win_streak,
                                 capital_league, capital_hall_level, capital_districts) values
        ('${CLAN_A}', 37, 4, 34, 1, 'Gold League I', 10, '[{"id": 70000000, "name": "Capital Peak", "level": 10}]'),
        ('${CLAN_B}', 12, 0, 9, 3, null, null, '[]');

      insert into player_profiles (player_id, clan_id, war_preference, war_stars, achievements, captured_at) values
        ('${IN_A}', '${CLAN_A}', 'out', 1240, '${achievements}', '2026-10-29T06:11:00Z'),
        ('${IN_B}', '${CLAN_B}', 'in',  310,  '[]', '2026-10-29T06:11:00Z'),
        ('${GONE}', null,        'in',  55,   '[]', '2026-10-29T06:11:00Z');
    `);
  });

  describe("the repository's own clan filter (R3)", () => {
    it("reads a clan's war record and capital", async () => {
      const profile = await clanProfile(client, CLAN_A);
      expect(profile).toMatchObject({
        warWins: 37,
        warTies: 4,
        warLosses: 34,
        warWinStreak: 1,
        capitalLeague: "Gold League I",
        capitalHallLevel: 10,
        capitalDistricts: [{ id: 70000000, name: "Capital Peak", level: 10 }],
      });
    });

    it("finds a village's profile only under the clan it is filed in", async () => {
      expect((await playerProfile(client, IN_A, { clanId: CLAN_A }))?.warStars).toBe(1240);
      expect(await playerProfile(client, IN_A, { clanId: CLAN_B })).toBeNull();
    });

    it("finds a village outside every clan only through the owner scope", async () => {
      expect(await playerProfile(client, GONE, { clanId: CLAN_A })).toBeNull();
      expect((await playerProfile(client, GONE, "owner"))?.warStars).toBe(55);
    });

    it("maps achievements and the read time", async () => {
      const profile = await playerProfile(client, IN_A, { clanId: CLAN_A });
      expect(profile!.warPreference).toBe("out");
      expect(profile!.achievements).toEqual([
        { name: "Bigger Coffers", stars: 3, value: 17, target: 10, info: "Upgrade a Gold Storage", village: "home" },
      ]);
      expect(profile!.capturedAt).toBe("2026-10-29T06:11:00.000Z");
    });

    it("answers war preferences only for the clans asked about", async () => {
      const prefs = await warPreferences(client, [IN_A, IN_B, GONE], [CLAN_A]);
      expect([...prefs]).toEqual([[IN_A, "out"]]);
      expect((await warPreferences(client, [IN_A], [])).size).toBe(0);
    });
  });

  describe("065's policies, as a signed-in member", () => {
    it("shows a member their own clan's war record and not another clan's", async () => {
      await h.asUser(MEMBER_A);
      expect((await clanProfile(client, CLAN_A))?.warWins).toBe(37);
      expect(await clanProfile(client, CLAN_B)).toBeNull();
    });

    it("hides another clan's village even when the clan filter names it", async () => {
      await h.asUser(MEMBER_A);
      expect(await playerProfile(client, IN_B, { clanId: CLAN_B })).toBeNull();
      expect((await warPreferences(client, [IN_A, IN_B], [CLAN_A, CLAN_B])).has(IN_B)).toBe(false);
    });

    it("still shows an owner their own village after it left every clan", async () => {
      await h.asUser(MEMBER_A);
      expect((await playerProfile(client, GONE, "owner"))?.warStars).toBe(55);
    });

    it("never shows the owner scope somebody else's village", async () => {
      await h.asUser(MEMBER_A);
      // IN_B is in a clan MEMBER_A holds no role in, and is not theirs.
      expect(await playerProfile(client, IN_B, "owner")).toBeNull();
    });
  });
});
