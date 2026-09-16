// T4.6 — every player's CWL history for a clan, in one pass.
//
// This covers a rewrite of code that had NO test, which is why it exists rather
// than any defect found in it. playerSeasonHistory() answered for one player by
// walking the clan's whole CWL tree — seasons, then every war, then each war's
// roster and attacks — and filtering to that player in JavaScript afterwards.
// Three pages then called it once per player.
//
// /roster/[season] did that in a sequential loop over the availability pool. At
// eighty-one players and two seasons of seven wars it is on the order of two and
// a half thousand round trips, one after another, to render one page.
//
// So the last test counts queries. The arithmetic is the entire point of the
// change, and an edit that reintroduced a per-player read would still return
// exactly the right answers while undoing all of it.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import {
  familyCwlHistory,
  playerSeasonHistory,
  seasonHistoryForClan,
} from "../src/repositories/cwl";

const CLAN = "11111111-1111-4111-8111-111111111111";
const OTHER_CLAN = "11111111-1111-4111-8111-111111111112";
const S_AUG = "22222222-2222-4222-8222-222222222201";
const S_SEP = "22222222-2222-4222-8222-222222222202";
const W_AUG1 = "33333333-3333-4333-8333-333333333301";
const W_AUG2 = "33333333-3333-4333-8333-333333333302";
const W_SEP1 = "33333333-3333-4333-8333-333333333303";

const STAR = "44444444-4444-4444-8444-444444444401"; // rostered 3x, attacked 3x
const IDLE = "44444444-4444-4444-8444-444444444402"; // rostered 2x, never attacked
const NEWCOMER = "44444444-4444-4444-8444-444444444403"; // September only
const BENCH = "44444444-4444-4444-8444-444444444404"; // never rostered

