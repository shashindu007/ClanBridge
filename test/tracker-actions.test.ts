// 079 — the upgrade tracker's Server Actions, end to end.
//
// The real actions run against the real schema (PGlite): they read the saved
// export, run the overlay, check the builders, work out the finish time from the
// game data, write the row and fold what has finished. Only the two things that
// need a request — who is signed in, and the rate limiter — are replaced
// (own-base.ts), and the first test proves a refused rate limit really stops a
// write.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { parseVillageExport } from "@/integration/village-export";
import { upgradeStep } from "@/data/game/costs";
import { saveVillageExport, villageExportsFor } from "@/repositories/village-exports";
import { trackedUpgradesFor } from "@/repositories/tracked-upgrades";

const holder = vi.hoisted(() => ({
  client: null as unknown,
  userId: "",
  base: null as unknown,
  limited: null as string | null,
}));

vi.mock("@/app/(app)/account/bases/own-base", () => ({
  ownBase: async () => ({ ok: true, supabase: holder.client, userId: holder.userId, base: holder.base }),
  withinWriteLimit: async () => holder.limited,
  refresh: () => {},
}));

const { cancelUpgrade, finishUpgradeNow, markAlreadyUpgraded, startUpgrade } = await import(
  "@/app/(app)/account/bases/tracker-actions"
);

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const OWNER = "11111111-0000-4000-8000-0000000000a2";
const MAIN = "44444444-0000-4000-8000-00000000001a";
const TAG = "%23PY0LQGRJ";

const cannon = { village: "home", subjectType: "building", name: "Cannon", fromLevel: 19 } as const;
const wall = { village: "home", subjectType: "building", name: "Wall", fromLevel: 16 } as const;

