// T7.4 — Clan Games scoring, end to end against real Postgres.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS TEST CANNOT USE THE FIXTURE PATH
//
// Every other sync test in this repo runs with USE_FIXTURES=true. This one
// cannot: coc-client.ts maps EVERY `/players/{tag}` call to the single
// fixtures/player.json, so fifty members would return fifty identical responses
// carrying one tag and one Games Champion value. Every difference would be zero
// and only one player would resolve — the test would pass while proving nothing
// about the one calculation the job exists to perform.
//
// So `fetch` is stubbed per tag, which is also the only way to hand the job two
// DIFFERENT readings six days apart.
// ─────────────────────────────────────────────────────────────────────────────
//
// The ways this job can be confidently wrong, none of which raises an error:
//
//   1. taking the start snapshot twice, overwriting the opening value with one
//      read after members had already scored — every score short by the
//      difference, both numbers plausible
//   2. re-running the end pass in a later month, writing that month's lifetime
//      total into a settled season's end_value
//   3. scoring a member who joined mid-period against their LIFETIME total,
//      crediting them with every point they have ever earned, in one month
//   4. reporting "outside the games period" as a failure — the state for three
//      weeks in four

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { runSyncJob } from "../scripts/sync/shared";
import { syncClanGames } from "../scripts/sync/clan-games";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const P1 = "aaaaaaaa-0000-4000-8000-00000000f001";
const P2 = "aaaaaaaa-0000-4000-8000-00000000f002";

/** Inside the start window, and inside the end window, of the same season. */
const START_DAY = new Date("2026-08-22T09:00:00Z");
const END_DAY = new Date("2026-08-28T09:00:00Z");
const MIDWEEK = new Date("2026-08-10T09:00:00Z");

async function count(h: Harness, table: string, where = "true"): Promise<number> {
  const res = await h.db.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
  );
  return res.rows[0]!.n;
}

/**
 * A `fetch` that answers `/players/{tag}` with that tag's own Games Champion
 * value. The whole point: two readings, taken days apart, that differ.
 */
