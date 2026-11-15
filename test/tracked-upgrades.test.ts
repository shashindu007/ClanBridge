// 079 — upgrade timers a member starts on Base details, through
// repositories/tracked-upgrades.ts.
//
// The same questions 076's test asks of the export — who CANNOT see a timer,
// and that the sync role cannot write one (R11) — plus the three things 079
// adds: the fold is atomic and refuses a stale tab, the live-row ceiling holds
// against a direct insert, and the prune removes only rows long since done.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { parseVillageExport } from "@/integration/village-export";
import { saveVillageExport, villageExportsFor } from "@/repositories/village-exports";
import {
  cancelTracked,
  finishTracked,
  foldTracked,
  insertTracked,
  resetTracked,
  trackedUpgradesFor,
  type NewTracked,
} from "@/repositories/tracked-upgrades";
import { applyTracked } from "@/services/village-overlay";
import type { ExportedVillage } from "@/types/village";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const OWNER = "11111111-0000-4000-8000-0000000000a2";
const LEADER = "22222222-0000-4000-8000-0000000000a3";
const MAIN = "44444444-0000-4000-8000-00000000001a";

const EXPORTED_AT = 1_789_000_000;

function exported(): ExportedVillage {
  const parsed = parseVillageExport(
    JSON.stringify({
      tag: "#PY0LQGRJ",
      timestamp: EXPORTED_AT,
      buildings: [
        { data: 1000001, lvl: 17 },
        { data: 1000015, lvl: 1, cnt: 5 },
        { data: 1000008, lvl: 19, cnt: 2 },
      ],
    }),
    new Date(EXPORTED_AT * 1000),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.village;
}

function cannon(endsInSeconds: number, now = new Date()): NewTracked {
  return {
    village: "home",
    subjectType: "building",
    subject: "Cannon",
    fromLevel: 19,
    workshop: "builders",
    boostPct: 0,
    startedAt: now,
    endsAt: new Date(now.getTime() + endsInSeconds * 1000),
  };
}

describe("079 — tracked_upgrades", () => {
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
      insert into auth.users (id, email) values
        ('${OWNER}',  'owner@example.com'),
        ('${LEADER}', 'leader@example.com');
      insert into users (id, email, status) values
        ('${OWNER}',  'owner@example.com',  'approved'),
        ('${LEADER}', 'leader@example.com', 'approved');
      insert into clan_roles (user_id, clan_id, role) values
        ('${OWNER}',  '${CLAN_A}', 'member'),
        ('${LEADER}', '${CLAN_A}', 'leader');
      insert into players (id, clan_id, user_id, tag, name, th_level, verified) values
        ('${MAIN}', '${CLAN_A}', '${OWNER}', '#PY0LQGRJ', 'Owner Main', 17, true);
    `);
    await h.asUser(OWNER);
    const saved = await saveVillageExport(client, MAIN, OWNER, exported());
    if (saved.error) throw new Error(String(saved.error.message));
  });

  it("lets the owner start, read, finish and cancel their own timers", async () => {
    await h.asUser(OWNER);
    expect((await insertTracked(client, MAIN, OWNER, cannon(3_600))).error).toBeNull();
    expect((await insertTracked(client, MAIN, OWNER, cannon(7_200))).error).toBeNull();

    const live = (await trackedUpgradesFor(client, [MAIN])).get(MAIN) ?? [];
    expect(live).toHaveLength(2);
    expect(live[0]).toMatchObject({ subject: "Cannon", fromLevel: 19, workshop: "builders" });

    expect((await cancelTracked(client, MAIN, live[0]!.id)).error).toBeNull();
    expect((await finishTracked(client, MAIN, live[1]!.id, new Date())).error).toBeNull();

    const after = (await trackedUpgradesFor(client, [MAIN])).get(MAIN) ?? [];
    expect(after.map((t) => t.id)).toEqual([live[1]!.id]);
  });

  it("shows nobody else a timer — not the clan's leader, not anonymous", async () => {
    await h.asUser(OWNER);
    await insertTracked(client, MAIN, OWNER, cannon(3_600));

    await h.asUser(LEADER);
    expect((await trackedUpgradesFor(client, [MAIN])).size).toBe(0);
    const onOwners = await insertTracked(client, MAIN, LEADER, cannon(3_600));
    expect(String(onOwners.error?.message)).toMatch(/row-level security/i);

    await h.asAnon();
    expect((await h.db.query(`select 1 from tracked_upgrades`)).rows).toHaveLength(0);
  });

  it("lets the sync role read and stamp notified_at, and nothing else (R11)", async () => {
    await h.asSuperuser();
    const res = await h.db.query<{ sel: boolean; ins: boolean; upd: boolean; notified: boolean; ends: boolean }>(
      `select has_table_privilege('service_role', 'tracked_upgrades', 'select') as sel,
              has_table_privilege('service_role', 'tracked_upgrades', 'insert') as ins,
              has_table_privilege('service_role', 'tracked_upgrades', 'update') as upd,
              has_column_privilege('service_role', 'tracked_upgrades', 'notified_at', 'update') as notified,
              has_column_privilege('service_role', 'tracked_upgrades', 'ends_at', 'update') as ends`,
    );
    expect(res.rows[0]).toEqual({ sel: true, ins: false, upd: false, notified: true, ends: false });

    const deletes = await h.db.query(
      `select grantee from information_schema.role_table_grants
        where table_name = 'tracked_upgrades' and privilege_type = 'DELETE'
          and grantee in ('anon', 'authenticated', 'service_role')`,
    );
    expect(deletes.rows).toEqual([]);
  });

  it("refuses a seventeenth live timer on one base, even inserted directly", async () => {
    await h.asUser(OWNER);
    for (let i = 0; i < 16; i++) {
      expect((await insertTracked(client, MAIN, OWNER, cannon(3_600 + i))).error).toBeNull();
    }
    const over = await insertTracked(client, MAIN, OWNER, cannon(3_600));
    expect(String(over.error?.message)).toMatch(/too many running upgrades/);
  });

  it("refuses a timer longer than 45 days", async () => {
    await h.asUser(OWNER);
    const long = await insertTracked(client, MAIN, OWNER, cannon(46 * 86_400));
    expect(String(long.error?.message)).toMatch(/tracked_upgrades_window/);
  });

  it("folds a finished timer into the export atomically, and refuses a stale tab", async () => {
    await h.asUser(OWNER);
    const start = new Date(Date.now() - 7_200_000);
    await insertTracked(client, MAIN, OWNER, cannon(3_600, start));

    const saved = (await villageExportsFor(client, [MAIN])).get(MAIN)!;
    const tracked = (await trackedUpgradesFor(client, [MAIN])).get(MAIN)!;
    const overlay = applyTracked(saved.village, tracked, new Date());
    expect(overlay.levelledUp).toEqual([{ name: "Cannon", village: "home", toLevel: 20, source: "tracked" }]);

    const first = await foldTracked(client, MAIN, saved.revision, overlay.stored, overlay.foldIds);
    expect(first).toEqual({ applied: true, error: null });

    const after = (await villageExportsFor(client, [MAIN])).get(MAIN)!;
    expect(after.revision).toBe(saved.revision + 1);
    expect(after.village.buildings.find((b) => b.name === "Cannon")?.levels).toEqual({ 19: 1, 20: 1 });
    expect((await trackedUpgradesFor(client, [MAIN])).get(MAIN)).toBeUndefined();

    // A second tab, holding the old revision, writes nothing.
    const stale = await foldTracked(client, MAIN, saved.revision, overlay.stored, overlay.foldIds);
    expect(stale).toEqual({ applied: false, error: null });
  });

  it("does not let another member fold into the owner's export", async () => {
    await h.asUser(OWNER);
    const saved = (await villageExportsFor(client, [MAIN])).get(MAIN)!;

    await h.asUser(LEADER);
    const folded = await foldTracked(client, MAIN, saved.revision, saved.village, []);
    expect(folded.applied).toBe(false);
  });

  it("retires timers started before a fresh export", async () => {
    await h.asUser(OWNER);
    await insertTracked(client, MAIN, OWNER, cannon(3_600, new Date(Date.now() - 60_000)));
    await insertTracked(client, MAIN, OWNER, cannon(3_600, new Date(Date.now() + 60_000)));

    expect((await resetTracked(client, MAIN, new Date())).error).toBeNull();
    expect((await trackedUpgradesFor(client, [MAIN])).get(MAIN)).toHaveLength(1);

    expect((await resetTracked(client, MAIN, null)).error).toBeNull();
    expect((await trackedUpgradesFor(client, [MAIN])).get(MAIN)).toBeUndefined();
  });

  it("prunes only rows done more than 30 days ago", async () => {
    await h.asSuperuser();
    await h.db.exec(`
      insert into tracked_upgrades
        (player_id, created_by, village, subject_type, subject, from_level, workshop, started_at, ends_at, folded_at, deleted_at)
      values
        ('${MAIN}', '${OWNER}', 'home', 'building', 'Cannon', 19, 'builders', now() - interval '40 days', now() - interval '39 days', now() - interval '35 days', null),
        ('${MAIN}', '${OWNER}', 'home', 'building', 'Cannon', 19, 'builders', now() - interval '40 days', now() - interval '39 days', null, now() - interval '31 days'),
        ('${MAIN}', '${OWNER}', 'home', 'building', 'Cannon', 19, 'builders', now() - interval '3 days', now() - interval '2 days', now() - interval '2 days', null),
        ('${MAIN}', '${OWNER}', 'home', 'building', 'Cannon', 19, 'builders', now(), now() + interval '1 day', null, null);
    `);

    await h.asServiceRole();
    const pruned = await h.db.query<{ n: number }>(`select prune_tracked_upgrades() as n`);
    expect(pruned.rows[0]?.n).toBe(2);

    await h.asSuperuser();
    expect((await h.db.query(`select 1 from tracked_upgrades`)).rows).toHaveLength(2);

    await h.asUser(OWNER);
    await expect(h.db.query(`select prune_tracked_upgrades()`)).rejects.toThrow(/permission denied/);
  });

  it("bumps the export's revision only when its village changes", async () => {
    await h.asUser(OWNER);
    const village = exported();
    await saveVillageExport(client, MAIN, OWNER, village);
    const before = (await villageExportsFor(client, [MAIN])).get(MAIN)!.revision;

    // The same village again: nothing moved, so a tab holding `before` may still fold.
    await saveVillageExport(client, MAIN, OWNER, village);
    expect((await villageExportsFor(client, [MAIN])).get(MAIN)!.revision).toBe(before);

    await saveVillageExport(client, MAIN, OWNER, { ...village, appliedSince: 3 });
    expect((await villageExportsFor(client, [MAIN])).get(MAIN)!.revision).toBe(before + 1);
  });
});