/** TH17 with two builders, three Cannons at 19, and a hundred walls at 16. Exported just now. */
function exported() {
  const parsed = parseVillageExport(
    JSON.stringify({
      tag: "#PY0LQGRJ",
      timestamp: Math.floor(Date.now() / 1000),
      buildings: [
        { data: 1000001, lvl: 17 },
        { data: 1000015, lvl: 1, cnt: 2 },
        { data: 1000008, lvl: 19, cnt: 3 },
        { data: 1000010, lvl: 16, cnt: 100 },
      ],
    }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.village;
}

describe("079 — tracker actions", () => {
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
    await h.asSuperuser();
    await h.db.exec(`
      truncate tracked_upgrades, village_exports, clan_roles, players, users, clans cascade;
      delete from auth.users;
      insert into clans (id, tag, name) values ('${CLAN_A}', '#2PP0JCCL', 'Clan A');
      insert into auth.users (id, email) values ('${OWNER}', 'owner@example.com');
      insert into users (id, email, status) values ('${OWNER}', 'owner@example.com', 'approved');
      insert into clan_roles (user_id, clan_id, role) values ('${OWNER}', '${CLAN_A}', 'member');
      insert into players (id, clan_id, user_id, tag, name, th_level, verified) values
        ('${MAIN}', '${CLAN_A}', '${OWNER}', '#PY0LQGRJ', 'Owner Main', 17, true);
    `);
    await h.asUser(OWNER);
    const saved = await saveVillageExport(client, MAIN, OWNER, exported());
    if (saved.error) throw new Error(String(saved.error.message));

    holder.client = client;
    holder.userId = OWNER;
    holder.base = { playerId: MAIN, tag: "#PY0LQGRJ", name: "Owner Main" };
    holder.limited = null;
  });

  const live = async () => (await trackedUpgradesFor(client, [MAIN])).get(MAIN) ?? [];
  const seconds = async () => {
    await h.asSuperuser();
    const r = await h.db.query<{ s: number }>(
      `select extract(epoch from ends_at - started_at)::int as s from tracked_upgrades order by created_at desc limit 1`,
    );
    await h.asUser(OWNER);
    return r.rows[0]!.s;
  };

  it("starts a timer whose length comes from the game data, not from the browser", async () => {
    expect(await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: null })).toEqual({});

    const rows = await live();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ subject: "Cannon", fromLevel: 19, workshop: "builders", boostPct: 0 });
    expect(await seconds()).toBe(upgradeStep("building", "Cannon", "home", 20)!.seconds);
  });

  it("shortens it by the Gold Pass boost, and ignores a boost it does not offer", async () => {
    await startUpgrade(TAG, cannon, { boostPct: 20, secondsLeft: null });
    expect(await seconds()).toBe(Math.round(upgradeStep("building", "Cannon", "home", 20)!.seconds * 0.8));
    expect((await live())[0]!.boostPct).toBe(20);

    const odd = await startUpgrade(TAG, cannon, { boostPct: 37, secondsLeft: null });
    expect(odd).toEqual({});
    expect((await live()).at(-1)!.boostPct).toBe(0);
  });

  it("takes the time left the member typed for an upgrade they started earlier", async () => {
    await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: 5_400 });
    expect(await seconds()).toBe(5_400);

    const tooLong = await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: 46 * 86_400 });
    expect(tooLong.error).toMatch(/45 days/);
  });

  it("refuses a third upgrade when both builders are busy", async () => {
    expect(await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: null })).toEqual({});
    expect(await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: null })).toEqual({});

    const third = await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: null });
    expect(third.error).toBe("All 2 builders are busy. Finish or cancel one first.");
    expect(await live()).toHaveLength(2);
  });

  it("refuses what is not there: an unknown name, a level nothing is at, a locked unit", async () => {
    const unknown = await startUpgrade(TAG, { ...cannon, name: "Not A Building" }, { boostPct: 0, secondsLeft: null });
    expect(unknown.error).toMatch(/not available any more/);

    const wrongLevel = await startUpgrade(TAG, { ...cannon, fromLevel: 12 }, { boostPct: 0, secondsLeft: null });
    expect(wrongLevel.error).toMatch(/not available any more/);

    const locked = await startUpgrade(
      TAG,
      { village: "home", subjectType: "unit", name: "Archer Queen", fromLevel: 0 },
      { boostPct: 0, secondsLeft: null },
    );
    expect(locked.error).toBe("Unlock Archer Queen in the game first.");

    const junk = await startUpgrade(TAG, { ...cannon, fromLevel: -3 }, { boostPct: 0, secondsLeft: null });
    expect(junk.error).toBe("That upgrade could not be found.");
    expect(await live()).toHaveLength(0);
  });

  it("refuses a merge before its sources reach the merge level, as the game does", async () => {
    const merge = { village: "home", subjectType: "building", name: "Ricochet Cannon", fromLevel: 0 } as const;
    const started = await startUpgrade(TAG, merge, { boostPct: 0, secondsLeft: null });
    expect(started.error).toBe("Needs 2 × Cannon at level 21 first.");

    const marked = await markAlreadyUpgraded(TAG, merge, 1);
    expect(marked.error).toBe("Needs 2 × Cannon at level 21 first.");
    expect(await live()).toHaveLength(0);

    // Nothing was taken from the Cannons.
    const village = (await villageExportsFor(client, [MAIN])).get(MAIN)!.village;
    expect(village.buildings.find((b) => b.name === "Cannon")?.levels).toEqual({ 19: 3 });
  });

  it("refuses to write when the rate limit says no", async () => {
    holder.limited = "Too many changes in a row. Wait a minute and try again.";
    const result = await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: null });
    expect(result.error).toMatch(/Too many changes/);
    expect(await live()).toHaveLength(0);
  });

  it("levels the building up when the member says it finished early, and frees the builder", async () => {
    await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: null });
    await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: null });
    const [first] = await live();

    expect(await finishUpgradeNow(TAG, first!.id)).toEqual({});

    const village = (await villageExportsFor(client, [MAIN])).get(MAIN)!.village;
    expect(village.buildings.find((b) => b.name === "Cannon")?.levels).toEqual({ 19: 2, 20: 1 });
    expect(village.appliedSince).toBe(1);
    expect(await live()).toHaveLength(1);

    // A builder is free again.
    expect(await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: null })).toEqual({});
  });

  it("cancels a timer without touching the base", async () => {
    await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: null });
    const [row] = await live();

    expect(await cancelUpgrade(TAG, row!.id)).toEqual({});
    expect(await live()).toHaveLength(0);
    const village = (await villageExportsFor(client, [MAIN])).get(MAIN)!.village;
    expect(village.buildings.find((b) => b.name === "Cannon")?.levels).toEqual({ 19: 3 });
  });

  it("does not accept a timer id that is not a UUID", async () => {
    expect((await finishUpgradeNow(TAG, "1; drop table tracked_upgrades")).error).toBe("That timer could not be found.");
    expect((await cancelUpgrade(TAG, "nope")).error).toBe("That timer could not be found.");
  });

  it("marks walls upgraded straight away, with no timer, and refuses more than there are", async () => {
    expect(await markAlreadyUpgraded(TAG, wall, 30)).toEqual({});
    const village = (await villageExportsFor(client, [MAIN])).get(MAIN)!.village;
    expect(village.buildings.find((b) => b.name === "Wall")?.levels).toEqual({ 16: 70, 17: 30 });
    expect(await live()).toHaveLength(0);

    expect((await markAlreadyUpgraded(TAG, wall, 71)).error).toMatch(/Only 70 can be upgraded/);
    expect((await markAlreadyUpgraded(TAG, wall, 0)).error).toBe("Choose how many were upgraded.");
  });

  it("asks for an export first when there is none", async () => {
    await h.asSuperuser();
    await h.db.exec(`truncate village_exports cascade`);
    await h.asUser(OWNER);
    const result = await startUpgrade(TAG, cannon, { boostPct: 0, secondsLeft: null });
    expect(result.error).toMatch(/Upload your village export first/);
  });
});
