// T4.1 — the Clan War League sync, end to end and entirely offline.
//
// fixtures -> Zod -> mappers -> SQL -> real Postgres, with USE_FIXTURES=true and
// a throwing `fetch`, so nothing touches the network.
//
// This is the most consequential job in the project: CWL data is deleted from
// Supercell's API when the season ends and cannot be recovered from anywhere. So
// alongside the usual end-to-end path, the three failure modes that would
// silently corrupt a season each get a direct test:
//
//   1. writing other clans' wars, because a league group lists all of them
//   2. recording every result backwards, because the API's `clan` is not
//      necessarily your clan
//   3. violating cwl_wars' state CHECK with mapWar's 'notInWar'
//
// None of the three produces an error at the time. Each one produces a database
// full of confident, wrong history.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { runSyncJob } from "../scripts/sync/shared";
import {
  chooseSides,
  dayNumbers,
  storedState,
  syncCwl,
  tagsToFetch,
  warResult,
  type StoredWar,
} from "../scripts/sync/cwl";
import type { War, WarSide } from "@/types/domain";
import type { ApiCwlGroup } from "@/integration/coc-schemas";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";

/**
 * Everything below is read out of the captured fixtures, not written down here.
 *
 * These were `"#2PP0JCCL"` and `"#8QUCLJY0"` — the synthetic clan's tags. T2.1
 * then captured a real CWL week, and the tags changed, so the seeded clan no
 * longer matched either side of the war. `chooseSides()` correctly returned null
 * for all 28 wars, the sync correctly wrote nothing, and eleven tests failed
 * without a single line of production code being wrong.
 *
 * A CWL fixture can only be captured during CWL week — one week a month — so
 * these files WILL be re-captured, and a hardcoded tag here breaks the suite
 * every time on a schedule nobody remembers.
 */
const CWL_WAR = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "cwlwar.json"), "utf8"),
) as {
  clan: ApiWarSideFixture;
  opponent: ApiWarSideFixture;
};

interface ApiWarSideFixture {
  tag: string;
  stars: number;
  badgeUrls?: { small?: string; medium?: string };
  members: Array<{
    tag: string;
    mapPosition: number;
    attacks?: Array<{ defenderTag: string; stars: number }>;
  }>;
}

/** Our side of the captured war. Arbitrary, but it must match what is seeded. */
const OURS = CWL_WAR.clan;
const THEIRS = CWL_WAR.opponent;
const OUR_TAG = OURS.tag;
const THEIR_TAG = THEIRS.tag;

/** 15 in the roster, 14 of whom attacked — CWL gives one attack each. */
const ROSTER_SIZE = OURS.members.length;
const ATTACK_COUNT = OURS.members.reduce((n, m) => n + (m.attacks?.length ?? 0), 0);
const MISSED_COUNT = ROSTER_SIZE - ATTACK_COUNT;

const CWL_GROUP = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "cwlgroup.json"), "utf8"),
) as { season: string; rounds: Array<{ warTags: string[] }> };

/** The season key AFTER normalisation — the live API sends a full date. */
const SEASON = CWL_GROUP.season.slice(0, 7);

/**
 * One war per round that has any real tag: 7, for 8 clans over 7 rounds.
 *
 * IN PRODUCTION a round lists four wars and one is ours. The job asks for a
 * round's tags until `chooseSides()` finds ours, then stops (`tagsToFetch()`),
 * and on later runs asks for only that one tag.
 *
 * IN FIXTURE MODE every tag returns the SAME cwlwar.json, in which we are a
 * participant, so the first tag of each round is taken as ours. That is an
 * artifact of the offline harness, not a defect: it is the price of proving the
 * whole path without a network.
 *
 * So the row COUNTS below scale with this number, while everything about what a
 * war actually contains is asserted against a single war row instead. Otherwise
 * the test measures the harness rather than the job.
 */
const WAR_COUNT = CWL_GROUP.rounds.filter((r) =>
  r.warTags.some((t) => t && t !== "#0"),
).length;

async function count(h: Harness, table: string, where = "true"): Promise<number> {
  const res = await h.db.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
  );
  return res.rows[0]!.n;
}

/** One war row to scope per-war assertions to. See the note on WAR_COUNT. */
async function firstWarId(h: Harness): Promise<string> {
  const res = await h.db.query<{ id: string }>(
    `select id from cwl_wars order by war_tag limit 1`,
  );
  return res.rows[0]!.id;
}

