// T6.1 — the clan war sync, end to end and entirely offline.
//
// fixtures -> Zod -> mappers -> SQL -> real Postgres, with USE_FIXTURES=true and
// a throwing `fetch`, so nothing touches the network.
//
// The war module can be rebuilt from the API if a run is missed — unlike CWL,
// `/currentwar` reports the full cumulative state of the war and a missed tick
// costs freshness rather than data. What CANNOT be recovered is a war recorded
// wrongly, so the cases below concentrate on the four ways this job can be
// confidently incorrect:
//
//   1. writing a CWL war into `wars`, double-counting it against cwl_wars
//   2. recording the result backwards, because `clan` is not necessarily ours
//   3. leaving defender_position null, which silently disables T6.9 forever
//   4. rewriting a war already recorded as ended (R5)
//
// None of the four produces an error at the time.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { runSyncJob } from "../scripts/sync/shared";
import { isLeagueWar, matchLogEntry, syncWar } from "../scripts/sync/war";
import { parseCocTime } from "@/lib/coc-time";
import type { War } from "@/types/domain";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";

/**
 * A REAL war, borrowed from cwlwar.json, standing in for currentwar.json.
 *
 * The captured currentwar.json is `notInWar`. That is the honest result — it is
 * the ordinary state for most of a month (R10) — and it makes the fixture
 * useless as the subject of a job whose whole purpose is recording a war. Nor is
 * it a one-off to wait out: `/currentwar` only carries a war for a few days at a
 * time, so most future re-captures will land on `notInWar` too.
 *
 * cwlwar.json is a complete, real war from the same API, and the two endpoints
 * return an identical shape. Two deliberate edits make it a REGULAR war:
 *
 *   warTag        removed. isLeagueWar() keys on exactly this, and a war that
 *                 carries one belongs in cwl_wars — writing it to `wars` is the
 *                 double-counting bug named as trap 1 in this file's header.
 *   attacksPerMember  set to 2. Regular war gives two attacks per member; CWL
 *                 gives one. The captured war is a CWL war, so leaving this
 *                 alone would quietly assert the wrong denominator for T6.9.
 *
 * Written before each test and restored after, so the committed fixture on disk
 * is never left modified — the same pattern sync-clans.test.ts uses for its
 * private-war-log case.
 */
const CURRENT_WAR_PATH = join(process.cwd(), "fixtures", "currentwar.json");
const CWL_WAR_PATH = join(process.cwd(), "fixtures", "cwlwar.json");

const REAL_CURRENT_WAR = readFileSync(CURRENT_WAR_PATH, "utf8");

interface WarFixture {
  state: string;
  warTag?: string;
  attacksPerMember?: number;
  startTime: string;
  endTime: string;
  clan: WarSideFixture;
  opponent: WarSideFixture;
}

interface WarSideFixture {
  tag: string;
  badgeUrls?: { small?: string; medium?: string };
  stars: number;
  destructionPercentage: number;
  members: Array<{
    tag: string;
    mapPosition: number;
    attacks?: Array<{ defenderTag: string; stars: number }>;
  }>;
}

const IN_WAR: WarFixture = (() => {
  const war = JSON.parse(readFileSync(CWL_WAR_PATH, "utf8")) as WarFixture;
  delete war.warTag;
  war.attacksPerMember = 2;
  return war;
})();

const OURS = IN_WAR.clan;
const THEIRS = IN_WAR.opponent;
const OUR_TAG = OURS.tag;
const THEIR_TAG = THEIRS.tag;

const ROSTER_SIZE = OURS.members.length;
const OPPONENT_SIZE = THEIRS.members.length;
const ATTACK_COUNT = OURS.members.reduce((n, m) => n + (m.attacks?.length ?? 0), 0);

async function count(h: Harness, table: string, where = "true"): Promise<number> {
  const res = await h.db.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
  );
  return res.rows[0]!.n;
}

