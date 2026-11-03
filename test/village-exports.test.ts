// 076 — a member's saved village export, through repositories/village-exports.ts.
//
// The export is the member's own game data: building levels, walls, timers. So
// the assertions that matter most are about who CANNOT see it — a clanmate, a
// leader of the clan the village plays in, an anonymous request — and that the
// sync role cannot write it (R11, the REVOKE in 076, for 033's reason).
//
// Every write goes through the repository, as the Server Action's does, so what
// is proved is the path a page actually takes.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { parseVillageExport } from "@/integration/village-export";
import { clearVillageExport, saveVillageExport, villageExportsFor } from "@/repositories/village-exports";
import type { ExportedVillage } from "@/types/village";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";

/** Owns MAIN. A plain member of clan A. */
const OWNER = "11111111-0000-4000-8000-0000000000a2";
/** Leads clan A, where MAIN plays. Must still see nothing of the export. */
const LEADER = "22222222-0000-4000-8000-0000000000a3";

const MAIN = "44444444-0000-4000-8000-00000000001a";
const LEADERS_BASE = "66666666-0000-4000-8000-00000000001c";

function exported(tag: string, timestamp: number): ExportedVillage {
  const parsed = parseVillageExport(
    JSON.stringify({
      tag,
      timestamp,
      buildings: [
        { data: 1000001, lvl: 17 },
        { data: 1000010, lvl: 17, cnt: 200 },
        { data: 1000008, lvl: 20, cnt: 1, timer: 7_200 },
      ],
    }),
    new Date(timestamp * 1000),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.village;
}

describe("076 — village_exports", () => {
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
      truncate village_exports, clan_roles, players, users, clans cascade;
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
        ('${MAIN}',         '${CLAN_A}', '${OWNER}',  '#PY0LQGRJ', 'Owner Main', 17, true),
        ('${LEADERS_BASE}', '${CLAN_A}', '${LEADER}', '#L2QYGJ9P', 'Leader',     17, true);
    `);
  });

  it("lets the owner save an export and read it back whole", async () => {
    await h.asUser(OWNER);
    const village = exported("#PY0LQGRJ", 1_789_000_000);
    expect((await saveVillageExport(client, MAIN, OWNER, village)).error).toBeNull();

    const saved = (await villageExportsFor(client, [MAIN])).get(MAIN);
    expect(saved?.exportedAt).toBe(village.exportedAt);
    expect(saved?.village.tag).toBe("#PY0LQGRJ");
    expect(saved?.village.buildings.find((b) => b.name === "Wall")?.levels).toEqual({ 17: 200 });
    expect(saved?.village.upgrades).toHaveLength(1);
  });

  it("replaces in one statement, and revives a removed export (R4)", async () => {
    await h.asUser(OWNER);
    await saveVillageExport(client, MAIN, OWNER, exported("#PY0LQGRJ", 1_789_000_000));
    await saveVillageExport(client, MAIN, OWNER, exported("#PY0LQGRJ", 1_789_100_000));
    expect((await villageExportsFor(client, [MAIN])).get(MAIN)?.exportedAt).toBe(
      new Date(1_789_100_000 * 1000).toISOString(),
    );

    expect((await clearVillageExport(client, MAIN)).error).toBeNull();
    expect((await villageExportsFor(client, [MAIN])).has(MAIN)).toBe(false);

    await saveVillageExport(client, MAIN, OWNER, exported("#PY0LQGRJ", 1_789_200_000));
    expect((await villageExportsFor(client, [MAIN])).has(MAIN)).toBe(true);

    await h.asSuperuser();
    const rows = await h.db.query(`select 1 from village_exports`);
    expect(rows.rows).toHaveLength(1);
  });

  it("shows the export to nobody else — not even the clan's leader", async () => {
    await h.asUser(OWNER);
    await saveVillageExport(client, MAIN, OWNER, exported("#PY0LQGRJ", 1_789_000_000));

    // LEADER can read MAIN's player row (clan A); the export stays private.
    await h.asUser(LEADER);
    expect((await villageExportsFor(client, [MAIN])).size).toBe(0);

    await h.asAnon();
    const anon = await h.db.query(`select 1 from village_exports`);
    expect(anon.rows).toHaveLength(0);
  });

  it("refuses an export saved onto somebody else's base, or in somebody else's name", async () => {
    await h.asUser(LEADER);
    const onOwners = await saveVillageExport(client, MAIN, LEADER, exported("#PY0LQGRJ", 1_789_000_000));
    expect(String(onOwners.error?.message)).toMatch(/row-level security/i);

    await h.asUser(OWNER);
    const asLeader = await saveVillageExport(client, MAIN, LEADER, exported("#PY0LQGRJ", 1_789_000_000));
    expect(String(asLeader.error?.message)).toMatch(/row-level security/i);
  });

  it("does not let another member remove the owner's export", async () => {
    await h.asUser(OWNER);
    await saveVillageExport(client, MAIN, OWNER, exported("#PY0LQGRJ", 1_789_000_000));

    // UPDATE under RLS filters the row out rather than raising.
    await h.asUser(LEADER);
    await clearVillageExport(client, MAIN);

    await h.asUser(OWNER);
    expect((await villageExportsFor(client, [MAIN])).has(MAIN)).toBe(true);
  });

  it("lets the sync role read but never write (R11), and grants nobody a delete (R4)", async () => {
    await h.asSuperuser();
    const res = await h.db.query<{ sel: boolean; ins: boolean; upd: boolean }>(
      `select has_table_privilege('service_role', 'village_exports', 'select') as sel,
              has_table_privilege('service_role', 'village_exports', 'insert') as ins,
              has_table_privilege('service_role', 'village_exports', 'update') as upd`,
    );
    expect(res.rows[0]).toEqual({ sel: true, ins: false, upd: false });

    const deletes = await h.db.query(
      `select grantee from information_schema.role_table_grants
        where table_name = 'village_exports' and privilege_type = 'DELETE'
          and grantee in ('anon', 'authenticated', 'service_role')`,
    );
    expect(deletes.rows).toEqual([]);
  });

  it("refuses a village that is not a JSON object", async () => {
    await h.asSuperuser();
    await expect(
      h.db.query(
        `insert into village_exports (player_id, uploaded_by, exported_at, village)
         values ($1, $2, now(), '[]')`,
        [MAIN, OWNER],
      ),
    ).rejects.toThrow(/village_exports_village_shape/);
  });
});