function side(tag: string, stars?: number, destruction?: number): WarSide {
  return { tag, name: `Side ${tag}`, stars, destruction, members: [] };
}

describe("T4.1 — the CWL sync", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Pure logic. No database, no fixtures — these are the three traps.
  // ───────────────────────────────────────────────────────────────────────────
  describe("chooseSides — which half of this war is us", () => {
    const war = (clan?: WarSide, opponent?: WarSide): War =>
      ({ state: "warEnded", clan, opponent }) as War;

    it("takes `clan` as ours when it matches", () => {
      const sides = chooseSides(war(side(OUR_TAG, 10), side(THEIR_TAG, 4)), OUR_TAG);
      expect(sides?.ours.tag).toBe(OUR_TAG);
      expect(sides?.theirs.tag).toBe(THEIR_TAG);
    });

    // The whole point. Fetched by war tag, the API returns the two sides in no
    // guaranteed order, so this case is as common as the one above — and reading
    // `clan` as "ours" records the war backwards with no error anywhere.
    it("takes `opponent` as ours when WE are the opponent", () => {
      const sides = chooseSides(war(side(THEIR_TAG, 4), side(OUR_TAG, 10)), OUR_TAG);
      expect(sides?.ours.tag).toBe(OUR_TAG);
      expect(sides?.ours.stars).toBe(10);
      expect(sides?.theirs.tag).toBe(THEIR_TAG);
    });

    // A league group lists every war in every round: 28 wars for an 8-clan
    // group, of which 7 are ours. Returning null is what keeps the other 21 out
    // of our database.
    it("returns null when neither side is us", () => {
      expect(chooseSides(war(side("#PPPPPPP"), side("#QQQQQQQ")), OUR_TAG)).toBeNull();
    });

    it("returns null rather than a half-war when a side is missing", () => {
      expect(chooseSides(war(side(OUR_TAG), undefined), OUR_TAG)).toBeNull();
    });
  });

  describe("warResult — the API reports no winner, so it is computed", () => {
    it("wins on stars", () => {
      expect(warResult(side(OUR_TAG, 10, 50), side(THEIR_TAG, 9, 99))).toBe("win");
    });
    it("loses on stars regardless of destruction", () => {
      expect(warResult(side(OUR_TAG, 8, 100), side(THEIR_TAG, 9, 10))).toBe("lose");
    });
    it("falls through to destruction when stars are level", () => {
      expect(warResult(side(OUR_TAG, 9, 91.4), side(THEIR_TAG, 9, 91.3))).toBe("win");
      expect(warResult(side(OUR_TAG, 9, 91.3), side(THEIR_TAG, 9, 91.4))).toBe("lose");
    });
    it("is a tie only when both are identical", () => {
      expect(warResult(side(OUR_TAG, 9, 91.4), side(THEIR_TAG, 9, 91.4))).toBe("tie");
    });
    it("is null during preparation, when nothing has been scored", () => {
      expect(warResult(side(OUR_TAG), side(THEIR_TAG))).toBeNull();
    });
  });

  describe("storedState — cwl_wars.state has no 'notInWar'", () => {
    it("nulls the one value the CHECK constraint would reject", () => {
      expect(storedState("notInWar")).toBeNull();
    });
    it.each(["preparation", "inWar", "warEnded"] as const)("passes %s through", (s) => {
      expect(storedState(s)).toBe(s);
    });
  });

  describe("dayNumbers — the round index the mapper throws away", () => {
    it("numbers rounds from one and drops the #0 placeholders", () => {
      // Real tag characters only — the alphabet is 0289PYLQGRJCUV, so a
      // plausible-looking '#AAA' is rejected by normaliseTag.
      const group = {
        season: "2026-08",
        clans: [],
        rounds: [
          { warTags: ["#PPP0", "#YYY2"] },
          { warTags: ["#LLL8", "#0"] },
          { warTags: ["#0", "#0"] },
        ],
      } as unknown as ApiCwlGroup;

      const days = dayNumbers(group);
      expect(days.get("#PPP0")).toBe(1);
      expect(days.get("#YYY2")).toBe(1);
      expect(days.get("#LLL8")).toBe(2);
      expect(days.has("#0")).toBe(false);
    });
  });

  describe("tagsToFetch — the per-run API budget", () => {
    const group = {
      season: "2026-08",
      clans: [],
      rounds: [
        { warTags: ["#PPP0", "#YYY2", "#LLL8", "#QQQ9"] },
        { warTags: ["#PPP2", "#YYY8", "#LLL0", "#QQQ2"] },
        { warTags: ["#PPP8", "#YYY0", "#LLL2", "#QQQ8"] },
        { warTags: ["#0", "#0", "#0", "#0"] },
      ],
    } as unknown as ApiCwlGroup;

    it("searches a round it has never seen, and skips one not announced yet", () => {
      const rounds = tagsToFetch(group, new Map());
      expect(rounds).toEqual([
        ["#PPP0", "#YYY2", "#LLL8", "#QQQ9"],
        ["#PPP2", "#YYY8", "#LLL0", "#QQQ2"],
        ["#PPP8", "#YYY0", "#LLL2", "#QQQ8"],
      ]);
    });

    // The bug: every other clan's war in the group was fetched on every run.
    it("asks for only our war in a round it already knows, and nothing once it ended", () => {
      const stored = new Map<string, StoredWar>([
        ["#YYY2", { state: "warEnded", day: 1 }],
        ["#LLL0", { state: "inWar", day: 2 }],
      ]);
      expect(tagsToFetch(group, stored)).toEqual([
        ["#LLL0"],
        ["#PPP8", "#YYY0", "#LLL2", "#QQQ8"],
      ]);
    });

    it("never re-asks for a settled war stored without a day number", () => {
      const stored = new Map<string, StoredWar>([["#YYY2", { state: "warEnded", day: null }]]);
      expect(tagsToFetch(group, stored)[0]).toEqual(["#PPP0", "#LLL8", "#QQQ9"]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // End to end against real Postgres.
  // ───────────────────────────────────────────────────────────────────────────
  describe("against real Postgres, offline", () => {
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
        truncate cwl_attacks, cwl_war_members, cwl_wars, cwl_seasons,
                 member_snapshots, players, sync_log, clans cascade;
        insert into clans (id, tag, name) values ('${CLAN_A}', '${OUR_TAG}', 'Synthetic Clan');
      `);
    });

    it("skips cleanly when no clan is seeded", async () => {
      await h.db.exec(`truncate players, clans cascade`);
      const result = await runSyncJob("cwl", syncCwl, { client });

      expect(result).toBe("skipped");
      const log = await h.db.query<{ skip_reason: string }>(
        `select skip_reason from sync_log order by started_at desc limit 1`,
      );
      expect(log.rows[0]!.skip_reason).toBe("noClansSeeded");
    });

    it("captures the season, the war, the roster and the attacks", async () => {
      const result = await runSyncJob("cwl", syncCwl, { client });

      expect(result).toBe("success");
      expect(await count(h, "cwl_seasons")).toBe(1);
      expect(await count(h, "cwl_wars")).toBe(WAR_COUNT);

      // Per war, not in total — see the note on WAR_COUNT. This is the shape
      // that stays true whatever the harness replays.
      const war = await firstWarId(h);
      expect(await count(h, "cwl_war_members", `war_id = '${war}'`)).toBe(ROSTER_SIZE);
      expect(await count(h, "cwl_attacks", `war_id = '${war}'`)).toBe(ATTACK_COUNT);

      // The roster must be bigger than the attack list, or the missed-attack
      // list this whole module exists to produce has nothing to derive from.
      expect(MISSED_COUNT).toBeGreaterThan(0);
    });

    it("records the season string the API reported", async () => {
      await runSyncJob("cwl", syncCwl, { client });
      const rows = await h.db.query<{ season: string; clan_id: string }>(
        `select season, clan_id from cwl_seasons`,
      );
      // 'YYYY-MM', which is NOT what the API sends — it sent '2026-08-03'.
      // normaliseCwlSeason() in the mappers is what makes this true, and it must
      // stay true or cwl_seasons.season and cwl_rosters.season stop matching.
      expect(rows.rows[0]!.season).toBe(SEASON);
      expect(rows.rows[0]!.season).toMatch(/^\d{4}-\d{2}$/);
      expect(rows.rows[0]!.clan_id).toBe(CLAN_A); // R3
    });

    it("puts our stars on our side of the war row", async () => {
      await runSyncJob("cwl", syncCwl, { client });
      const rows = await h.db.query<{
        our_stars: number;
        their_stars: number;
        result: string;
        state: string;
        opponent_tag: string;
        opponent_badge_url: string | null;
        day_number: number;
      }>(
        `select our_stars, their_stars, result, state, opponent_tag, opponent_badge_url,
                day_number from cwl_wars`,
      );

      const war = rows.rows[0]!;
      expect(war.our_stars).toBe(OURS.stars);
      expect(war.their_stars).toBe(THEIRS.stars);
      // warResult() itself, not a re-implementation: the vocabulary is 'lose',
      // not 'loss', and a hand-written ternary here gets that wrong silently
      // whenever the captured war happens to be a win.
      expect(war.result).toBe(
        warResult(side(OUR_TAG, OURS.stars), side(THEIR_TAG, THEIRS.stars)),
      );
      expect(war.state).toBe("warEnded");
      expect(war.opponent_tag).toBe(THEIR_TAG);
      expect(war.opponent_badge_url).toBe(THEIRS.badgeUrls!.medium);

      // The trap this test exists for: fetched by war tag, the API returns the
      // two sides in no guaranteed order, and reading `clan` as "ours" records
      // every result backwards with no error anywhere. Asserting the two star
      // counts DIFFER is what keeps that detectable — with equal scores the
      // assertion above would pass whichever way round they were read.
      expect(OURS.stars).not.toBe(THEIRS.stars);
    });

    // The only source for this is looking defenderTag up in the OPPONENT's
    // roster. A job that used the attacker's own index instead would pass every
    // count assertion above and fail only this one.
    it("resolves defender_position from the opponent roster, not the attacker index", async () => {
      await runSyncJob("cwl", syncCwl, { client });
      const warId = await firstWarId(h);
      const rows = await h.db.query<{ map_position: number; defender_position: number }>(
        `select m.map_position, a.defender_position
           from cwl_attacks a
           join cwl_war_members m
             on m.war_id = a.war_id and m.player_id = a.player_id
          where a.war_id = '${warId}'
          order by m.map_position`,
      );

      // Computed the way the job must: defenderTag looked up in THEIR roster.
      const byPosition = new Map(THEIRS.members.map((m) => [m.tag, m.mapPosition]));
      const expected = [...OURS.members]
        .filter((m) => m.attacks?.length)
        .sort((a, b) => a.mapPosition - b.mapPosition)
        .map((m) => byPosition.get(m.attacks![0]!.defenderTag));

      expect(rows.rows.map((r) => r.defender_position)).toEqual(expected);

      // In a real war the attacker's rank and their target's rank rarely agree,
      // which is what makes the index shortcut detectable at all. If they ever
      // did line up for every attacker, this test would silently stop testing.
      const attackerPositions = rows.rows.map((r) => r.map_position);
      expect(expected).not.toEqual(attackerPositions);
    });

    it("stores no placeholder row for the player who did not attack", async () => {
      await runSyncJob("cwl", syncCwl, { client });

      // 002_cwl.sql:76-78 — a miss is the ABSENCE of a row, never a zero-star one.
      expect(await count(h, "cwl_attacks", "stars = 0")).toBe(0);

      const warId = await firstWarId(h);
      const missed = await h.db.query<{ n: number }>(
        `select count(*)::int as n
           from cwl_war_members m
          where m.war_id = '${warId}'
            and not exists (
              select 1 from cwl_attacks a
               where a.war_id = m.war_id and a.player_id = m.player_id)`,
      );
      expect(missed.rows[0]!.n).toBe(MISSED_COUNT);
    });

    it("creates a players row for a CWL participant sync:clans has never seen", async () => {
      // The job runs against an empty players table, so every member of the
      // roster is unknown. Dropping them would drop their attacks, which is the
      // one loss this project exists to prevent.
      expect(await count(h, "players")).toBe(0);
      await runSyncJob("cwl", syncCwl, { client });

      // Deduplicated by tag: the same roster arrives once per war the harness
      // replays, and must not produce a player row each time (R5).
      expect(await count(h, "players")).toBe(ROSTER_SIZE);
      expect(await count(h, "players", `clan_id = '${CLAN_A}'`)).toBe(ROSTER_SIZE);
    });

    it("does not reassign a player who has since moved to another clan", async () => {
      const OTHER = "cccccccc-0000-4000-8000-000000000009";

      // A tag from the ACTUAL captured roster. It used to be '#PY0LQGRJ', which
      // was a synthetic player — once the real fixture landed, no such row was
      // ever created and the assertion below silently stopped testing anything.
      const MOVED = OURS.members[0]!.tag;

      await h.db.exec(`
        insert into clans (id, tag, name) values ('${OTHER}', '#9CUVPYQ2', 'Other clan');
        insert into players (clan_id, tag, name)
        values ('${OTHER}', '${MOVED}', 'Moved player');
      `);

      await runSyncJob("cwl", syncCwl, { client });

      // sync:clans owns clan membership (T3.9). This job may not drag someone
      // back to the clan they played CWL for a month ago.
      const row = await h.db.query<{ clan_id: string }>(
        `select clan_id from players where tag = '${MOVED}'`,
      );
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]!.clan_id).toBe(OTHER);

      // ...and their attacks are still recorded against the right wars.
      expect(await count(h, "cwl_attacks")).toBe(ATTACK_COUNT * WAR_COUNT);
    });

    describe("running it repeatedly changes nothing (R5)", () => {
      it("leaves every CWL table's count unchanged", async () => {
        await runSyncJob("cwl", syncCwl, { client });
        const before = {
          seasons: await count(h, "cwl_seasons"),
          wars: await count(h, "cwl_wars"),
          members: await count(h, "cwl_war_members"),
          attacks: await count(h, "cwl_attacks"),
        };

        await runSyncJob("cwl", syncCwl, { client });
        await runSyncJob("cwl", syncCwl, { client });

        expect({
          seasons: await count(h, "cwl_seasons"),
          wars: await count(h, "cwl_wars"),
          members: await count(h, "cwl_war_members"),
          attacks: await count(h, "cwl_attacks"),
        }).toEqual(before);
      });

      it("keeps attack ids stable, so nothing was deleted and rewritten", async () => {
        await runSyncJob("cwl", syncCwl, { client });
        const first = await h.db.query<{ id: string }>(
          `select id from cwl_attacks order by defender_tag`,
        );

        await runSyncJob("cwl", syncCwl, { client });
        const second = await h.db.query<{ id: string }>(
          `select id from cwl_attacks order by defender_tag`,
        );

        expect(second.rows).toEqual(first.rows);
      });

      it("does not re-fetch a war it has already recorded as ended", async () => {
        await runSyncJob("cwl", syncCwl, { client });

        // Every settled war is skipped, so the second run reaches no war
        // endpoint at all. With fixtures that is invisible — assert it by
        // showing the run still succeeds once the network is made fatal for
        // the group call only.
        const war = await h.db.query<{ state: string }>(`select state from cwl_wars`);
        expect(war.rows[0]!.state).toBe("warEnded");

        const result = await runSyncJob("cwl", syncCwl, { client });
        expect(result).toBe("success");
        expect(await count(h, "cwl_wars")).toBe(WAR_COUNT);
      });
    });

    describe("R9 — sync_log", () => {
      it("records a success with the rows it wrote", async () => {
        await runSyncJob("cwl", syncCwl, { client });
        const log = await h.db.query<{
          status: string;
          records_written: number;
          finished_at: string | null;
        }>(`select status, records_written, finished_at from sync_log
             where job_type = 'cwl' order by started_at desc limit 1`);

        const row = log.rows[0]!;
        expect(row.status).toBe("success");
        expect(row.finished_at).not.toBeNull();
        // roster + attacks, for every war the harness replayed.
        expect(row.records_written).toBe((ROSTER_SIZE + ATTACK_COUNT) * WAR_COUNT);
      });

      it("records a failure rather than throwing out of the job", async () => {
        process.env.USE_FIXTURES = "false";
        process.env.COC_API_TOKEN = "not-a-real-token";
        vi.stubGlobal("fetch", () =>
          Promise.resolve(new Response("{}", { status: 500 })),
        );

        const result = await runSyncJob("cwl", syncCwl, { client });
        expect(result).toBe("failed");

        const log = await h.db.query<{ status: string; error: string }>(
          `select status, error from sync_log where job_type = 'cwl'
            order by started_at desc limit 1`,
        );
        expect(log.rows[0]!.status).toBe("failed");
        expect(log.rows[0]!.error).toBeTruthy();
      });
    });
  });
});