describe("T6.1 — the clan war sync", () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Pure. The one guard that has no equivalent in the CWL job.
  // ───────────────────────────────────────────────────────────────────────────
  describe("isLeagueWar — a CWL war arriving on the regular endpoint", () => {
    const war = (warTag?: string): War => ({ state: "inWar", warTag }) as War;

    it("recognises one by its war tag", () => {
      expect(isLeagueWar(war("#8G9QRVJL"))).toBe(true);
    });

    it("leaves an ordinary war alone", () => {
      expect(isLeagueWar(war(undefined))).toBe(false);
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
      // See IN_WAR: the captured currentwar.json is notInWar, so it is swapped
      // for a real war for the duration of each case and restored below.
      writeFileSync(CURRENT_WAR_PATH, JSON.stringify(IN_WAR, null, 2), "utf8");

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
        truncate feedback, notifications, war_attacks, war_members, war_opponent_members, war_targets,
                 war_lineup_members, war_lineups, wars,
                 member_snapshots, players, sync_log, users, clans cascade;
        delete from auth.users;
        insert into clans (id, tag, name) values ('${CLAN_A}', '${OUR_TAG}', 'Synthetic Clan');
      `);
    });

    afterEach(() => {
      // Unconditional, and before anything else that could throw: a failing test
      // must not leave a rewritten fixture committed to the repository.
      writeFileSync(CURRENT_WAR_PATH, REAL_CURRENT_WAR, "utf8");
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("skips cleanly when no clan is seeded", async () => {
      await h.db.exec(`truncate players, clans cascade`);
      const result = await runSyncJob("war", syncWar, { client });

      expect(result).toBe("skipped");
      const log = await h.db.query<{ skip_reason: string }>(
        `select skip_reason from sync_log order by started_at desc limit 1`,
      );
      expect(log.rows[0]!.skip_reason).toBe("noClansSeeded");
    });

    it("captures the war, the roster and the attacks", async () => {
      const result = await runSyncJob("war", syncWar, { client });

      expect(result).toBe("success");
      expect(await count(h, "wars")).toBe(1);
      // The full lineup, and the subset of it that attacked. Both derived from
      // the fixture — see IN_WAR.
      expect(await count(h, "war_members")).toBe(ROSTER_SIZE);
      expect(await count(h, "war_attacks")).toBe(ATTACK_COUNT);
      // And the other side (026), which arrives on the same response and was
      // discarded before T6.3 needed it.
      expect(await count(h, "war_opponent_members")).toBe(OPPONENT_SIZE);
    });

    // 026. The opposition is what turns "assign your TH16 to base 7" into a
    // decision, and it is deliberately NOT in `players` — putting fifty
    // strangers per war into the member directory is not undoable under R4.
    it("records the opposing lineup without inventing players rows for them", async () => {
      await runSyncJob("war", syncWar, { client });

      const rows = await h.db.query<{ tag: string; name: string; map_position: number }>(
        `select tag, name, map_position from war_opponent_members order by map_position`,
      );
      expect(rows.rows.map((r) => r.map_position)).toEqual(
        [...THEIRS.members].map((m) => m.mapPosition).sort((a, b) => a - b),
      );
      // Named, not numbered: T6.3 shows the leader who is on each base.
      expect(rows.rows[0]!.name).toBeTruthy();

      // Only our own five. An opponent tag must never appear in the member
      // directory, the donation report or the cross-clan search.
      expect(await count(h, "players")).toBe(ROSTER_SIZE);
      expect(await count(h, "players", `tag like '#C2V89UG%'`)).toBe(0);
    });

    // Trap 2. The fixture gives our side 8 stars and theirs 6, so a job that
    // read `opponent` as ours would record a loss here and never complain.
    it("puts our stars on our side of the war row", async () => {
      await runSyncJob("war", syncWar, { client });
      const rows = await h.db.query<{
        our_stars: number;
        their_stars: number;
        our_destruction: string;
        result: string;
        state: string;
        opponent_tag: string;
        opponent_badge_url: string | null;
        team_size: number;
      }>(`select our_stars, their_stars, our_destruction, result, state,
                 opponent_tag, opponent_badge_url, team_size from wars`);

      const war = rows.rows[0]!;
      expect(war.our_stars).toBe(OURS.stars);
      expect(war.their_stars).toBe(THEIRS.stars);
      expect(Number(war.our_destruction)).toBeCloseTo(
        IN_WAR.clan.destructionPercentage,
        2,
      );
      expect(war.result).toBe("win");
      expect(war.state).toBe(IN_WAR.state);
      expect(war.opponent_tag).toBe(THEIR_TAG);
      // 045 — theirs, not ours: the board draws it on the right-hand side.
      expect(war.opponent_badge_url).toBe(THEIRS.badgeUrls!.medium);
      expect(war.team_size).toBe(ROSTER_SIZE);
    });

    // `unique (clan_id, start_time)` is the natural key — the API gives a
    // regular war no identifier of its own (003_war.sql:10-11).
    it("keys the war on the start time the API reported", async () => {
      await runSyncJob("war", syncWar, { client });
      const rows = await h.db.query<{ start_time: Date; end_time: Date; clan_id: string }>(
        `select start_time, end_time, clan_id from wars`,
      );

      expect(rows.rows[0]!.start_time.toISOString()).toBe(
        parseCocTime(IN_WAR.startTime).toISOString(),
      );
      expect(rows.rows[0]!.end_time.toISOString()).toBe(
        parseCocTime(IN_WAR.endTime).toISOString(),
      );
      expect(rows.rows[0]!.clan_id).toBe(CLAN_A); // R3
    });

    // Two, not CWL's one. Stored from the API's own attacksPerMember rather than
    // assumed, so a future game change cannot rewrite what old wars meant.
    it("records two attacks allowed per member, unlike CWL's one", async () => {
      await runSyncJob("war", syncWar, { client });
      expect(await count(h, "war_members", "attacks_allowed = 2")).toBe(ROSTER_SIZE);
    });

    // Trap 3, and the one with no visible symptom. The only source is looking
    // defenderTag up in the OPPONENT's roster; the fixture's opponent positions
    // run 5,4,3,2,1 against attackers 1,2,3, so a job that used the attacker's
    // own index would pass every count assertion and fail this one.
    it("resolves defender_position from the opponent roster, not the attacker index", async () => {
      await runSyncJob("war", syncWar, { client });
      const rows = await h.db.query<{ map_position: number; defender_position: number }>(
        `select m.map_position, a.defender_position
           from war_attacks a
           join war_members m
             on m.war_id = a.war_id and m.player_id = a.player_id
          order by m.map_position`,
      );

      const byPosition = new Map(THEIRS.members.map((m) => [m.tag, m.mapPosition]));
      const expected = [...OURS.members]
        .filter((m) => m.attacks?.length)
        .sort((a, b) => a.mapPosition - b.mapPosition)
        .flatMap((m) => m.attacks!.map((a) => byPosition.get(a.defenderTag)));

      expect(rows.rows.map((r) => r.defender_position)).toEqual(expected);
      expect(expected).not.toEqual(rows.rows.map((r) => r.map_position));
    });

    it("numbers attacks per player, not by the API's global war order", async () => {
      await runSyncJob("war", syncWar, { client });
      // Each of the three attacked once, so every row is that player's first —
      // even though the API's `order` field runs 1, 2, 3 across the war.
      expect(await count(h, "war_attacks", "attack_order = 1")).toBe(ATTACK_COUNT);
      expect(await count(h, "war_attacks", "attack_order <> 1")).toBe(0);
    });

    // A war gives two attacks, so "did not attack at all" and "used one of two"
    // are different states and both belong on the chase list. Neither is stored:
    // the absence of a row is what says it.
    it("stores no placeholder row for an attack that was not used", async () => {
      await runSyncJob("war", syncWar, { client });

      const unused = await h.db.query<{ n: number }>(
        `select count(*)::int as n
           from war_members m
          where m.attacks_allowed > (
            select count(*) from war_attacks a
             where a.war_id = m.war_id and a.player_id = m.player_id)`,
      );
      // Every member of a CWL roster gets one attack, and this fixture is a CWL
      // war relabelled as a regular one (see IN_WAR) — so with attacks_allowed
      // forced to 2, everyone is short of their allowance, including the 14 who
      // attacked once. That is the state the chase list has to distinguish.
      expect(unused.rows[0]!.n).toBe(ROSTER_SIZE);

      const none = await h.db.query<{ n: number }>(
        `select count(*)::int as n
           from war_members m
          where not exists (
            select 1 from war_attacks a
             where a.war_id = m.war_id and a.player_id = m.player_id)`,
      );
      expect(none.rows[0]!.n).toBe(ROSTER_SIZE - ATTACK_COUNT);
    });

    it("creates a players row for a participant sync:clans has never seen", async () => {
      expect(await count(h, "players")).toBe(0);
      await runSyncJob("war", syncWar, { client });

      expect(await count(h, "players")).toBe(ROSTER_SIZE);
      expect(await count(h, "players", `clan_id = '${CLAN_A}'`)).toBe(ROSTER_SIZE);
    });

    it("does not reassign a player who has since moved to another clan", async () => {
      const OTHER = "cccccccc-0000-4000-8000-000000000009";
      await h.db.exec(`
        insert into clans (id, tag, name) values ('${OTHER}', '#9CUVPYQ2', 'Other clan');
        insert into players (clan_id, tag, name)
        values ('${OTHER}', '#PY0LQGRJ', 'Moved player');
      `);

      await runSyncJob("war", syncWar, { client });

      // sync:clans owns clan membership (T3.9).
      const row = await h.db.query<{ clan_id: string }>(
        `select clan_id from players where tag = '#PY0LQGRJ'`,
      );
      expect(row.rows[0]!.clan_id).toBe(OTHER);
      expect(await count(h, "war_attacks")).toBe(ATTACK_COUNT);
    });

    // R11/R12 — the leader's plan is not this job's to touch. Migration 024
    // revokes the grants, but the sync runs as a client that bypasses RLS, so
    // the discipline is asserted here as well.
    it("never writes the human-decision tables", async () => {
      await h.db.exec(`
        insert into auth.users (id, email)
        values ('dddddddd-0000-4000-8000-00000000d001', 'l@example.com');
        insert into users (id, email, status)
        values ('dddddddd-0000-4000-8000-00000000d001', 'l@example.com', 'approved');
        insert into war_lineups (id, clan_id, size, created_by)
        values ('88888888-0000-4000-8000-0000000000a1', '${CLAN_A}', 15,
                'dddddddd-0000-4000-8000-00000000d001');
      `);

      await runSyncJob("war", syncWar, { client });

      expect(await count(h, "war_targets")).toBe(0);
      expect(await count(h, "war_lineup_members")).toBe(0);
      // The lineup the leader started is exactly as they left it.
      expect(await count(h, "war_lineups", "status = 'draft' and war_id is null")).toBe(1);
    });

    describe("running it repeatedly changes nothing (R5)", () => {
      it("leaves every war table's count unchanged", async () => {
        await runSyncJob("war", syncWar, { client });
        const before = {
          wars: await count(h, "wars"),
          members: await count(h, "war_members"),
          opponents: await count(h, "war_opponent_members"),
          attacks: await count(h, "war_attacks"),
          players: await count(h, "players"),
        };

        await runSyncJob("war", syncWar, { client });
        await runSyncJob("war", syncWar, { client });

        expect({
          wars: await count(h, "wars"),
          members: await count(h, "war_members"),
          opponents: await count(h, "war_opponent_members"),
          attacks: await count(h, "war_attacks"),
          players: await count(h, "players"),
        }).toEqual(before);
      });

      it("keeps attack ids stable, so nothing was deleted and rewritten", async () => {
        await runSyncJob("war", syncWar, { client });
        const first = await h.db.query<{ id: string }>(
          `select id from war_attacks order by defender_tag`,
        );

        await runSyncJob("war", syncWar, { client });
        const second = await h.db.query<{ id: string }>(
          `select id from war_attacks order by defender_tag`,
        );

        expect(second.rows).toEqual(first.rows);
      });

      // Trap 4. The fixture says inWar with 8 stars; once a war is recorded as
      // ended, a later response — late, malformed, or from a re-used start time
      // — must not be able to rewrite the result.
      it("leaves a war already recorded as ended completely untouched", async () => {
        await runSyncJob("war", syncWar, { client });
        await h.db.exec(
          `update wars set state = 'warEnded', our_stars = 15, result = 'win'`,
        );

        const result = await runSyncJob("war", syncWar, { client });
        expect(result).toBe("success");

        const row = await h.db.query<{ state: string; our_stars: number }>(
          `select state, our_stars from wars`,
        );
        expect(row.rows[0]!.state).toBe("warEnded");
        expect(row.rows[0]!.our_stars).toBe(15);
        expect(await count(h, "wars")).toBe(1);
      });
    });

    describe("R9 — sync_log", () => {
      it("records a success with the rows it wrote", async () => {
        await runSyncJob("war", syncWar, { client });
        const log = await h.db.query<{
          status: string;
          records_written: number;
          finished_at: string | null;
        }>(`select status, records_written, finished_at from sync_log
             where job_type = 'war' order by started_at desc limit 1`);

        const row = log.rows[0]!;
        expect(row.status).toBe("success");
        expect(row.finished_at).not.toBeNull();
        expect(row.records_written).toBe(ROSTER_SIZE + OPPONENT_SIZE + ATTACK_COUNT);
      });
    });

    // ─────────────────────────────────────────────────────────────────────────
    // The states the fixture cannot express. USE_FIXTURES=false with a stubbed
    // fetch, which is the only way to hand this job a different war.
    // ─────────────────────────────────────────────────────────────────────────
    describe("the states a single fixture cannot cover", () => {
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

      afterEach(() => {
        delete process.env.COC_THROTTLE_MS;
        delete process.env.COC_BACKOFF_MS;
        delete process.env.COC_API_TOKEN;
      });

      // R10. Three weeks in four this is every clan, and reporting failure would
      // train you to ignore the alerts that matter.
      it("skips, rather than fails, when the clan is not in a war", async () => {
        respondWith({ state: "notInWar" });

        const result = await runSyncJob("war", syncWar, { client });
        expect(result).toBe("skipped");
        expect(await count(h, "wars")).toBe(0);

        const log = await h.db.query<{ skip_reason: string }>(
          `select skip_reason from sync_log where job_type = 'war'
            order by started_at desc limit 1`,
        );
        expect(log.rows[0]!.skip_reason).toBe("notInWar");
      });

      // Trap 1. Writing this into `wars` counts the same war twice — once here
      // and once in cwl_wars — in war history and in the contribution report,
      // with no constraint anywhere to catch it.
      it("declines a CWL war arriving on the regular endpoint", async () => {
        respondWith({
          state: "inWar",
          warTag: "#8G9QRVJL",
          teamSize: 15,
          startTime: "20260729T060000.000Z",
          endTime: "20260730T060000.000Z",
          clan: { tag: OUR_TAG, name: "Synthetic Clan", stars: 30, members: [] },
          opponent: { tag: THEIR_TAG, name: "Synthetic Opponent", stars: 20, members: [] },
        });

        const result = await runSyncJob("war", syncWar, { client });
        expect(result).toBe("skipped");
        expect(await count(h, "wars")).toBe(0);
      });

      // mapWar collapses an unrecognised state to 'notInWar' rather than
      // throwing, because Supercell has added states before and a job that dies
      // on one loses the war. `wars.state` has no such value in its CHECK, so
      // the collapse must reach the skip path and never an INSERT.
      it("treats an unrecognised state as no war, not as a constraint violation", async () => {
        respondWith({
          state: "somethingSupercellAddedLater",
          teamSize: 15,
          startTime: "20260729T060000.000Z",
          clan: { tag: OUR_TAG, name: "Synthetic Clan", stars: 1, members: [] },
          opponent: { tag: THEIR_TAG, name: "Opponent", stars: 0, members: [] },
        });

        const result = await runSyncJob("war", syncWar, { client });
        expect(result).toBe("skipped");
        expect(await count(h, "wars")).toBe(0);
      });

      // A war in preparation has a roster and no attacks. It must be captured:
      // the lineup is what T6.10 compares the leader's plan against, and by the
      // time attacks exist the leader has already needed the board.
      it("captures a war in preparation, roster and all", async () => {
        respondWith({
          state: "preparation",
          teamSize: 2,
          attacksPerMember: 2,
          startTime: "20260801T060000.000Z",
          endTime: "20260802T060000.000Z",
          clan: {
            tag: OUR_TAG,
            name: "Synthetic Clan",
            members: [
              { tag: "#PY0LQGRJ", name: "Player 01", townhallLevel: 16, mapPosition: 1 },
              { tag: "#PY0LQGRC", name: "Player 02", townhallLevel: 15, mapPosition: 2 },
            ],
          },
          opponent: { tag: THEIR_TAG, name: "Synthetic Opponent", members: [] },
        });

        const result = await runSyncJob("war", syncWar, { client });
        expect(result).toBe("success");
        expect(await count(h, "wars", "state = 'preparation'")).toBe(1);
        expect(await count(h, "war_members")).toBe(2);
        expect(await count(h, "war_attacks")).toBe(0);
        // No stars on either side yet, so there is no result to record. Scoring
        // it as anything — including a loss — would be a lie about a war that
        // has not been fought.
        expect(await count(h, "wars", "result is null")).toBe(1);
      });

      // T0.1 — a misconfiguration in the GAME, not a fault in this job. It used
      // to fail the run, and one clan's private log kept the war sync red for
      // four weeks in production, raising an alert every run and marking every
      // other clan's war page "failed". The clan's home page reports it from
      // clans.is_war_log_public; here it is a warning, never a failure.
      it("treats a private war log as a warning, not a failed run", async () => {
        respondWith({ reason: "accessDenied" }, 403);
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        const result = await runSyncJob("war", syncWar, { client });
        // No clan could be read, so nothing is at war as far as this run knows.
        expect(result).toBe("skipped");
        expect(warn.mock.calls.flat().join(" ")).toMatch(/war log is private/i);

        const log = await h.db.query<{ status: string; error: string | null }>(
          `select status, error from sync_log where job_type = 'war'
            order by started_at desc limit 1`,
        );
        expect(log.rows[0]!.status).toBe("skipped");
        expect(log.rows[0]!.error).toBeNull();
        warn.mockRestore();
      });

      /** Answer by path — for runs that call more than one endpoint. */
      function respondByPath(routes: Array<[match: string, body: unknown, status?: number]>) {
        respondWith({});
        vi.stubGlobal("fetch", (input: string | URL | Request) => {
          const url = typeof input === "string" ? input : input.toString();
          const route = routes.find(([match]) => url.includes(match));
          const [, body, status = 200] = route ?? ["", { reason: "notFound" }, 404];
          return Promise.resolve(
            new Response(JSON.stringify(body), {
              status,
              headers: { "content-type": "application/json" },
            }),
          );
        });
      }

      async function seedStaleWar(): Promise<void> {
        await h.db.exec(`
          insert into wars (clan_id, state, opponent_tag, our_stars, their_stars,
                            result, start_time, end_time)
          values ('${CLAN_A}', 'inWar', '${THEIR_TAG}', 20, 25, 'lose',
                  '2026-07-01T06:00:00Z', '2026-07-02T06:00:00Z');
        `);
      }

      // The hourly gap: the war ended and the clan moved on before a run saw
      // `warEnded`. The row used to stay `inWar` for ever, plan still editable.
      it("closes a war that ended unseen, with the final score from the war log", async () => {
        await seedStaleWar();
        respondByPath([
          ["/currentwar", { state: "notInWar" }],
          [
            "/warlog",
            {
              items: [
                {
                  result: "win",
                  endTime: "20260702T060000.000Z",
                  clan: { tag: OUR_TAG, stars: 30, destructionPercentage: 88.5 },
                  opponent: { tag: THEIR_TAG, stars: 27, destructionPercentage: 80 },
                },
              ],
            },
          ],
        ]);

        await runSyncJob("war", syncWar, { client });

        const row = await h.db.query<{ state: string; our_stars: number; result: string }>(
          `select state, our_stars, result from wars where clan_id = '${CLAN_A}'`,
        );
        expect(row.rows[0]).toMatchObject({ state: "warEnded", our_stars: 30, result: "win" });
      });

      it("still closes it on the last-known score when the war log is unreadable", async () => {
        await seedStaleWar();
        respondByPath([
          ["/currentwar", { state: "notInWar" }],
          ["/warlog", { reason: "accessDenied" }, 403],
        ]);

        await runSyncJob("war", syncWar, { client });

        const row = await h.db.query<{ state: string; our_stars: number; result: string | null }>(
          `select state, our_stars, result from wars where clan_id = '${CLAN_A}'`,
        );
        // Ended, on the last score seen — but NOT called a loss: that score is
        // an hour old and the war may have turned.
        expect(row.rows[0]).toMatchObject({ state: "warEnded", our_stars: 20, result: null });
      });

      // The real case, Dark Hell vs LEGENDARY BOYZ, 26 Sept 2026: /currentwar
      // said the war ended 18:57:05, the war log said 18:57:06. Matched on the
      // exact millisecond, the log was missed and a 120–120 draw was stored as
      // the 106–114 loss it had been an hour earlier.
      it("finds the war in the log when its end time is a second out", async () => {
        await h.db.exec(`
          insert into wars (clan_id, state, opponent_tag, our_stars, their_stars,
                            result, start_time, end_time)
          values ('${CLAN_A}', 'inWar', '${THEIR_TAG}', 106, 114, null,
                  '2026-09-25T18:57:05Z', '2026-09-26T18:57:05Z');
        `);
        respondByPath([
          ["/currentwar", { state: "notInWar" }],
          [
            "/warlog",
            {
              items: [
                {
                  result: "tie",
                  endTime: "20260926T185706.000Z",
                  clan: { tag: OUR_TAG, stars: 120, destructionPercentage: 100 },
                  opponent: { tag: THEIR_TAG, stars: 120, destructionPercentage: 100 },
                },
              ],
            },
          ],
        ]);

        await runSyncJob("war", syncWar, { client });

        const row = await h.db.query<{ our_stars: number; their_stars: number; result: string }>(
          `select our_stars, their_stars, result from wars where clan_id = '${CLAN_A}'`,
        );
        expect(row.rows[0]).toMatchObject({ our_stars: 120, their_stars: 120, result: "tie" });
      });

      // And the row that bug already wrote: ended, wrong. The log is the game's
      // final record, so a war that ended in the last two days is corrected.
      it("corrects a recently ended war to the war log's final score", async () => {
        const end = new Date(Date.now() - 20 * 60 * 60 * 1000);
        const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
        await h.db.exec(`
          insert into wars (clan_id, state, opponent_tag, our_stars, their_stars,
                            our_destruction, their_destruction, result, start_time, end_time)
          values ('${CLAN_A}', 'warEnded', '${THEIR_TAG}', 106, 114, 91.3, 96.2, 'lose',
                  '${start.toISOString()}', '${end.toISOString()}');
        `);
        const logEnd = new Date(end.getTime() + 1000).toISOString().replace(/[-:]/g, "");
        respondByPath([
          ["/currentwar", { state: "notInWar" }],
          [
            "/warlog",
            {
              items: [
                {
                  result: "tie",
                  endTime: logEnd,
                  clan: { tag: OUR_TAG, stars: 120, destructionPercentage: 100 },
                  opponent: { tag: THEIR_TAG, stars: 120, destructionPercentage: 100 },
                },
              ],
            },
          ],
        ]);

        await runSyncJob("war", syncWar, { client });

        const row = await h.db.query<{ our_stars: number; their_stars: number; result: string }>(
          `select our_stars, their_stars, result from wars where clan_id = '${CLAN_A}'`,
        );
        expect(row.rows[0]).toMatchObject({ our_stars: 120, their_stars: 120, result: "tie" });
      });

      it("matches a war that ended early on its opponent, not its scheduled end", () => {
        const log = [
          {
            // Every attack used: the log's end is three hours before the schedule.
            endMs: Date.parse("2026-09-26T15:57:05Z"),
            ours: { tag: OUR_TAG, stars: 120, destruction: 100, members: [] },
            theirs: { tag: THEIR_TAG, stars: 118, destruction: 99, members: [] },
          },
        ];
        expect(
          matchLogEntry({ opponent_tag: THEIR_TAG, end_time: "2026-09-26T18:57:05Z" }, log),
        ).toBe(log[0]);
        // A different opponent is not the same war, however close the time.
        expect(matchLogEntry({ opponent_tag: "#PQL0289", end_time: "2026-09-26T18:57:05Z" }, log)).toBeUndefined();
      });

      it("leaves the war the API is describing right now alone", async () => {
        respondByPath([
          [
            "/currentwar",
            {
              state: "inWar",
              teamSize: 1,
              startTime: "20260701T060000.000Z",
              endTime: "20260702T060000.000Z",
              clan: { tag: OUR_TAG, name: "Synthetic Clan", stars: 3, members: [] },
              opponent: { tag: THEIR_TAG, name: "Opponent", stars: 1, members: [] },
            },
          ],
        ]);

        await runSyncJob("war", syncWar, { client });
        expect(await count(h, "wars", "state = 'inWar'")).toBe(1);
      });

      // One clan's bad hour used to throw out of the loop, and every clan after
      // it in tag order lost its war for the run.
      it("captures the other clans when one clan's call fails", async () => {
        const OTHER = "bbbbbbbb-0000-4000-8000-000000000002";
        const OTHER_TAG = "#9CUVPYQ2";
        await h.db.exec(
          `insert into clans (id, tag, name) values ('${OTHER}', '${OTHER_TAG}', 'Other clan')`,
        );
        respondByPath([
          [encodeURIComponent(OUR_TAG), { reason: "unknownException" }, 500],
          [
            encodeURIComponent(OTHER_TAG),
            {
              state: "preparation",
              teamSize: 1,
              startTime: "20260801T060000.000Z",
              endTime: "20260802T060000.000Z",
              clan: { tag: OTHER_TAG, name: "Other clan", members: [] },
              opponent: { tag: THEIR_TAG, name: "Opponent", members: [] },
            },
          ],
        ]);

        const result = await runSyncJob("war", syncWar, { client });

        expect(result).toBe("failed");
        expect(await count(h, "wars", `clan_id = '${OTHER}'`)).toBe(1);
        const log = await h.db.query<{ error: string }>(
          `select error from sync_log where job_type = 'war'
            order by started_at desc limit 1`,
        );
        expect(log.rows[0]!.error).toContain(OUR_TAG);
      });
    });
  });
});