function respondWithValues(values: Record<string, number | null>) {
  process.env.USE_FIXTURES = "false";
  process.env.COC_API_TOKEN = "not-a-real-token";
  process.env.COC_THROTTLE_MS = "0";
  process.env.COC_BACKOFF_MS = "0";

  vi.stubGlobal("fetch", (url: string) => {
    // `/players/%23P1` — the tag is percent-encoded by lib/tags.ts.
    const tag = decodeURIComponent(String(url).split("/players/")[1] ?? "");
    if (!(tag in values)) {
      return Promise.resolve(
        new Response(JSON.stringify({ reason: "notFound" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
    }

    const value = values[tag];
    return Promise.resolve(
      new Response(
        JSON.stringify({
          tag,
          name: `Player ${tag}`,
          // null means the player has no Games Champion achievement at all.
          achievements: value === null ? [] : [{ name: "Games Champion", value }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });
}

describe("T7.4 — Clan Games scoring", () => {
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
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await h.asSuperuser();
    await h.db.exec(`
      truncate feedback, notifications, clan_games_scores, clan_games,
               member_snapshots, players, sync_log, users, clans cascade;
      delete from auth.users;
      insert into clans (id, tag, name) values ('${CLAN_A}', '#2PP0JCCL', 'Synthetic Clan');
      insert into players (id, clan_id, tag, name) values
        ('${P1}', '${CLAN_A}', '#PY0LQGRJ', 'One'),
        ('${P2}', '${CLAN_A}', '#PY0LQGRC', 'Two');
    `);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const run = (now: Date) => runSyncJob("clan-games", (ctx) => syncClanGames(ctx, now), { client });

  // Risk 4. Three weeks in four this is the entire job, and R10 says it is a
  // success recorded as skipped. It also exits BEFORE activeClans and before a
  // single API call — which matters, because the alternative is 150 requests a
  // day to discover there is nothing to do.
  describe("outside the games period", () => {
    it("skips without touching the API", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const result = await run(MIDWEEK);

      expect(result).toBe("skipped");
      expect(fetchSpy).not.toHaveBeenCalled();
      const log = await h.db.query<{ skip_reason: string }>(
        `select skip_reason from sync_log order by started_at desc limit 1`,
      );
      expect(log.rows[0]!.skip_reason).toBe("notClanGames");
    });

    it("writes no season row for a month it never ran in", async () => {
      vi.stubGlobal("fetch", vi.fn());
      await run(MIDWEEK);
      expect(await count(h, "clan_games")).toBe(0);
    });
  });

  describe("the start snapshot", () => {
    it("records each member's opening value and no score yet", async () => {
      respondWithValues({ "#PY0LQGRJ": 21_000, "#PY0LQGRC": 15_000 });
      const result = await run(START_DAY);

      expect(result).toBe("success");
      expect(await count(h, "clan_games")).toBe(1);
      expect(await count(h, "clan_games_scores")).toBe(2);

      const rows = await h.db.query<{
        start_value: number;
        end_value: number | null;
        points: number | null;
      }>(`select start_value, end_value, points from clan_games_scores
           where player_id = '${P1}'`);

      expect(rows.rows[0]).toMatchObject({ start_value: 21_000, end_value: null, points: null });
    });

    it("derives the season and the window from the calendar", async () => {
      respondWithValues({ "#PY0LQGRJ": 1, "#PY0LQGRC": 1 });
      await run(START_DAY);

      const row = await h.db.query<{
        season: string;
        start_time: string;
        end_time: string;
        settled_at: string | null;
      }>(`select season, start_time, end_time, settled_at from clan_games`);

      expect(row.rows[0]!.season).toBe("2026-08");
      expect(new Date(row.rows[0]!.start_time).toISOString()).toBe("2026-08-22T08:00:00.000Z");
      expect(new Date(row.rows[0]!.end_time).toISOString()).toBe("2026-08-28T08:00:00.000Z");
      // Not settled — the period has only just opened.
      expect(row.rows[0]!.settled_at).toBeNull();
    });

    // RISK 1, AND THE MOST DANGEROUS CASE IN THIS FILE.
    //
    // The start window is a day wide on purpose (GitHub delays scheduled runs),
    // so two runs inside it are expected. If the second overwrote the first,
    // every score for the month would come out short by exactly the points
    // earned in between — and nothing would report it, because both readings
    // are perfectly plausible numbers.
    it("does NOT overwrite the opening value on a second run the same day", async () => {
      respondWithValues({ "#PY0LQGRJ": 21_000, "#PY0LQGRC": 15_000 });
      await run(START_DAY);

      // Six hours later, P1 has already scored 400 points.
      respondWithValues({ "#PY0LQGRJ": 21_400, "#PY0LQGRC": 15_000 });
      await run(new Date("2026-08-22T15:00:00Z"));

      const row = await h.db.query<{ start_value: number }>(
        `select start_value from clan_games_scores where player_id = '${P1}'`,
      );
      expect(row.rows[0]!.start_value).toBe(21_000);
      expect(await count(h, "clan_games_scores")).toBe(2);
    });

    // mapPlayer leaves the value undefined rather than defaulting to 0, and a 0
    // here would read as a real opening reading — producing a score equal to the
    // member's entire lifetime total at the end of the period.
    it("skips a member with no Games Champion achievement rather than storing zero", async () => {
      respondWithValues({ "#PY0LQGRJ": 21_000, "#PY0LQGRC": null });
      await run(START_DAY);

      expect(await count(h, "clan_games_scores")).toBe(1);
      expect(await count(h, "clan_games_scores", `player_id = '${P2}'`)).toBe(0);
    });

    // One member who left the game must not cost the other forty-nine their
    // opening reading — and their reading is the one thing that cannot be
    // taken later.
    it("carries past a member the API has never heard of", async () => {
      respondWithValues({ "#PY0LQGRJ": 21_000 }); // #PY0LQGRC → 404
      const result = await run(START_DAY);

      expect(result).toBe("success");
      expect(await count(h, "clan_games_scores")).toBe(1);
    });
  });

  describe("the end snapshot", () => {
    async function withStart(values: Record<string, number | null>) {
      respondWithValues(values);
      await run(START_DAY);
    }

    it("scores the difference, not the lifetime total", async () => {
      await withStart({ "#PY0LQGRJ": 21_000, "#PY0LQGRC": 15_000 });

      respondWithValues({ "#PY0LQGRJ": 23_500, "#PY0LQGRC": 15_000 });
      const result = await run(END_DAY);

      expect(result).toBe("success");

      const rows = await h.db.query<{ player_id: string; points: number; end_value: number }>(
        `select player_id, points, end_value from clan_games_scores order by points desc`,
      );
      expect(rows.rows[0]).toMatchObject({ player_id: P1, points: 2_500, end_value: 23_500 });
      // Someone who scored nothing is a zero, not an absence — the distinction
      // the page needs to say "did not participate" rather than showing a gap.
      expect(rows.rows[1]).toMatchObject({ player_id: P2, points: 0 });
    });

    it("settles the season", async () => {
      await withStart({ "#PY0LQGRJ": 21_000, "#PY0LQGRC": 15_000 });
      respondWithValues({ "#PY0LQGRJ": 23_500, "#PY0LQGRC": 15_000 });
      await run(END_DAY);

      const row = await h.db.query<{ settled_at: string | null }>(
        `select settled_at from clan_games`,
      );
      expect(row.rows[0]!.settled_at).not.toBeNull();
    });

    // RISK 3. They have no opening reading, so their difference is unknowable.
    // Defaulting the start to zero would score them their entire lifetime total
    // in one month and put them top of the leaderboard, permanently, with a
    // number nobody can explain.
    it("leaves out a member who joined mid-period rather than scoring their lifetime", async () => {
      await withStart({ "#PY0LQGRJ": 21_000 }); // P2 was not in the clan yet

      respondWithValues({ "#PY0LQGRJ": 23_500, "#PY0LQGRC": 800_000 });
      await run(END_DAY);

      expect(await count(h, "clan_games_scores")).toBe(1);
      expect(await count(h, "clan_games_scores", `player_id = '${P2}'`)).toBe(0);
    });

    // The achievement is a lifetime total and cannot fall, so a negative means
    // one of the two readings is wrong. A negative on a leaderboard sends the
    // reader hunting for a scoring rule that does not exist.
    it("clamps a nonsensical negative difference to zero", async () => {
      await withStart({ "#PY0LQGRJ": 21_000, "#PY0LQGRC": 15_000 });

      respondWithValues({ "#PY0LQGRJ": 20_000, "#PY0LQGRC": 15_000 });
      await run(END_DAY);

      const row = await h.db.query<{ points: number }>(
        `select points from clan_games_scores where player_id = '${P1}'`,
      );
      expect(row.rows[0]!.points).toBe(0);
    });
  });

  // RISK 2, and what 027's settled_at column exists for. A run in a later month
  // would otherwise write that month's lifetime total into a settled season's
  // end_value and turn a real score into a wrong one — silently, because
  // overwriting is exactly what this job does the rest of the time.
  describe("R5 — a settled season is never rewritten", () => {
    async function settledSeason() {
      respondWithValues({ "#PY0LQGRJ": 21_000, "#PY0LQGRC": 15_000 });
      await run(START_DAY);
      respondWithValues({ "#PY0LQGRJ": 23_500, "#PY0LQGRC": 15_000 });
      await run(END_DAY);
    }

    it("refuses a second end pass in the same month", async () => {
      await settledSeason();

      respondWithValues({ "#PY0LQGRJ": 99_999, "#PY0LQGRC": 99_999 });
      const result = await run(new Date("2026-08-29T09:00:00Z"));

      expect(result).toBe("skipped");
      const row = await h.db.query<{ points: number; end_value: number }>(
        `select points, end_value from clan_games_scores where player_id = '${P1}'`,
      );
      expect(row.rows[0]).toMatchObject({ points: 2_500, end_value: 23_500 });
    });

    it("leaves last month alone when a new month opens", async () => {
      await settledSeason();

      // September's start day. A new season, and August must not move.
      respondWithValues({ "#PY0LQGRJ": 30_000, "#PY0LQGRC": 20_000 });
      const result = await run(new Date("2026-09-22T09:00:00Z"));

      expect(result).toBe("success");
      expect(await count(h, "clan_games")).toBe(2);

      const august = await h.db.query<{ points: number }>(
        `select s.points from clan_games_scores s
           join clan_games g on g.id = s.clan_games_id
          where g.season = '2026-08' and s.player_id = '${P1}'`,
      );
      expect(august.rows[0]!.points).toBe(2_500);

      const september = await h.db.query<{ start_value: number }>(
        `select s.start_value from clan_games_scores s
           join clan_games g on g.id = s.clan_games_id
          where g.season = '2026-09' and s.player_id = '${P1}'`,
      );
      expect(september.rows[0]!.start_value).toBe(30_000);
    });
  });

  describe("R9 and R11", () => {
    it("records the run in sync_log with the rows it wrote", async () => {
      respondWithValues({ "#PY0LQGRJ": 21_000, "#PY0LQGRC": 15_000 });
      await run(START_DAY);

      const log = await h.db.query<{
        status: string;
        records_written: number;
        finished_at: string | null;
      }>(`select status, records_written, finished_at from sync_log
           where job_type = 'clan-games' order by started_at desc limit 1`);

      expect(log.rows[0]).toMatchObject({ status: "success", records_written: 2 });
      expect(log.rows[0]!.finished_at).not.toBeNull();
    });

    it("never writes the human-decision tables", async () => {
      respondWithValues({ "#PY0LQGRJ": 21_000, "#PY0LQGRC": 15_000 });
      await run(START_DAY);

      expect(await count(h, "polls")).toBe(0);
      expect(await count(h, "cwl_rosters")).toBe(0);
      expect(await count(h, "base_layouts")).toBe(0);
    });

    // R3 — membersOf filters by clan, so a second clan's members are not
    // snapshotted against the first clan's season.
    it("keeps each clan's season and scores to itself", async () => {
      const CLAN_B = "aaaaaaaa-0000-4000-8000-000000000002";
      const P3 = "aaaaaaaa-0000-4000-8000-00000000f003";
      await h.db.exec(`
        insert into clans (id, tag, name) values ('${CLAN_B}', '#8QUCLJY0', 'Other');
        insert into players (id, clan_id, tag, name) values ('${P3}', '${CLAN_B}', '#PY0LQGRU', 'Three');
      `);

      respondWithValues({ "#PY0LQGRJ": 21_000, "#PY0LQGRC": 15_000, "#PY0LQGRU": 9_000 });
      await run(START_DAY);

      expect(await count(h, "clan_games")).toBe(2);

      const a = await h.db.query<{ n: number }>(
        `select count(*)::int as n from clan_games_scores s
           join clan_games g on g.id = s.clan_games_id
          where g.clan_id = '${CLAN_A}'`,
      );
      expect(a.rows[0]!.n).toBe(2);
    });

    it("skips cleanly when no clan is seeded", async () => {
      await h.db.exec(`truncate players, clans cascade`);
      vi.stubGlobal("fetch", vi.fn());

      const result = await run(START_DAY);

      expect(result).toBe("skipped");
      const log = await h.db.query<{ skip_reason: string }>(
        `select skip_reason from sync_log order by started_at desc limit 1`,
      );
      expect(log.rows[0]!.skip_reason).toBe("noClansSeeded");
    });
  });
});
