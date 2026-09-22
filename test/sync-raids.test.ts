// T7.1 — the capital raid sync, end to end and entirely offline.
//
// fixtures -> Zod -> mappers -> SQL -> real Postgres, with USE_FIXTURES=true and
// a throwing `fetch`, so nothing touches the network.
//
// Raids are the most forgiving data in the project — `/capitalraidseasons`
// returns the last N weekends complete on every call, so a missed run costs
// nothing inside the limit. That moves the risk somewhere else. The ways this
// job can be confidently wrong are:
//
//   1. rewriting a settled weekend, because the API keeps sending it for weeks
//      after it ended and every run is a fresh chance to overwrite it (R5)
//   2. freezing an ONGOING weekend as if it were finished, which loses the
//      hours between the last run and the weekend's actual end
//   3. dropping attack_limit, leaving "5 attacks used" with no denominator and
//      T7.3 unable to say whether that was everything asked (027)
//   4. reporting "nothing to do" as a failure — the ordinary midweek state
//
// None of the four produces an error at the time.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { runSyncJob } from "../scripts/sync/shared";
import { syncRaids } from "../scripts/sync/raids";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER = "aaaaaaaa-0000-4000-8000-000000000002";

/**
 * Read from the fixtures, not written down here — see the note in
 * test/sync-cwl.test.ts. These were literals until T2.1 captured real data and
 * every one of them changed at once.
 */
const CLAN_FIXTURE = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "clan.json"), "utf8"),
) as { tag: string };

const RAIDS = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "capitalraids.json"), "utf8"),
) as {
  items: Array<{
    state: string;
    raidsCompleted?: number;
    totalAttacks?: number;
    offensiveReward?: number;
    defensiveReward?: number;
    members?: Array<{
      tag: string;
      attacks?: number;
      attackLimit?: number;
      bonusAttackLimit?: number;
      capitalResourcesLooted?: number;
    }>;
  }>;
};

/** The clan the raid weekends belong to — the same one clan.json describes. */
const OUR_TAG = CLAN_FIXTURE.tag;

/** The most recent weekend, which is the one the job records. */
const LATEST = RAIDS.items[0]!;
const RAIDER_COUNT = LATEST.members?.length ?? 0;
const FIRST_RAIDER = LATEST.members![0]!;

/**
 * Every weekend on the response, not just the newest.
 *
 * `/capitalraidseasons` returns the last N weekends complete on every call, and
 * the job records all of them — that is what makes a missed run harmless, and it
 * is the reason raids are the most forgiving data in the project.
 */
const SEASON_COUNT = RAIDS.items.length;

async function count(h: Harness, table: string, where = "true"): Promise<number> {
  const res = await h.db.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
  );
  return res.rows[0]!.n;
}

