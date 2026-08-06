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

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { runSyncJob } from "../scripts/sync/shared";
import { isLeagueWar, syncWar } from "../scripts/sync/war";
import type { War } from "@/types/domain";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";

/** The tags inside fixtures/currentwar.json. */
const OUR_TAG = "#2PP0JCCL";
const THEIR_TAG = "#8QUCLJY0";

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
        truncate war_attacks, war_members, war_targets,
                 war_lineup_members, war_lineups, wars,
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
      // Five in the lineup, three of whom attacked once each.
      expect(await count(h, "war_members")).toBe(5);
      expect(await count(h, "war_attacks")).toBe(3);
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
        team_size: number;
      }>(`select our_stars, their_stars, our_destruction, result, state,
                 opponent_tag, team_size from wars`);

      const war = rows.rows[0]!;
      expect(war.our_stars).toBe(8);
      expect(war.their_stars).toBe(6);
      expect(Number(war.our_destruction)).toBeCloseTo(87.4);
      expect(war.result).toBe("win");
      expect(war.state).toBe("inWar");
      expect(war.opponent_tag).toBe(THEIR_TAG);
      expect(war.team_size).toBe(5);
    });

    // `unique (clan_id, start_time)` is the natural key — the API gives a
    // regular war no identifier of its own (003_war.sql:10-11).
    it("keys the war on the start time the API reported", async () => {
      await runSyncJob("war", syncWar, { client });
      const rows = await h.db.query<{ start_time: Date; end_time: Date; clan_id: string }>(
        `select start_time, end_time, clan_id from wars`,
      );

      expect(rows.rows[0]!.start_time.toISOString()).toBe("2026-07-29T06:00:00.000Z");
      expect(rows.rows[0]!.end_time.toISOString()).toBe("2026-07-30T06:00:00.000Z");
      expect(rows.rows[0]!.clan_id).toBe(CLAN_A); // R3
    });

    // Two, not CWL's one. Stored from the API's own attacksPerMember rather than
    // assumed, so a future game change cannot rewrite what old wars meant.
    it("records two attacks allowed per member, unlike CWL's one", async () => {
      await runSyncJob("war", syncWar, { client });
      expect(await count(h, "war_members", "attacks_allowed = 2")).toBe(5);
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

      expect(rows.rows.map((r) => r.defender_position)).toEqual([5, 4, 3]);
    });

    it("numbers attacks per player, not by the API's global war order", async () => {
      await runSyncJob("war", syncWar, { client });
      // Each of the three attacked once, so every row is that player's first —
      // even though the API's `order` field runs 1, 2, 3 across the war.
      expect(await count(h, "war_attacks", "attack_order = 1")).toBe(3);
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
      // Two who did nothing, plus three who used one of their two.
      expect(unused.rows[0]!.n).toBe(5);

      const none = await h.db.query<{ n: number }>(
        `select count(*)::int as n
           from war_members m
          where not exists (
            select 1 from war_attacks a
             where a.war_id = m.war_id and a.player_id = m.player_id)`,
      );
      expect(none.rows[0]!.n).toBe(2);
    });

    it("creates a players row for a participant sync:clans has never seen", async () => {
      expect(await count(h, "players")).toBe(0);
      await runSyncJob("war", syncWar, { client });

      expect(await count(h, "players")).toBe(5);
      expect(await count(h, "players", `clan_id = '${CLAN_A}'`)).toBe(5);
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
      expect(await count(h, "war_attacks")).toBe(3);
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
          attacks: await count(h, "war_attacks"),
          players: await count(h, "players"),
        };

        await runSyncJob("war", syncWar, { client });
        await runSyncJob("war", syncWar, { client });

        expect({
          wars: await count(h, "wars"),
          members: await count(h, "war_members"),
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
        expect(row.records_written).toBe(8); // 5 in the lineup + 3 attacks
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

      // T0.1, and it is a real misconfiguration rather than a normal state — but
      // one clan's setting must not cost the other clans their war, so it is
      // collected and thrown at the end.
      it("reports a private war log as a failure that names the setting", async () => {
        respondWith({ reason: "accessDenied" }, 403);

        const result = await runSyncJob("war", syncWar, { client });
        expect(result).toBe("failed");

        const log = await h.db.query<{ error: string }>(
          `select error from sync_log where job_type = 'war'
            order by started_at desc limit 1`,
        );
        expect(log.rows[0]!.error).toMatch(/war log is private/i);
        expect(log.rows[0]!.error).toMatch(/T0\.1/);
      });
    });
  });
});