describe("seasonHistoryForClan", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
    await h.asSuperuser();
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.db.exec(`
      delete from cwl_attacks;
      delete from cwl_war_members;
      delete from cwl_wars;
      delete from cwl_seasons;
      delete from players;
      delete from clans;
    `);

    // Tags use Supercell's alphabet only (0289PYLQGRJCUV); 001's
    // players_tag_format CHECK rejects anything else.
    await h.db.exec(`
      insert into clans (id, tag, name) values
        ('${CLAN}',       '#2PP0JCCL', 'Test Clan'),
        ('${OTHER_CLAN}', '#2PP0JCCV', 'Other Clan');

      insert into players (id, clan_id, user_id, tag, name) values
        ('${STAR}',     '${CLAN}', null, '#22PJ000', 'Star'),
        ('${IDLE}',     '${CLAN}', null, '#22PJ002', 'Idle'),
        ('${NEWCOMER}', '${CLAN}', null, '#22PJ008', 'Newcomer'),
        ('${BENCH}',    '${CLAN}', null, '#22PJ009', 'Bench');

      insert into cwl_seasons (id, clan_id, season) values
        ('${S_AUG}', '${CLAN}', '2026-08'),
        ('${S_SEP}', '${CLAN}', '2026-09');

      insert into cwl_wars (id, season_id, war_tag, day_number, state) values
        ('${W_AUG1}', '${S_AUG}', '#99GQ220', 1, 'warEnded'),
        ('${W_AUG2}', '${S_AUG}', '#99GQ221', 2, 'warEnded'),
        ('${W_SEP1}', '${S_SEP}', '#99GQ222', 1, 'warEnded');

      insert into cwl_war_members (war_id, player_id, map_position) values
        ('${W_AUG1}', '${STAR}', 1),
        ('${W_AUG1}', '${IDLE}', 2),
        ('${W_AUG2}', '${STAR}', 1),
        ('${W_AUG2}', '${IDLE}', 2),
        ('${W_SEP1}', '${STAR}', 1),
        ('${W_SEP1}', '${NEWCOMER}', 2);

      insert into cwl_attacks (war_id, player_id, attack_order, stars, destruction) values
        ('${W_AUG1}', '${STAR}', 1, 3, 100),
        ('${W_AUG2}', '${STAR}', 1, 2, 80),
        ('${W_SEP1}', '${STAR}', 1, 1, 40),
        ('${W_SEP1}', '${NEWCOMER}', 2, 3, 100);
    `);
  });

  it("totals a player across the wars of a season", async () => {
    const history = await playerSeasonHistory(client, CLAN, STAR);
    const august = history.find((s) => s.season === "2026-08")!;

    expect(august.warsRostered).toBe(2);
    expect(august.attacksUsed).toBe(2);
    expect(august.stars).toBe(5); // 3 + 2
  });

  // DRIVEN FROM THE ROSTER, NEVER FROM THE ATTACKS. A member who was in the war
  // and did nothing still has to appear, because they are the one a leader is
  // looking for. Iterating attacks instead makes them invisible — the same
  // argument warRecord() makes in services/cwl.ts.
  it("keeps a rostered player who never attacked", async () => {
    const history = await playerSeasonHistory(client, CLAN, IDLE);
    const august = history.find((s) => s.season === "2026-08")!;

    expect(august.warsRostered).toBe(2);
    expect(august.attacksUsed).toBe(0);
    expect(august.stars).toBe(0);
  });

  it("omits a season the player was not rostered in at all", async () => {
    expect(await playerSeasonHistory(client, CLAN, IDLE)).toHaveLength(1);
    expect(
      (await playerSeasonHistory(client, CLAN, NEWCOMER)).map((s) => s.season),
    ).toEqual(["2026-09"]);
  });

  it("returns nothing for a player who has never been rostered", async () => {
    expect(await playerSeasonHistory(client, CLAN, BENCH)).toEqual([]);
  });

  // The roster builder reads history[0] as "last CWL", so this order is load
  // bearing rather than incidental.
  it("orders seasons newest first, which is what history[0] means", async () => {
    expect((await playerSeasonHistory(client, CLAN, STAR)).map((s) => s.season)).toEqual([
      "2026-09",
      "2026-08",
    ]);
  });

  it("answers for every player at once, keyed by player id", async () => {
    const all = await seasonHistoryForClan(client, CLAN);

    expect(all.get(STAR)).toHaveLength(2);
    expect(all.get(IDLE)).toHaveLength(1);
    expect(all.get(NEWCOMER)).toHaveLength(1);
    expect(all.has(BENCH)).toBe(false);
  });

  // R3 — every season is resolved under a clan filter first, and every war,
  // roster and attack id descends from those seasons.
  it("returns nothing for a clan with no seasons of its own", async () => {
    expect((await seasonHistoryForClan(client, OTHER_CLAN)).size).toBe(0);
    expect(await playerSeasonHistory(client, OTHER_CLAN, STAR)).toEqual([]);
  });

  it("survives a season whose wars have not synced yet", async () => {
    await h.db.exec(`
      delete from cwl_attacks where war_id = '${W_SEP1}';
      delete from cwl_war_members where war_id = '${W_SEP1}';
      delete from cwl_wars where id = '${W_SEP1}';
    `);

    expect((await playerSeasonHistory(client, CLAN, STAR)).map((s) => s.season)).toEqual([
      "2026-08",
    ]);
  });

  // THE REASON THE REWRITE HAPPENED.
  //
  // The old shape was one full walk of the clan's CWL tree PER PLAYER, so the
  // count grew with the size of the availability pool. It has to be bounded by
  // the clan's WARS instead — the same reads whether one player is asked about
  // or all eighty-one.
  it("costs the same for every player as it does for one", async () => {
    const counted = createPgliteSupabase(h.db);
    let queries = 0;
    const original = counted.from.bind(counted);
    (counted as unknown as { from: (...a: unknown[]) => unknown }).from = (
      ...args: unknown[]
    ) => {
      queries += 1;
      return (original as unknown as (...a: unknown[]) => unknown)(...args);
    };

    const all = await seasonHistoryForClan(counted, CLAN);

    // 1 season list + 2 war lists + 3 rosters + 3 attack lists = 9. The exact
    // figure matters less than what it is bounded BY: the clan's wars. Add a
    // hundred players to this fixture and it does not move.
    expect(queries).toBeLessThanOrEqual(12);

    // One walk, every player answered. This is the property the call sites rely
    // on, and it is why they ask for the MAP rather than calling the per-player
    // function in a loop.
    //
    // NOT asserted here: that playerSeasonHistory() is free after this. It is
    // wrapped in React's cache(), which memoises per REQUEST and does nothing
    // outside one — so in this test each call legitimately walks the tree again.
    // That is exactly why the pages were changed to read the map directly
    // instead of relying on the cache to collapse eighty-one calls: performance
    // that depends on a framework's request scope is performance that vanishes
    // the first time something runs outside it.
    for (const player of [STAR, IDLE, NEWCOMER]) {
      expect(all.get(player), player).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T11C.2 — familyCwlHistory(), the family-wide replacement.
//
// The same fixture and the same expectations as above, because the SQL in 037
// has to agree with the JavaScript walk it replaces about every one of them —
// plus the case the walk could never answer: a season played in ANOTHER clan.
//
// Calls run as the service role. 037 answers no caller without a clan role, and
// the harness superuser has none; test/family-cwl-history.test.ts covers the
// guard itself against real member roles.
// ─────────────────────────────────────────────────────────────────────────────
describe("familyCwlHistory", () => {
  let h: Harness;
  let client: SupabaseClient;

  const S_OTHER = "22222222-2222-4222-8222-222222222203";
  const W_OTHER = "33333333-3333-4333-8333-333333333304";

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
      delete from cwl_attacks;
      delete from cwl_war_members;
      delete from cwl_wars;
      delete from cwl_seasons;
      delete from players;
      delete from clans;

      insert into clans (id, tag, name) values
        ('${CLAN}',       '#2PP0JCCL', 'Test Clan'),
        ('${OTHER_CLAN}', '#2PP0JCCV', 'Other Clan');

      insert into players (id, clan_id, user_id, tag, name) values
        ('${STAR}',     '${CLAN}', null, '#22PJ000', 'Star'),
        ('${IDLE}',     '${CLAN}', null, '#22PJ002', 'Idle'),
        ('${NEWCOMER}', '${CLAN}', null, '#22PJ008', 'Newcomer'),
        ('${BENCH}',    '${CLAN}', null, '#22PJ009', 'Bench');

      insert into cwl_seasons (id, clan_id, season) values
        ('${S_AUG}',   '${CLAN}',       '2026-08'),
        ('${S_SEP}',   '${CLAN}',       '2026-09'),
        ('${S_OTHER}', '${OTHER_CLAN}', '2026-07');

      insert into cwl_wars (id, season_id, war_tag, day_number, state) values
        ('${W_AUG1}',  '${S_AUG}',   '#99GQ220', 1, 'warEnded'),
        ('${W_AUG2}',  '${S_AUG}',   '#99GQ221', 2, 'warEnded'),
        ('${W_SEP1}',  '${S_SEP}',   '#99GQ222', 1, 'warEnded'),
        ('${W_OTHER}', '${S_OTHER}', '#99GQ228', 1, 'warEnded');

      insert into cwl_war_members (war_id, player_id, map_position) values
        ('${W_AUG1}',  '${STAR}', 1),
        ('${W_AUG1}',  '${IDLE}', 2),
        ('${W_AUG2}',  '${STAR}', 1),
        ('${W_AUG2}',  '${IDLE}', 2),
        ('${W_SEP1}',  '${STAR}', 1),
        ('${W_SEP1}',  '${NEWCOMER}', 2),
        ('${W_OTHER}', '${STAR}', 3);

      insert into cwl_attacks (war_id, player_id, attack_order, stars, destruction) values
        ('${W_AUG1}',  '${STAR}', 1, 3, 100),
        ('${W_AUG2}',  '${STAR}', 1, 2, 80),
        ('${W_SEP1}',  '${STAR}', 1, 1, 40),
        ('${W_SEP1}',  '${NEWCOMER}', 2, 3, 100),
        ('${W_OTHER}', '${STAR}', 1, 2, 90);
    `);
    await h.asServiceRole();
  });

  it("totals a player across the wars of a season, and names the clan", async () => {
    const august = (await familyCwlHistory(client, [STAR]))
      .get(STAR)!
      .find((s) => s.season === "2026-08")!;

    expect(august).toEqual({
      season: "2026-08",
      clanId: CLAN,
      clanTag: "#2PP0JCCL",
      clanName: "Test Clan",
      warsRostered: 2,
      attacksUsed: 2,
      stars: 5,
    });
  });

  // The case the per-clan walk could never answer.
  it("includes a season played in another clan, newest first across both", async () => {
    const history = (await familyCwlHistory(client, [STAR])).get(STAR)!;
    expect(history.map((s) => [s.season, s.clanName])).toEqual([
      ["2026-09", "Test Clan"],
      ["2026-08", "Test Clan"],
      ["2026-07", "Other Clan"],
    ]);
  });

  it("keeps a rostered player who never attacked", async () => {
    const august = (await familyCwlHistory(client, [IDLE])).get(IDLE)!;
    expect(august).toMatchObject([{ season: "2026-08", warsRostered: 2, attacksUsed: 0, stars: 0 }]);
  });

  it("omits seasons a player was not rostered in, and players never rostered at all", async () => {
    const all = await familyCwlHistory(client, [STAR, IDLE, NEWCOMER, BENCH]);
    expect(all.get(NEWCOMER)!.map((s) => s.season)).toEqual(["2026-09"]);
    expect(all.get(IDLE)).toHaveLength(1);
    expect(all.has(BENCH)).toBe(false);
  });

  it("answers every player in ONE round trip, without a query for an empty list", async () => {
    let calls = 0;
    const counted = {
      rpc: (...args: Parameters<SupabaseClient["rpc"]>) => {
        calls += 1;
        return client.rpc(...args);
      },
    } as unknown as SupabaseClient;

    await familyCwlHistory(counted, [STAR, IDLE, NEWCOMER, BENCH, STAR]);
    expect(calls).toBe(1);

    await familyCwlHistory(counted, []);
    expect(calls).toBe(1);
  });
});