describe("T7.1 — the capital raid sync", () => {
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
    process.env.USE_FIXTURES = "true";
    delete process.env.COC_API_TOKEN;
    vi.stubGlobal("fetch", () => {
      throw new Error("network was used while USE_FIXTURES=true");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await h.asSuperuser();
    await h.db.exec(`
      truncate feedback, notifications, raid_participants, raid_seasons,
               member_snapshots, players, sync_log, users, clans cascade;
      delete from auth.users;
      insert into clans (id, tag, name) values ('${CLAN_A}', '${OUR_TAG}', 'Synthetic Clan');
    `);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("skips cleanly when no clan is seeded", async () => {
    await h.db.exec(`truncate players, clans cascade`);
    const result = await runSyncJob("raids", syncRaids, { client });

    expect(result).toBe("skipped");
    const log = await h.db.query<{ skip_reason: string }>(
      `select skip_reason from sync_log order by started_at desc limit 1`,
    );
    expect(log.rows[0]!.skip_reason).toBe("noClansSeeded");
  });

  it("captures the weekend and everyone who raided", async () => {
    const result = await runSyncJob("raids", syncRaids, { client });

    expect(result).toBe("success");
    expect(await count(h, "raid_seasons")).toBe(SEASON_COUNT);
    expect(await count(h, "raid_participants")).toBe(RAIDER_COUNT);
  });

  // 027. Each of these was arriving on the response and being dropped before
  // the columns existed — the fourth occurrence of the discard bug 019, 020 and
  // 026 each corrected, and the first one caught before the sync was written.
  it("stores the season detail 027 added, not just loot", async () => {
    await runSyncJob("raids", syncRaids, { client });

    const row = await h.db.query<{
      state: string;
      raids_completed: number;
      total_attacks: number;
      offensive_reward: number;
      defensive_reward: number;
      total_loot: number;
    }>(`select state, raids_completed, total_attacks,
               offensive_reward, defensive_reward, total_loot from raid_seasons`);

    expect(row.rows[0]).toMatchObject({
      state: LATEST.state,
      raids_completed: LATEST.raidsCompleted,
      total_attacks: LATEST.totalAttacks,
      offensive_reward: LATEST.offensiveReward,
      defensive_reward: LATEST.defensiveReward,
    });
  });

  // Risk 3. "5 attacks used" cannot answer "did they do what was asked" — the
  // limit is per-member and varies, so the numerator alone says nothing.
  it("stores each raider's attack limit alongside their attacks used", async () => {
    await runSyncJob("raids", syncRaids, { client });

    const row = await h.db.query<{
      attacks_used: number;
      attack_limit: number;
      bonus_attack_limit: number;
      loot: number;
    }>(`select rp.attacks_used, rp.attack_limit, rp.bonus_attack_limit, rp.loot
          from raid_participants rp
          join players p on p.id = rp.player_id
         where p.tag = '${FIRST_RAIDER.tag}'`);

    expect(row.rows[0]).toMatchObject({
      attacks_used: FIRST_RAIDER.attacks,
      attack_limit: FIRST_RAIDER.attackLimit,
      bonus_attack_limit: FIRST_RAIDER.bonusAttackLimit,
      loot: FIRST_RAIDER.capitalResourcesLooted,
    });

    // The denominator has to actually be there. Deriving both sides from the
    // fixture would otherwise pass with every column null, which is risk 3 in
    // this file's header exactly.
    expect(row.rows[0]!.attack_limit).toBeGreaterThan(0);
  });

  // A raider who joined and left between two runs of sync:clans has no players
  // row. Dropping their participation is the outcome the project exists to
  // prevent, so resolvePlayers creates them — the same argument cwl.ts makes.
  it("creates player rows for raiders sync:clans has never seen", async () => {
    expect(await count(h, "players")).toBe(0);
    await runSyncJob("raids", syncRaids, { client });
    expect(await count(h, "players")).toBe(RAIDER_COUNT);
  });

  // R3. The response is fetched per clan and written under that clan's id;
  // a second clan must not inherit the first one's weekend.
  it("attributes the weekend to the clan it was fetched for", async () => {
    await h.db.exec(`
      truncate raid_participants, raid_seasons, players, clans cascade;
      insert into clans (id, tag, name) values ('${OTHER}', '${OUR_TAG}', 'Other Clan');
    `);

    await runSyncJob("raids", syncRaids, { client });

    const row = await h.db.query<{ clan_id: string }>(`select clan_id from raid_seasons`);
    expect(row.rows[0]!.clan_id).toBe(OTHER);
  });

  // R11 — raids write two tables and nothing else. The sync bypasses RLS
  // entirely, so the boundary in shared.ts's header is asserted here.
  it("never writes the human-decision tables", async () => {
    await h.db.exec(`
      insert into auth.users (id, email)
      values ('dddddddd-0000-4000-8000-00000000d001', 'l@example.com');
      insert into users (id, email, status)
      values ('dddddddd-0000-4000-8000-00000000d001', 'l@example.com', 'approved');
      insert into base_layouts (clan_id, uploaded_by, th_level, layout_type, copy_link)
      values ('${CLAN_A}', 'dddddddd-0000-4000-8000-00000000d001', 16, 'war', 'https://x');
    `);

    await runSyncJob("raids", syncRaids, { client });

    expect(await count(h, "base_layouts")).toBe(1);
    expect(await count(h, "polls")).toBe(0);
    expect(await count(h, "cwl_rosters")).toBe(0);
  });

  describe("R5 — a settled weekend is never rewritten", () => {
    it("running it repeatedly changes nothing", async () => {
      await runSyncJob("raids", syncRaids, { client });
      const before = {
        seasons: await count(h, "raid_seasons"),
        participants: await count(h, "raid_participants"),
        players: await count(h, "players"),
      };

      await runSyncJob("raids", syncRaids, { client });
      await runSyncJob("raids", syncRaids, { client });

      expect({
        seasons: await count(h, "raid_seasons"),
        participants: await count(h, "raid_participants"),
        players: await count(h, "players"),
      }).toEqual(before);
    });

    it("keeps participant ids stable, so nothing was deleted and rewritten", async () => {
      await runSyncJob("raids", syncRaids, { client });
      const first = await h.db.query<{ id: string }>(
        `select id from raid_participants order by loot`,
      );

      await runSyncJob("raids", syncRaids, { client });
      const second = await h.db.query<{ id: string }>(
        `select id from raid_participants order by loot`,
      );

      expect(second.rows).toEqual(first.rows);
    });

    // Risk 1. The API keeps returning a finished weekend for weeks. A later
    // response — corrected, malformed, or simply re-sent — must not be able to
    // rewrite a reward members have already been paid on.
    it("leaves a finished weekend untouched even when the API resends it", async () => {
      await runSyncJob("raids", syncRaids, { client });
      await h.db.exec(
        `update raid_seasons set offensive_reward = 9999, total_loot = 1`,
      );

      const result = await runSyncJob("raids", syncRaids, { client });
      expect(result).toBe("skipped");

      const row = await h.db.query<{ offensive_reward: number; total_loot: number }>(
        `select offensive_reward, total_loot from raid_seasons`,
      );
      expect(row.rows[0]!.offensive_reward).toBe(9999);
      expect(row.rows[0]!.total_loot).toBe(1);
    });

    // Risk 4. Every weekend settled and nothing new is the ordinary midweek
    // state, and R10 says that is a success recorded as `skipped` — not a
    // failure. A job that reports failure four days in seven trains you to
    // ignore it on the day it means something.
    it("records the ordinary midweek nothing-to-do as skipped, not failed", async () => {
      await runSyncJob("raids", syncRaids, { client });
      const result = await runSyncJob("raids", syncRaids, { client });

      expect(result).toBe("skipped");
      const log = await h.db.query<{ status: string; skip_reason: string }>(
        `select status, skip_reason from sync_log
          where job_type = 'raids' order by started_at desc limit 1`,
      );
      expect(log.rows[0]!.status).toBe("skipped");
      expect(log.rows[0]!.skip_reason).toBe("noNewRaids");
    });

    // Risk 2, the opposite error. An ongoing weekend's loot and attacks climb
    // between runs; freezing it would lose everything after the first run.
    it("keeps updating a weekend the API still calls ongoing", async () => {
      await runSyncJob("raids", syncRaids, { client });
      await h.db.exec(
        `update raid_seasons set state = 'ongoing', total_loot = 1`,
      );

      const result = await runSyncJob("raids", syncRaids, { client });
      expect(result).toBe("success");

      // Back to the fixture's own numbers: still writable, and written.
      const row = await h.db.query<{ total_loot: number; state: string }>(
        `select total_loot, state from raid_seasons order by start_time desc`,
      );
      expect(row.rows[0]!.total_loot).not.toBe(1);
      expect(row.rows[0]!.state).toBe(LATEST.state);

      // Re-running must not add a second copy of any weekend (R5).
      expect(await count(h, "raid_seasons")).toBe(SEASON_COUNT);
    });
  });

  describe("R9 — sync_log", () => {
    it("records a success with the rows it wrote", async () => {
      await runSyncJob("raids", syncRaids, { client });
      const log = await h.db.query<{
        status: string;
        records_written: number;
        finished_at: string | null;
      }>(`select status, records_written, finished_at from sync_log
           where job_type = 'raids' order by started_at desc limit 1`);

      const row = log.rows[0]!;
      expect(row.status).toBe("success");
      expect(row.finished_at).not.toBeNull();
      expect(row.records_written).toBe(SEASON_COUNT + RAIDER_COUNT);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The responses the single fixture cannot express. USE_FIXTURES=false with a
  // stubbed fetch is the only way to hand this job different raid history.
  // ───────────────────────────────────────────────────────────────────────────
  describe("the responses a single fixture cannot cover", () => {
    function respondWith(body: unknown, status = 200) {
      process.env.USE_FIXTURES = "false";
      process.env.COC_API_TOKEN = "not-a-real-token";
      process.env.COC_THROTTLE_MS = "0";
      process.env.COC_BACKOFF_MS = "0";
      vi.stubGlobal("fetch", () =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
    }

    // R10 — a clan that has never opened its Clan Capital. Ordinary for a new
    // clan, and it must not colour the run red.
    it("treats a clan with no raid history as ordinary, not failed", async () => {
      respondWith({ items: [] });
      const result = await runSyncJob("raids", syncRaids, { client });

      expect(result).toBe("skipped");
      expect(await count(h, "raid_seasons")).toBe(0);
    });

    it("treats a 404 as no raid history rather than an error", async () => {
      respondWith({ reason: "notFound" }, 404);
      const result = await runSyncJob("raids", syncRaids, { client });

      expect(result).toBe("skipped");
      expect(await count(h, "raid_seasons")).toBe(0);
    });

    // Pinning the CURRENT behaviour, not endorsing it. coc-client.ts:86 treats
    // only `/currentwar` as a war endpoint, so a 403 here is CocAuthError — "the
    // key's registered IP does not match" — rather than war.ts's private-log
    // error, and it fails the run instead of being carried past.
    //
    // Whether the game actually returns 403 here for a private war log is
    // unknown: the fixtures are synthetic (T2.1) and no real 403 from this
    // endpoint has ever been seen. This test is the tripwire — if a capture
    // later shows the private-log case, this assertion fails and points at the
    // one line in coc-client.ts that needs widening. See raids.ts's header.
    it("fails loudly on a 403, reporting the cause it can actually name", async () => {
      respondWith({ reason: "accessDenied" }, 403);
      const result = await runSyncJob("raids", syncRaids, { client });

      expect(result).toBe("failed");
      const log = await h.db.query<{ error: string }>(
        `select error from sync_log where job_type = 'raids'
          order by started_at desc limit 1`,
      );
      expect(log.rows[0]!.error).toContain("registered IP");
      expect(await count(h, "raid_seasons")).toBe(0);
    });

    it("writes several weekends from one response", async () => {
      respondWith({
        items: [
          {
            state: "ended",
            startTime: "20260725T070000.000Z",
            endTime: "20260728T070000.000Z",
            capitalTotalLoot: 100,
            members: [{ tag: "#PY0LQGRJ", name: "One", attacks: 5, attackLimit: 5 }],
          },
          {
            state: "ended",
            startTime: "20260718T070000.000Z",
            endTime: "20260721T070000.000Z",
            capitalTotalLoot: 200,
            members: [{ tag: "#PY0LQGRJ", name: "One", attacks: 6, attackLimit: 6 }],
          },
        ],
      });

      const result = await runSyncJob("raids", syncRaids, { client });

      expect(result).toBe("success");
      expect(await count(h, "raid_seasons")).toBe(2);
      // One player, two weekends — not two player rows.
      expect(await count(h, "players")).toBe(1);
      expect(await count(h, "raid_participants")).toBe(2);
    });

    // A weekend with no members array at all. The season is still worth
    // recording: the rewards and the loot are on it.
    it("records a weekend nobody participated in", async () => {
      respondWith({
        items: [
          {
            state: "ended",
            startTime: "20260725T070000.000Z",
            endTime: "20260728T070000.000Z",
            offensiveReward: 40,
          },
        ],
      });

      const result = await runSyncJob("raids", syncRaids, { client });

      expect(result).toBe("success");
      expect(await count(h, "raid_seasons")).toBe(1);
      expect(await count(h, "raid_participants")).toBe(0);
    });

    // A season the API has not labelled. Treated as finished — the safe
    // direction, since the next run corrects a wrongly-frozen row while a
    // wrongly-live one could be overwritten forever.
    it("treats a weekend with no state as finished", async () => {
      respondWith({
        items: [
          {
            startTime: "20260725T070000.000Z",
            endTime: "20260728T070000.000Z",
            capitalTotalLoot: 100,
          },
        ],
      });

      await runSyncJob("raids", syncRaids, { client });
      const row = await h.db.query<{ state: string | null }>(
        `select state from raid_seasons`,
      );
      expect(row.rows[0]!.state).toBeNull();
    });
  });
});
