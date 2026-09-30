// T2.6 — the clan sync, end to end and entirely offline.
//
// fixtures -> Zod -> mappers -> SQL -> real Postgres. USE_FIXTURES=true and a
// throwing `fetch`, so nothing touches the network: this is T2.3's done-when and
// T2.6's done-when proved together.
//
// The headline assertion is the spec's: running it twice produces no duplicate
// rows (R5).

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { runSyncJob } from "../scripts/sync/shared";
import { syncClans } from "../scripts/sync/clans";
import { mapRole } from "../src/integration/mappers";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000001";

/**
 * The expectations below are DERIVED from fixtures/clan.json, never written as
 * literals.
 *
 * T2.1 re-captures these files from the live API — and did, which is what turned
 * this suite red: a `toBe(5)` asserted that the synthetic clan had five members,
 * not that the sync writes every member it was given. The first real capture had
 * thirty, and eight tests failed while the code was entirely correct.
 *
 * A test that has to be edited whenever the fixtures are refreshed is a test that
 * will eventually be edited to match a bug.
 */
const CLAN_FIXTURE = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "clan.json"), "utf8"),
) as {
  name: string;
  clanLevel: number;
  warLeague?: { name: string };
  isWarLogPublic?: boolean;
  memberList: Array<{
    name: string;
    // The API's own vocabulary, which is NOT the database's — mapRole() is the
    // only thing that should know the difference. Typed as the wire union so
    // that passing one of these straight to a column is a compile error.
    role?: "leader" | "coLeader" | "admin" | "member" | "notMember";
    donations?: number;
    trophies?: number;
  }>;
};

const MEMBER_COUNT = CLAN_FIXTURE.memberList.length;

/** The member the `order by name limit 1` queries below will land on. */
const FIRST_BY_NAME = [...CLAN_FIXTURE.memberList].sort((a, b) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
)[0]!;

async function count(h: Harness, table: string, where = "true"): Promise<number> {
  const res = await h.db.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
  );
  return res.rows[0]!.n;
}

