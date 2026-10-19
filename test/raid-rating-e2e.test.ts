// The raid rating from the API response to marks: the real sync writes the
// fixture's weekends into Postgres, and the page's own loader reads them back
// through the real repositories — as a member, under RLS.
//
// The unit tests hand the service rows. What goes wrong in practice is the
// path between: an attack numbered the wrong way round, a weekend read under
// the wrong month, a league that never reaches the attack. So this runs the
// whole path and checks it against the worked example the clan agreed the
// rules on. Fixture mode answers every /clans/{tag} with clan.json, so every
// enemy is in that clan's league, Gold League I — the example's assumption.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { runSyncJob } from "../scripts/sync/shared";
import { syncRaids } from "../scripts/sync/raids";
import { loadRaidMonth } from "@/lib/raid-rating-data";
import { raidMonthsForClan } from "@/repositories/raids";

const CLAN = "aaaaaaaa-0000-4000-8000-000000000001";
const OTHER_CLAN = "bbbbbbbb-0000-4000-8000-000000000001";
const MEMBER = "aaaaaaaa-0000-4000-8000-0000000000e1";
const OUTSIDER = "bbbbbbbb-0000-4000-8000-0000000000e1";

describe("the raid rating, from the API response to marks", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);

    process.env.USE_FIXTURES = "true";
    vi.stubGlobal("fetch", () => {
      throw new Error("network was used while USE_FIXTURES=true");
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await h.asSuperuser();
    const clanTag = (
      JSON.parse(readFileSync(join(process.cwd(), "fixtures", "clan.json"), "utf8")) as { tag: string }
    ).tag;
    // Clan A alone while the sync runs: fixture mode would hand Clan B the same
    // weekends, and the raiders' players rows to whichever clan synced first.
    await h.db.exec(`insert into clans (id, tag, name) values ('${CLAN}', '${clanTag}', 'Clan A');`);
    expect(await runSyncJob("raids", syncRaids, { client })).toBe("success");

    await h.db.exec(`
      insert into clans (id, tag, name) values ('${OTHER_CLAN}', '#8QUCLJY0', 'Clan B');
      insert into auth.users (id, email) values
        ('${MEMBER}', 'member@example.com'),
        ('${OUTSIDER}', 'outsider@example.com');
      insert into users (id, email, status) values
        ('${MEMBER}', 'member@example.com', 'approved'),
        ('${OUTSIDER}', 'outsider@example.com', 'approved');
      insert into clan_roles (user_id, clan_id, role) values
        ('${MEMBER}', '${CLAN}', 'member'),
        ('${OUTSIDER}', '${OTHER_CLAN}', 'member');
    `);

    await h.asUser(MEMBER);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await h?.close();
  });

  it("finds the months the clan raided in, newest first", async () => {
    expect(await raidMonthsForClan(client, CLAN)).toEqual(["2026-08", "2026-07"]);
  });

  it("rates the latest weekend, whose attacks were captured", async () => {
    const view = await loadRaidMonth(client, { id: CLAN }, "2026-08");
    expect(view.rating.weekends.map((w) => w.status)).toEqual(["counted"]);
    expect(view.rating.started).toBe(true);
  });

  it("gives the agreed worked example's marks", async () => {
    const view = await loadRaidMonth(client, { id: CLAN }, "2026-08");
    const marks = new Map(view.rating.players.map((p) => [p.name, p.marks]));
    expect(marks.get("NETHAN")).toBe(13.74);
    expect(marks.get("Jona 1")).toBe(-17.12);
  });

  it("shares out exactly 100% of the clan's plus marks", async () => {
    const view = await loadRaidMonth(client, { id: CLAN }, "2026-08");
    const plus = view.rating.players.filter((p) => p.rating > 0).reduce((t, p) => t + p.rating, 0);
    expect(plus).toBeCloseTo(100);
    expect(view.rating.players).toHaveLength(6);
  });

  it("gives every attack the share it destroyed itself, finishing with 100%", async () => {
    const view = await loadRaidMonth(client, { id: CLAN }, "2026-08");
    const weekend = view.ratings[0]!;
    const attacks = weekend.players.flatMap((p) => p.attacks);
    expect(attacks).toHaveLength(31);
    // Every district is a chain of shares that adds up to where it ended.
    const byDistrict = new Map<string, number>();
    for (const a of attacks) {
      const key = `${a.raidNumber}:${a.districtName}`;
      byDistrict.set(key, (byDistrict.get(key) ?? 0) + a.share);
    }
    for (const total of byDistrict.values()) expect(total).toBeLessThanOrEqual(100);
    expect(attacks.filter((a) => a.finished)).toHaveLength(11);
    expect(attacks.every((a) => a.lines.some((l) => l.label === "Gold League I" && l.marks === 0.9))).toBe(true);
  });

  it("does not rate the older weekends, whose attacks the API never sent", async () => {
    const view = await loadRaidMonth(client, { id: CLAN }, "2026-07");
    expect(view.rating.weekends.map((w) => w.status)).toEqual([
      "notRated",
      "notRated",
      "notRated",
      "notRated",
    ]);
    expect(view.rating.players).toEqual([]);
    expect(view.rating.started).toBe(false);
  });

  // R3 — a member of another clan reads none of it, through the same loader.
  it("shows another clan's member nothing", async () => {
    await h.asUser(OUTSIDER);
    try {
      expect(await raidMonthsForClan(client, CLAN)).toEqual([]);
      const view = await loadRaidMonth(client, { id: CLAN }, "2026-08");
      expect(view.weekends).toEqual([]);
      expect(view.rating.players).toEqual([]);
    } finally {
      await h.asUser(MEMBER);
    }
  });
});
