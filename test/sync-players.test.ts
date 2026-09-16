// T11B.5 — the players sync, end to end against real Postgres.
//
// `fetch` is stubbed per tag rather than using USE_FIXTURES, because
// coc-client.ts maps EVERY `/players/{tag}` call to the single
// fixtures/player.json. With fixtures, three villages would return three
// identical responses, and "each village got its own reading" would pass while
// proving nothing. The fixture body is still what each stub returns — it is a
// real capture — with the tag swapped in.
//
// The ways this job can be confidently wrong, none of which raises an error:
//
//   1. a second run on the same day rewriting the first reading (R5)
//   2. an owned village outside every platform clan never being read, so its
//      owner's page stays empty forever
//   3. a departed village filed under the clan it left, so that clan's leaders
//      keep receiving its readings
//   4. one account the API no longer knows failing everybody else's reading
//   5. storing the game maximum where the Town Hall cap belongs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { runSyncJob } from "../scripts/sync/shared";
import { syncPlayers } from "../scripts/sync/players";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER = "11111111-0000-4000-8000-0000000000a2";

/** A member of clan A, owned by nobody. */
const MEMBER = "aaaaaaaa-0000-4000-8000-00000000f001";
/** A member of clan A who is also linked to USER. Must be read once, not twice. */
const OWNED_MEMBER = "aaaaaaaa-0000-4000-8000-00000000f002";
/** USER's village that has left every platform clan. */
const OWNED_GONE = "aaaaaaaa-0000-4000-8000-00000000f003";
/** Left clan A and owned by nobody. Nobody is asking for it any more. */
const DEPARTED = "aaaaaaaa-0000-4000-8000-00000000f004";

const TAGS = {
  [MEMBER]: "#PY0LQGRJ",
  [OWNED_MEMBER]: "#PY0LQGRC",
  [OWNED_GONE]: "#L2QYGJ9P",
  [DEPARTED]: "#8QUCLJY0",
};

const FIXTURE = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "player.json"), "utf8"),
) as Record<string, unknown>;

async function count(h: Harness, table: string, where = "true"): Promise<number> {
  const res = await h.db.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
  );
  return res.rows[0]!.n;
}

/** Answer `/players/{tag}` with the real fixture body, re-tagged, or 404. */
function respondFor(known: string[], calls: string[] = []) {
  process.env.USE_FIXTURES = "false";
  process.env.COC_API_TOKEN = "not-a-real-token";
  process.env.COC_THROTTLE_MS = "0";
  process.env.COC_BACKOFF_MS = "0";

  vi.stubGlobal("fetch", (url: string) => {
    const tag = decodeURIComponent(String(url).split("/players/")[1] ?? "");
    calls.push(tag);
    if (!known.includes(tag)) {
      return Promise.resolve(
        new Response(JSON.stringify({ reason: "notFound" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ ...FIXTURE, tag }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  return calls;
}

describe("T11B.5 — players sync", () => {
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
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await h.asSuperuser();
    await h.db.exec(`
      truncate player_progress, players, sync_log, clan_roles, users, clans cascade;
      delete from auth.users;
      insert into clans (id, tag, name) values ('${CLAN_A}', '#2PP0JCCL', 'Clan A');
      insert into auth.users (id, email) values ('${USER}', 'owner@example.com');
      insert into users (id, email, status) values ('${USER}', 'owner@example.com', 'approved');
      insert into players (id, clan_id, user_id, tag, name, left_at) values
        ('${MEMBER}',       '${CLAN_A}', null,      '${TAGS[MEMBER]}',       'Member',   null),
        ('${OWNED_MEMBER}', '${CLAN_A}', '${USER}', '${TAGS[OWNED_MEMBER]}', 'Main',     null),
        ('${OWNED_GONE}',   '${CLAN_A}', '${USER}', '${TAGS[OWNED_GONE]}',   'Old alt',  now()),
        ('${DEPARTED}',     '${CLAN_A}', null,      '${TAGS[DEPARTED]}',     'Departed', now());
    `);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const run = () => runSyncJob("players", (ctx) => syncPlayers(ctx), { client });
  const allKnown = Object.values(TAGS);

  it("reads every clan member and every owned village, each exactly once", async () => {
    const calls = respondFor(allKnown);
    expect(await run()).toBe("success");

    expect(calls.sort()).toEqual(
      [TAGS[MEMBER], TAGS[OWNED_MEMBER], TAGS[OWNED_GONE]].sort(),
    );
    expect(await count(h, "player_progress")).toBe(3);
  });

  // Risk 2 and risk 3 in one assertion.
  it("files an owned village that left every clan under no clan", async () => {
    respondFor(allKnown);
    await run();

    const rows = await h.db.query<{ player_id: string; clan_id: string | null }>(
      `select player_id, clan_id from player_progress order by player_id`,
    );
    expect(rows.rows).toEqual(
      [
        { player_id: MEMBER, clan_id: CLAN_A },
        { player_id: OWNED_MEMBER, clan_id: CLAN_A },
        { player_id: OWNED_GONE, clan_id: null },
      ].sort((a, b) => a.player_id.localeCompare(b.player_id)),
    );
    expect(await count(h, "player_progress", `player_id = '${DEPARTED}'`)).toBe(0);
  });

  // Risk 1.
  it("writes nothing on a second run the same day", async () => {
    respondFor(allKnown);
    await run();
    const before = await count(h, "player_progress");

    respondFor(allKnown);
    expect(await run()).toBe("success");
    expect(await count(h, "player_progress")).toBe(before);
  });

  // Risk 4.
  it("skips a village the API no longer knows and keeps the rest", async () => {
    respondFor([TAGS[MEMBER], TAGS[OWNED_GONE]]);
    expect(await run()).toBe("success");
    expect(await count(h, "player_progress")).toBe(2);
  });

  // Risk 5 — the whole reason src/data/game/ exists.
  it("stores the Town Hall cap alongside the game maximum", async () => {
    respondFor(allKnown);
    await run();

    const res = await h.db.query<{ th_level: number; bh_level: number; units: unknown }>(
      `select th_level, bh_level, units from player_progress where player_id = '${MEMBER}'`,
    );
    const row = res.rows[0]!;
    expect(row.th_level).toBe(17);
    expect(row.bh_level).toBe(10);

    const units = row.units as Array<Record<string, unknown>>;
    const king = units.find((u) => u.name === "Barbarian King")!;
    expect(king).toMatchObject({
      group: "hero",
      level: 100,
      apiMax: 110,
      cap: 100,
      capKnown: true,
    });

    const lassi = units.find((u) => u.name === "L.A.S.S.I")!;
    expect(lassi.group).toBe("pet");

    // Two Baby Dragons, one per village, both stored.
    const babies = units.filter((u) => u.name === "Baby Dragon").map((u) => u.village);
    expect(babies.sort()).toEqual(["builder", "home"]);
  });

  it("skips cleanly when there is nobody to read (R10)", async () => {
    await h.db.exec(`truncate player_progress, players cascade`);
    respondFor(allKnown);
    expect(await run()).toBe("skipped");
  });
});
