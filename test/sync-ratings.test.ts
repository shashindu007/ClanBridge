// T13.10 — the ratings job, from stored rows to player_ratings, through the real
// repositories as the service role.
//
// What this holds:
//
//   1. A PLAYER WHO MOVED CLANS HAS ONE ROW, with both clans' marks in it.
//   2. SHARES ARE OF THE WHOLE FAMILY, not of the player's own clan.
//   3. A RUN IS REPEATABLE, and a departed player leaves the ranking.
//   4. THE 6-HOUR GATE HOLDS, so a half-hourly tick cannot read every clan.
//   5. PAST MONTHS STAY PUT once they are closed.
//   6. A FAILED READ WRITES NOTHING. The month keeps its last good ranking.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { familyRatings } from "@/repositories/player-ratings";
import { monthsToRate, syncRatings } from "../scripts/sync/ratings";
import { runSyncJob } from "../scripts/sync/shared";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000001";

const ANN = "aaaaaaaa-0000-4000-8000-000000000101";
const BEN = "aaaaaaaa-0000-4000-8000-000000000102";
const CAT = "bbbbbbbb-0000-4000-8000-000000000101";

const GAMES_A = "aaaaaaaa-0000-4000-8000-0000000000c9";
const GAMES_B = "bbbbbbbb-0000-4000-8000-0000000000c9";

const NOW = new Date("2026-10-30T12:00:00Z");

/** A reset on 28 Sep, then Ann gives 4,000, Ben 2,000 and takes 2,000, Cat 2,000. */
const SNAPSHOTS = `
  ('${CLAN_A}', '${ANN}', '2026-09-27T12:00:00Z', 9000, 9000),
  ('${CLAN_A}', '${BEN}', '2026-09-27T12:00:00Z', 9000, 9000),
  ('${CLAN_B}', '${CAT}', '2026-09-27T12:00:00Z', 9000, 9000),
  ('${CLAN_A}', '${ANN}', '2026-09-28T06:00:00Z', 0, 0),
  ('${CLAN_A}', '${BEN}', '2026-09-28T06:00:00Z', 0, 0),
  ('${CLAN_B}', '${CAT}', '2026-09-28T06:00:00Z', 0, 0),
  ('${CLAN_A}', '${ANN}', '2026-10-20T06:00:00Z', 4000, 0),
  ('${CLAN_A}', '${BEN}', '2026-10-20T06:00:00Z', 2000, 2000),
  ('${CLAN_B}', '${CAT}', '2026-10-20T06:00:00Z', 2000, 0)
`;

