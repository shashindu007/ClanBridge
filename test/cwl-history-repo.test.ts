// T4.6, then T11C.2 — a player's CWL history, in one read.
//
// T4.6 replaced a per-player walk of a clan's whole CWL tree (thirty-one round
// trips each, called once per player by three pages) with one walk per clan.
// T11C.2 replaced THAT with familyCwlHistory(): one call to 037's
// family_cwl_history() for any number of players, across every platform clan,
// because the per-clan walk could only say what a player did HERE and members
// of this family play CWL in a different clan from the one they live in.
//
// The expectations below are the ones T4.6 pinned for the JavaScript walk —
// driven from the roster, idle players kept, newest first — now held against
// the SQL. The last test still counts round trips, for the reason T4.6 did: a
// change that reintroduced a per-player read would return exactly the right
// answers while undoing the whole point.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { familyCwlHistory } from "../src/repositories/cwl";

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
