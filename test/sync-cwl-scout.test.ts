// 057 — the CWL scouting job, end to end against real Postgres.
//
// `fetch` is stubbed per tag, as in sync-players.test.ts: with USE_FIXTURES
// every /players/{tag} is the same file, and "each village got its own
// reading" would pass while proving nothing.
//
// What this job can get confidently wrong, none of which raises an error:
//
//   1. reading our own members as if they were the enemy
//   2. spending the day's calls again every two hours
//   3. one village the API no longer knows failing the rest of the group
//   4. reading a group whose week is over, or a season from another month
//   5. reading the next opponent last, after a cut-short run

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { runSyncJob } from "../scripts/sync/shared";
import { FRESH_FOR_MS, planCalls, syncCwlScout, type ScoutTarget } from "../scripts/sync/cwl-scout";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const SEASON_ID = "11111111-0000-4000-8000-0000000000c1";

const OUR_TAG = "#2PP0JCCL";
const ENEMY_X = "#8QUCLJY0";
/** Our opponent on preparation day — read first. */
const ENEMY_Y = "#9CUVPYQ2";

const OUR_MEMBER = "#PY0LQGRJ";
const X1 = "#PY0LQGRC";
const X2 = "#L2QYGJ9P";
const Y1 = "#2Y8QJ0LG";
const GONE = "#Q8LV2YUP";

const NOW = new Date("2026-10-03T12:00:00Z");

const FIXTURE = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "player.json"), "utf8"),
) as Record<string, unknown>;

async function count(h: Harness, table: string, where = "true"): Promise<number> {
  const res = await h.db.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
  );
  return res.rows[0]!.n;
}

