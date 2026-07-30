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

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000001";

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
    expect(await count(h, "players")).toBe(5);
  });

  it("updates the clan's own row from the API", async () => {
    await runSyncJob("clans", syncClans, { client });
    const res = await h.db.query<{ name: string; badge_url: string }>(
      `select name, badge_url from clans where id = '${CLAN_A}'`,
    );
    expect(res.rows[0]!.name).toBe("Synthetic Clan");
    expect(res.rows[0]!.badge_url).toContain("api-assets.clashofclans.com");
  });

  it("translates roles, including admin to elder", async () => {
    await runSyncJob("clans", syncClans, { client });
    const res = await h.db.query<{ clan_role: string }>(
      `select clan_role from players order by name`,
    );
    expect(res.rows.map((r) => r.clan_role)).toEqual([
      "leader",
      "co-leader",
      "elder",
      "member",
      "member",
    ]);
  });

  it("sets clan_id on every player (R3)", async () => {
    await runSyncJob("clans", syncClans, { client });
    expect(await count(h, "players", `clan_id = '${CLAN_A}'`)).toBe(5);
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
      expect(afterFirst).toBe(5);

      await runSyncJob("clans", syncClans, { client });
      await runSyncJob("clans", syncClans, { client });

      // The generated captured_hour key in migration 007 is what makes this
      // free. Without it, an hourly job would grow this table every run.
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
      expect(res.rows[0]!.donations).toBe(1200);
      expect(res.rows[0]!.trophies).toBe(5200);
    });

    it("links every snapshot to its clan (R3)", async () => {
      await runSyncJob("clans", syncClans, { client });
      expect(await count(h, "member_snapshots", `clan_id = '${CLAN_A}'`)).toBe(5);
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