describe("T2.6 — sync:clans against real Postgres, offline", () => {
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
    // If any code path reaches the network, this throws and the test fails.
    vi.stubGlobal("fetch", () => {
      throw new Error("network was used while USE_FIXTURES=true");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await h.asSuperuser();
    await h.db.exec(`
      truncate member_snapshots, players, sync_log, clans cascade;
      insert into clans (id, tag, name) values ('${CLAN_A}', '#2PP0JCCL', 'Seed name');
    `);
  });

  it("skips cleanly when no clans are seeded, rather than failing", async () => {
    await h.db.exec(`truncate member_snapshots, players, clans cascade`);
    const result = await runSyncJob("clans", syncClans, { client });

    // R10 — "you have not run seed.sql yet" is a configuration state, not a
    // failure that should turn an Actions run red.
    expect(result).toBe("skipped");
    const log = await h.db.query<{ skip_reason: string }>(
      `select skip_reason from sync_log order by started_at desc limit 1`,
    );
    expect(log.rows[0]!.skip_reason).toBe("noClansSeeded");
  });

  it("writes players from the fixture without touching the network", async () => {
    const result = await runSyncJob("clans", syncClans, { client });

    expect(result).toBe("success");
    expect(await count(h, "players")).toBe(MEMBER_COUNT);
  });

  it("updates the clan's own row from the API", async () => {
    await runSyncJob("clans", syncClans, { client });
    const res = await h.db.query<{ name: string; badge_url: string }>(
      `select name, badge_url from clans where id = '${CLAN_A}'`,
    );
    expect(res.rows[0]!.name).toBe(CLAN_FIXTURE.name);
    expect(res.rows[0]!.badge_url).toContain("api-assets.clashofclans.com");
  });

  // T3B.0 — these four were parsed and mapped on every run and then dropped,
  // because migration 020 did not exist. The dashboard is the first thing that
  // reads them, so this is the test that would have caught the omission.
  it("stores the clan detail columns the dashboard needs (T3B.0)", async () => {
    await runSyncJob("clans", syncClans, { client });
    const res = await h.db.query<{
      level: number;
      war_league: string;
      member_count: number;
      is_war_log_public: boolean;
    }>(
      `select level, war_league, member_count, is_war_log_public
         from clans where id = '${CLAN_A}'`,
    );

    const clan = res.rows[0]!;
    expect(clan.level).toBe(CLAN_FIXTURE.clanLevel);
    // The NAME, not warLeague.id — 48000012 means nothing to a member.
    expect(clan.war_league).toBe(CLAN_FIXTURE.warLeague?.name);
    expect(clan.member_count).toBe(MEMBER_COUNT);
    // T0.1. False here would mean phase 6 can collect nothing for this clan.
    expect(clan.is_war_log_public).toBe(CLAN_FIXTURE.isWarLogPublic);
  });

  it("translates roles, including admin to elder", async () => {
    await runSyncJob("clans", syncClans, { client });
    const res = await h.db.query<{ name: string; clan_role: string }>(
      `select name, clan_role from players`,
    );

    // Matched BY NAME rather than by row order. Postgres orders by collation and
    // JavaScript by code point, so real member names — mixed case, emoji, non-Latin
    // scripts — sort differently in the two, and a positional comparison fails on
    // a correct result. Ordering is not what this test is about.
    const actual = new Map(res.rows.map((r) => [r.name, r.clan_role]));
    expect(actual.size).toBe(MEMBER_COUNT);

    for (const member of CLAN_FIXTURE.memberList) {
      expect(actual.get(member.name), member.name).toBe(mapRole(member.role));
    }

    // mapRole() rather than a re-implementation of it: there are TWO wire names
    // that differ from ours — `admin` for elder and `coLeader` for co-leader —
    // and a test that spells out its own translation table gets one of them
    // wrong, which is exactly what happened here on the first attempt.
    //
    // The stored values must be the database's vocabulary, never Supercell's:
    // players.clan_role has a check constraint naming these four, so a leaked
    // raw name is a failed insert at 2 AM rather than a wrong label.
    const stored = [...actual.values()];
    expect(stored).not.toContain("admin");
    expect(stored).not.toContain("coLeader");
    for (const role of stored) {
      expect(["leader", "co-leader", "elder", "member"]).toContain(role);
    }
  });

  it("sets clan_id on every player (R3)", async () => {
    await runSyncJob("clans", syncClans, { client });
    expect(await count(h, "players", `clan_id = '${CLAN_A}'`)).toBe(MEMBER_COUNT);
    expect(await count(h, "players", "clan_id is null")).toBe(0);
  });

  // ── T2.6's stated done-when ────────────────────────────────────────────
  describe("running it twice produces no duplicate rows (R5)", () => {
    it("leaves the player count unchanged", async () => {
      await runSyncJob("clans", syncClans, { client });
      const afterFirst = await count(h, "players");

      await runSyncJob("clans", syncClans, { client });
      await runSyncJob("clans", syncClans, { client });

      expect(await count(h, "players")).toBe(afterFirst);
    });

    it("leaves the snapshot count unchanged within the hour (T2.9)", async () => {
      await runSyncJob("clans", syncClans, { client });
      const afterFirst = await count(h, "member_snapshots");
      expect(afterFirst).toBe(MEMBER_COUNT);

      await runSyncJob("clans", syncClans, { client });
      await runSyncJob("clans", syncClans, { client });

      // The generated captured_slot key (054, 30 minutes; 007's hour before it)
      // is what makes this free. Without it, every run would grow this table.
      expect(await count(h, "member_snapshots")).toBe(afterFirst);
    });

    it("keeps player ids stable, so history stays attached", async () => {
      await runSyncJob("clans", syncClans, { client });
      const before = await h.db.query<{ id: string }>(
        `select id from players order by tag`,
      );

      await runSyncJob("clans", syncClans, { client });
      const after = await h.db.query<{ id: string }>(
        `select id from players order by tag`,
      );

      expect(after.rows.map((r) => r.id)).toEqual(before.rows.map((r) => r.id));
    });
  });

  describe("T2.9 — snapshots capture the counters that get differenced", () => {
    it("stores donations and trophies per player", async () => {
      await runSyncJob("clans", syncClans, { client });
      const res = await h.db.query<{ donations: number; trophies: number }>(
        `select s.donations, s.trophies
         from member_snapshots s join players p on p.id = s.player_id
         order by p.name limit 1`,
      );
      expect(res.rows[0]!.donations).toBe(FIRST_BY_NAME.donations);
      expect(res.rows[0]!.trophies).toBe(FIRST_BY_NAME.trophies);
    });

    it("links every snapshot to its clan (R3)", async () => {
      await runSyncJob("clans", syncClans, { client });
      expect(await count(h, "member_snapshots", `clan_id = '${CLAN_A}'`)).toBe(
        MEMBER_COUNT,
      );
    });
  });

  // ── T3.9 — movement and departure ──────────────────────────────────────
  describe("T3.9 — members moving and leaving", () => {
    it("marks a player who is in none of the three clans as departed", async () => {
      await runSyncJob("clans", syncClans, { client });

      // Someone who was a member last run but is absent from the fixture now.
      await h.db.exec(`
        insert into players (clan_id, tag, name, th_level)
        values ('${CLAN_A}', '#9V2GRJPY', 'Departed Player', 13)
      `);

      await runSyncJob("clans", syncClans, { client });

      const res = await h.db.query<{ left_at: string | null; name: string }>(
        `select name, left_at from players where tag = '#9V2GRJPY'`,
      );
      expect(res.rows[0]!.left_at).not.toBeNull();
      // R4 — the row and all its history survive. Only the flag changed.
      expect(res.rows[0]!.name).toBe("Departed Player");
    });

    it("does not touch players who are still present", async () => {
      await runSyncJob("clans", syncClans, { client });
      await runSyncJob("clans", syncClans, { client });
      expect(await count(h, "players", "left_at is not null")).toBe(0);
    });

    // The most likely bug in this file: marking departures inside the per-clan
    // loop would flag a player who moved from clan A to clan B, purely because
    // clan A was processed first. Departure detection must see all clans.
    it("does NOT mark a player who merely moved to another of the three clans", async () => {
      await h.db.exec(`
        insert into clans (id, tag, name) values ('${CLAN_B}', '#8QUCLJY0', 'Clan B');
      `);
      await runSyncJob("clans", syncClans, { client });

      // Both clans read the same fixture, so every member appears in both.
      // A per-clan departure sweep would mark all of them as gone.
      expect(await count(h, "players", "left_at is not null")).toBe(0);
    });

    it("un-departs a member who returns, reusing their original row", async () => {
      await runSyncJob("clans", syncClans, { client });
      const before = await h.db.query<{ id: string }>(
        `select id from players order by tag limit 1`,
      );
      const id = before.rows[0]!.id;

      await h.db.exec(`update players set left_at = now() where id = '${id}'`);
      await runSyncJob("clans", syncClans, { client });

      const after = await h.db.query<{ id: string; left_at: string | null }>(
        `select id, left_at from players where id = '${id}'`,
      );
      expect(after.rows[0]!.left_at).toBeNull();
      expect(after.rows[0]!.id).toBe(id); // history stays attached
    });
  });

  // T0.1 — the spec makes this a manual in-game check, but the API reports it.
  describe("T0.1 — a private war log is detected automatically", () => {
    it("warns, naming the clan, when the war log is private", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const path = join(process.cwd(), "fixtures", "clan.json");
      const original = readFileSync(path, "utf8");

      try {
        const fixture = JSON.parse(original);
        fixture.isWarLogPublic = false;
        writeFileSync(path, JSON.stringify(fixture, null, 2), "utf8");

        const result = await runSyncJob("clans", syncClans, { client });

        // Warned, not failed: the clan sync itself works fine, and failing here
        // would stop members and snapshots being recorded too.
        expect(result).toBe("success");
        const message = warn.mock.calls.map((c) => String(c[0])).join("\n");
        expect(message).toMatch(/PRIVATE war log/i);
        expect(message).toContain("#2PP0JCCL");
      } finally {
        writeFileSync(path, original, "utf8");
      }
    });

    it("says nothing when the war log is public", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      await runSyncJob("clans", syncClans, { client });
      expect(warn.mock.calls.map((c) => String(c[0])).join("")).not.toMatch(
        /PRIVATE/i,
      );
    });
  });

  // R9 — the sync_log row is what makes a silent death impossible.
  describe("R9 — sync_log", () => {
    it("records a success with a row count", async () => {
      await runSyncJob("clans", syncClans, { client });
      const res = await h.db.query<{ status: string; records_written: number }>(
        `select status, records_written from sync_log order by started_at desc limit 1`,
      );
      expect(res.rows[0]!.status).toBe("success");
      expect(res.rows[0]!.records_written).toBeGreaterThan(0);
    });

    it("closes the row as failed when the API errors", async () => {
      // Point the client at a fixture that does not exist for this endpoint.
      process.env.USE_FIXTURES = "false";
      vi.stubGlobal("fetch", () =>
        Promise.resolve(new Response("{}", { status: 403 })),
      );
      process.env.COC_API_TOKEN = "test";

      const result = await runSyncJob("clans", syncClans, { client });

      expect(result).toBe("failed");
      const res = await h.db.query<{ status: string; error: string }>(
        `select status, error from sync_log order by started_at desc limit 1`,
      );
      expect(res.rows[0]!.status).toBe("failed");
      expect(res.rows[0]!.error).toBeTruthy();
    });
  });
});