/** Answer `/players/{tag}` with the real fixture body, re-tagged, or 404. */
function respondFor(known: string[], calls: string[] = []) {
  process.env.USE_FIXTURES = "false";
  process.env.COC_API_TOKEN = "not-a-real-token";
  process.env.COC_THROTTLE_MS = "0";
  process.env.COC_BACKOFF_MS = "0";

  vi.stubGlobal("fetch", (url: string) => {
    const tag = decodeURIComponent(String(url).split("/players/")[1] ?? "");
    calls.push(tag);
    if (!known.includes(tag)) {
      return Promise.resolve(
        new Response(JSON.stringify({ reason: "notFound" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ...FIXTURE, tag, name: `Village ${tag}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return calls;
}

const run = (client: SupabaseClient, now = NOW) =>
  runSyncJob("cwl-scout", (ctx) => syncCwlScout(ctx, now), { client });

describe("057 — CWL scouting", () => {
  describe("planCalls — the per-run budget", () => {
    const t = (tag: string, clanTag: string, priority: number, seasonId = "s1"): ScoutTarget => ({
      seasonId,
      clanTag,
      tag,
      priority,
    });

    it("reads the next opponent first, then by clan and tag", () => {
      const plan = planCalls([t("#B", "#X", 2), t("#A", "#X", 2), t("#C", "#Y", 0)]);
      expect(plan.map((c) => c.tag)).toEqual(["#C", "#A", "#B"]);
    });

    it("reads a village listed under two seasons once, filed under both", () => {
      const plan = planCalls([t("#A", "#X", 2, "s1"), t("#A", "#X", 1, "s2")]);
      expect(plan).toHaveLength(1);
      expect(plan[0]!.targets.map((x) => x.seasonId)).toEqual(["s1", "s2"]);
    });

    it("stops at the limit", () => {
      expect(planCalls([t("#A", "#X", 2), t("#B", "#X", 2), t("#C", "#X", 2)], 2)).toHaveLength(2);
    });
  });

  describe("against real Postgres", () => {
    let h: Harness;
    let client: SupabaseClient;

    beforeAll(async () => {
      h = await createHarness();
      client = createPgliteSupabase(h.db);
    });
    afterAll(async () => {
      await h?.close();
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    beforeEach(async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "error").mockImplementation(() => {});

      await h.asSuperuser();
      await h.db.exec(`
        truncate cwl_seasons, sync_log, players, clans cascade;
        insert into clans (id, tag, name) values ('${CLAN_A}', '${OUR_TAG}', 'Ours');
        insert into cwl_seasons (id, clan_id, season) values ('${SEASON_ID}', '${CLAN_A}', '2026-10');

        insert into cwl_group_members (season_id, clan_tag, tag, th_level) values
          ('${SEASON_ID}', '${OUR_TAG}', '${OUR_MEMBER}', 17),
          ('${SEASON_ID}', '${ENEMY_X}', '${X1}', 17),
          ('${SEASON_ID}', '${ENEMY_X}', '${X2}', 16),
          ('${SEASON_ID}', '${ENEMY_Y}', '${Y1}', 18);

        insert into cwl_group_wars (season_id, war_tag, day_number, state, clan_tag, opponent_tag) values
          ('${SEASON_ID}', '#8G9QRVJL', 1, 'warEnded', '${OUR_TAG}', '${ENEMY_X}'),
          ('${SEASON_ID}', '#9CUVPYQ8', 2, 'preparation', '${ENEMY_Y}', '${OUR_TAG}');

        insert into cwl_wars (season_id, war_tag, day_number, opponent_tag, state) values
          ('${SEASON_ID}', '#8G9QRVJL', 1, '${ENEMY_X}', 'warEnded'),
          ('${SEASON_ID}', '#9CUVPYQ8', 2, '${ENEMY_Y}', 'preparation');
      `);
    });

    it("reads every enemy village once, never our own, next opponent first", async () => {
      const calls = respondFor([X1, X2, Y1]);
      expect(await run(client)).toBe("success");

      expect(calls).toEqual([Y1, X2, X1]);
      expect(await count(h, "cwl_scout_players")).toBe(3);
      expect(await count(h, "cwl_scout_players", `tag = '${OUR_MEMBER}'`)).toBe(0);

      const row = await h.db.query<{
        clan_tag: string;
        name: string;
        th_level: number;
        heroes: Array<{ short: string; level: number; cap: number }>;
        hero_pct: string | null;
      }>(`select clan_tag, name, th_level, heroes, hero_pct from cwl_scout_players where tag = '${Y1}'`);
      const y = row.rows[0]!;
      expect(y.clan_tag).toBe(ENEMY_Y);
      expect(y.name).toBe(`Village ${Y1}`);
      expect(y.th_level).toBe(FIXTURE.townHallLevel);
      expect(y.heroes.length).toBeGreaterThan(0);
      // The Town Hall cap, never the game maximum the API reports.
      expect(y.heroes.every((hero) => hero.cap > 0)).toBe(true);
      expect(Number(y.hero_pct)).toBeGreaterThan(0);
    });

    it("does not read a village again within 20 hours, and does after", async () => {
      respondFor([X1, X2, Y1]);
      await run(client);

      const again = respondFor([X1, X2, Y1], []);
      expect(await run(client, new Date(NOW.getTime() + 2 * 60 * 60 * 1000))).toBe("skipped");
      expect(again).toEqual([]);

      const later = respondFor([X1, X2, Y1], []);
      expect(await run(client, new Date(NOW.getTime() + FRESH_FOR_MS + 60_000))).toBe("success");
      expect(later).toHaveLength(3);
      // Refreshed in place — one row per village per season, not a history.
      expect(await count(h, "cwl_scout_players")).toBe(3);
    });

    it("skips a village the API no longer knows and reads the rest", async () => {
      await h.db.exec(
        `insert into cwl_group_members (season_id, clan_tag, tag) values ('${SEASON_ID}', '${ENEMY_X}', '${GONE}')`,
      );
      respondFor([X1, X2, Y1]);
      expect(await run(client)).toBe("success");
      expect(await count(h, "cwl_scout_players")).toBe(3);
    });

    it("skips cleanly when the week is over", async () => {
      await h.db.exec(`update cwl_group_wars set state = 'warEnded'`);
      const calls = respondFor([X1, X2, Y1]);
      expect(await run(client)).toBe("skipped");
      expect(calls).toEqual([]);
      const log = await h.db.query<{ skip_reason: string }>(
        `select skip_reason from sync_log where job_type = 'cwl-scout' order by started_at desc limit 1`,
      );
      expect(log.rows[0]!.skip_reason).toBe("noCwlGroup");
    });

    it("never reads last month's group", async () => {
      const calls = respondFor([X1, X2, Y1]);
      expect(await run(client, new Date("2026-11-02T12:00:00Z"))).toBe("skipped");
      expect(calls).toEqual([]);
    });
  });
});
