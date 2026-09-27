// T11B.8 — repositories/player-progress.ts through the PGlite stand-in.
//
// The harness runs these as the superuser, so RLS is not what is under test
// here — 036's policies are (test/player-progress.test.ts). This is the
// repository's OWN filtering: that the clan scope really filters by clan, and
// that the two ends of the window are the right two rows.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { baseProgress, latestProgressFor } from "@/repositories/player-progress";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";
const PLAYER = "44444444-0000-4000-8000-00000000001a";

const NOW = new Date("2026-09-16T12:00:00Z");

const units = (level: number) =>
  JSON.stringify([
    { name: "Archer", level, apiMax: 14, village: "home", group: "elixirTroop", cap: 12, capKnown: true },
  ]);

describe("baseProgress", () => {
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
      truncate player_progress, players, clans cascade;
      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#20PP0JCC', 'Clan B');
      insert into players (id, clan_id, tag, name) values
        ('${PLAYER}', '${CLAN_B}', '#PY0LQGRJ', 'Mover');

      -- Read in clan A long ago and inside the window, then moved to clan B.
      insert into player_progress (player_id, clan_id, captured_at, th_level, units) values
        ('${PLAYER}', '${CLAN_A}', '2026-06-01T06:00:00Z', 12, '${units(5)}'),
        ('${PLAYER}', '${CLAN_A}', '2026-08-25T06:00:00Z', 13, '${units(8)}'),
        ('${PLAYER}', '${CLAN_B}', '2026-09-10T06:00:00Z', 13, '${units(10)}'),
        ('${PLAYER}', '${CLAN_B}', '2026-09-16T06:00:00Z', 14, '${units(11)}');
    `);
  });

  it("gives the owner the newest reading and the oldest inside 30 days, across clans", async () => {
    const result = await baseProgress(client, "owner", PLAYER, NOW);
    expect(result.latest).toMatchObject({ capturedAt: expect.stringContaining("2026-09-16"), thLevel: 14 });
    expect(result.latest!.units[0]!.level).toBe(11);
    // 2026-08-25 is inside the window; 2026-06-01 is not.
    expect(result.baseline!.units[0]!.level).toBe(8);
  });

  // R3. A leader of clan A sees what was read while the village was theirs,
  // and nothing it did after it left.
  it("confines a clan scope to readings taken in that clan", async () => {
    const result = await baseProgress(client, { clanId: CLAN_A }, PLAYER, NOW);
    expect(result.latest!.thLevel).toBe(13);
    expect(result.latest!.units[0]!.level).toBe(8);
    // Only one clan-A reading in the window, so there is nothing to compare.
    expect(result.baseline).toBeNull();
  });

  it("reports no readings as null rather than an empty reading", async () => {
    const result = await baseProgress(client, { clanId: CLAN_A }, "99999999-0000-4000-8000-000000000000", NOW);
    expect(result).toEqual({ latest: null, baseline: null });
  });
});

// 049 — the lineup builder's one read for the whole pool.
describe("latestProgressFor", () => {
  let h: Harness;
  let client: SupabaseClient;
  const OTHER = "44444444-0000-4000-8000-00000000002b";

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
  });
  afterAll(async () => {
    await h?.close();
  });

  it("takes each village's newest reading and summarises heroes and progress", async () => {
    await h.asSuperuser();
    const heroes = (bk: number) =>
      JSON.stringify([
        { name: "Barbarian King", level: bk, apiMax: 100, village: "home", group: "hero", cap: 90, capKnown: true },
        { name: "Archer Queen", level: 90, apiMax: 100, village: "home", group: "hero", cap: 90, capKnown: true },
        { name: "Archer", level: 12, apiMax: 14, village: "home", group: "elixirTroop", cap: 12, capKnown: true },
      ]);
    await h.db.exec(`
      truncate player_progress, players, clans cascade;
      insert into clans (id, tag, name) values ('${CLAN_A}', '#2PP0JCCL', 'Clan A');
      insert into players (id, clan_id, tag, name) values
        ('${PLAYER}', '${CLAN_A}', '#PY0LQGRJ', 'One'),
        ('${OTHER}', '${CLAN_A}', '#PY0LQGRL', 'Never read');
      insert into player_progress (player_id, clan_id, captured_at, th_level, units) values
        ('${PLAYER}', '${CLAN_A}', '2026-09-01T06:00:00Z', 15, '${heroes(60)}'),
        ('${PLAYER}', '${CLAN_A}', '2026-09-20T06:00:00Z', 16, '${heroes(90)}');
    `);

    // 051 is a family-guarded definer: the service role sees every village.
    await h.asServiceRole();
    const map = await latestProgressFor(client, [PLAYER, OTHER]);
    expect(map.has(OTHER)).toBe(false);
    const snap = map.get(PLAYER)!;
    expect(snap.thLevel).toBe(16);
    expect(snap.heroes.map((x) => `${x.short}${x.level}`)).toEqual(["BK90", "AQ90"]);
    expect(snap.heroPct).toBe(100);
    expect(snap.maxPct).toBe(100);
  });
});