describe("the Player rating job", () => {
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
      truncate feedback, notifications, player_ratings, clan_games_scores, clan_games,
               member_snapshots, players, sync_log, users, clans cascade;
      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');
      insert into players (id, clan_id, tag, name) values
        ('${ANN}', '${CLAN_A}', '#PYLQ0GR', 'Ann'),
        ('${BEN}', '${CLAN_A}', '#PYLQ2GR', 'Ben'),
        ('${CAT}', '${CLAN_B}', '#PYLQ8GR', 'Cat');

      insert into member_snapshots (clan_id, player_id, captured_at, donations, donations_received)
        values ${SNAPSHOTS};

      -- Ann 8,000 in A and 2,000 in B after a move; Cat 10,000 in B.
      insert into clan_games (id, clan_id, season, start_time, end_time, settled_at) values
        ('${GAMES_A}', '${CLAN_A}', '2026-10', '2026-10-22T08:00:00Z', '2026-10-28T08:00:00Z', '2026-10-28T08:41:00Z'),
        ('${GAMES_B}', '${CLAN_B}', '2026-10', '2026-10-22T08:00:00Z', '2026-10-28T08:00:00Z', '2026-10-28T08:41:00Z');
      insert into clan_games_scores (clan_games_id, player_id, start_value, end_value, points) values
        ('${GAMES_A}', '${ANN}', 0, 8000, 8000),
        ('${GAMES_B}', '${ANN}', 8000, 10000, 2000),
        ('${GAMES_B}', '${CAT}', 0, 10000, 10000);
    `);
    await h.asServiceRole();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const run = (now = NOW, options: { force?: boolean } = {}) =>
    runSyncJob("ratings", (ctx) => syncRatings(ctx, now, options), { client });

  /** A real run stamps the real clock, so the gate is tested by moving the stamp. */
  const lastRunWas = async (hoursAgo: number) => {
    await h.asSuperuser();
    await h.db.exec(
      `update sync_log set started_at = '${new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString()}'
        where job_type = 'ratings'`,
    );
    await h.asServiceRole();
  };

  const count = async (where = "true") => {
    await h.asSuperuser();
    const res = await h.db.query<{ n: number }>(
      `select count(*)::int as n from player_ratings where ${where}`,
    );
    await h.asServiceRole();
    return res.rows[0]!.n;
  };

  it("adds a moved player's marks from both clans into one row (1)", async () => {
    expect(await run()).toBe("success");

    const rows = await familyRatings(client, "2026-10");
    expect(rows.filter((r) => r.name === "Ann")).toHaveLength(1);
    expect(rows.find((r) => r.name === "Ann")!.marks.games).toBe(10);
  });

  it("takes shares of the whole family, across clans (2)", async () => {
    await run();
    const rows = await familyRatings(client, "2026-10");
    const of = (name: string) => rows.find((r) => r.name === name)!;

    expect(of("Ann").marks.donations).toBe(4);
    expect(of("Ben").marks.donations).toBe(1);
    expect(of("Cat").marks.donations).toBe(2);

    expect(of("Ann").shares.donations).toBeCloseTo((4 / 7) * 100, 2);
    expect(of("Ann").shares.games).toBe(50);
    expect(of("Cat").shares.games).toBe(50);
    expect(rows.reduce((t, r) => t + r.shares.donations, 0)).toBeCloseTo(100, 1);
  });

  it("works the rating out from the shares, by the agreed weights (2)", async () => {
    await run();
    const ann = (await familyRatings(client, "2026-10")).find((r) => r.name === "Ann")!;
    expect(ann.rating).toBeCloseTo(0.2 * (4 / 7) * 100 + 0.1 * 50, 2);
  });

  it("gives the same ranking on a second run (3)", async () => {
    await run();
    const first = await familyRatings(client, "2026-10");

    await lastRunWas(7);
    await run();
    const second = await familyRatings(client, "2026-10");

    expect(second.map((r) => [r.name, r.rating])).toEqual(first.map((r) => [r.name, r.rating]));
  });

  it("drops a departed player from the running month, and keeps their row (3)", async () => {
    await run();

    await h.asSuperuser();
    await h.db.exec(`update players set left_at = now() where id = '${BEN}'`);
    await h.asServiceRole();
    await lastRunWas(7);
    await run(new Date(NOW.getTime() + 1_000));

    const rows = await familyRatings(client, "2026-10");
    expect(rows.map((r) => r.name).sort()).toEqual(["Ann", "Cat"]);
    expect(rows.find((r) => r.name === "Ann")!.shares.donations).toBeCloseTo((4 / 6) * 100, 2);
    expect(await count(`player_id = '${BEN}'`)).toBe(1);
  });

  it("skips a run within 6 hours of the last, and runs after them (4)", async () => {
    await run();
    await lastRunWas(1);

    const fetchRows = vi.spyOn(client, "from");
    expect(await run()).toBe("skipped");
    expect(fetchRows.mock.calls.map(([table]) => table)).not.toContain("players");
    fetchRows.mockRestore();

    await h.asSuperuser();
    const log = await h.db.query<{ skip_reason: string }>(
      `select skip_reason from sync_log where status = 'skipped'`,
    );
    await h.asServiceRole();
    expect(log.rows).toEqual([{ skip_reason: "ratingsFresh" }]);

    await lastRunWas(7);
    expect(await run()).toBe("success");
  });

  it("does not count a failed run as fresh (4)", async () => {
    await h.asSuperuser();
    await h.db.exec(
      `insert into sync_log (job_type, status, started_at) values ('ratings', 'failed', '${NOW.toISOString()}')`,
    );
    await h.asServiceRole();

    expect(await run()).toBe("success");
  });

  it("runs inside the gate when forced, for the first fill (4)", async () => {
    await run();
    await lastRunWas(1);
    expect(await run(NOW, { force: true })).toBe("success");
  });

  it("writes nothing for a month with no marks, or none it can rate", async () => {
    await run();
    // September's season began before these readings, so its donations are partial.
    expect(await count(`month = '2026-09'`)).toBe(0);
    expect(await count(`month = '2026-08'`)).toBe(0);
  });

  it("stores nothing and fails the job when a read fails (6)", async () => {
    await run();
    const before = await familyRatings(client, "2026-10");

    await h.asSuperuser();
    await h.db.exec(`alter table clan_games rename to clan_games_hidden`);
    await h.asServiceRole();

    try {
      await lastRunWas(7);
      expect(await run()).toBe("failed");
      expect(await familyRatings(client, "2026-10")).toEqual(before);
    } finally {
      await h.asSuperuser();
      await h.db.exec(`alter table clan_games_hidden rename to clan_games`);
      await h.asServiceRole();
    }
  });
});

describe("monthsToRate (5)", () => {
  const stored = ["2026-08", "2026-09", "2026-10"];

  it("keeps last month open until the 10th", () => {
    expect(monthsToRate(stored, new Date("2026-11-01T00:30:00Z"))).toEqual(["2026-10", "2026-11"]);
    expect(monthsToRate(stored, new Date("2026-11-10T23:00:00Z"))).toEqual(["2026-10", "2026-11"]);
  });

  it("closes it after that, so a player's number for it stays put", () => {
    expect(monthsToRate(stored, new Date("2026-11-11T00:30:00Z"))).toEqual(["2026-11"]);
  });

  it("reworks every month the readings cover when forced, ranked or not", () => {
    expect(monthsToRate(stored, new Date("2026-11-11T00:30:00Z"), true)).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
  });

  it("fills in a month the readings still cover and nothing has ranked", () => {
    expect(monthsToRate(["2026-10"], new Date("2026-10-30T12:00:00Z"))).toEqual([
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
  });

  it("crosses a year", () => {
    expect(monthsToRate(["2026-10", "2026-11", "2026-12"], new Date("2027-01-05T12:00:00Z"))).toEqual([
      "2026-12",
      "2027-01",
    ]);
  });
});
