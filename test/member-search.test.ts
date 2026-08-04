// T3B.6 — searchPlayers against real Postgres.
//
// test/authorisation.test.ts already proves the NET: RLS refuses another clan's
// rows even to a query with no clan in it. This file proves the MECHANISM, which
// R3 says is the part that must not be missing — the search itself scopes every
// query to a clan the caller was handed, rather than running one unscoped query
// and trusting the policy to clean up after it.
//
// The two are deliberately separate. A regression that removed the clan filter
// would leave authorisation.test.ts green, because RLS would still hold; only a
// test at this level notices.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { searchPlayers } from "../src/repositories/members";

const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000001";

describe("T3B.6 — searchPlayers", () => {
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
    // Superuser: this file is testing the query, not the policy. RLS is
    // authorisation.test.ts's subject, and leaving it on here would mask a
    // missing clan filter behind a policy that happens to catch it.
    await h.asSuperuser();
    await h.db.exec(`
      truncate member_snapshots, players, clans cascade;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#2PP0JCCQ', 'Clan B');

      -- Similar names across both clans, so a missing filter is unmistakable.
      insert into players (clan_id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCU', 'Riya'),
        ('${CLAN_A}', '#2PP0JCCY', 'Riyaz'),
        ('${CLAN_B}', '#2PP0JCCV', 'Riya B'),
        ('${CLAN_A}', '#2PP0JCC9', '100% Pure'),
        ('${CLAN_A}', '#2PP0JCC8', 'Departed One');

      update players set left_at = now() where name = 'Departed One';
    `);
  });

  it("searches only the clans it was given", async () => {
    const hits = await searchPlayers(client, [CLAN_A], "Riya");
    expect(hits.map((h) => h.name).sort()).toEqual(["Riya", "Riyaz"]);
  });

  it("spans several clans when given several", async () => {
    const hits = await searchPlayers(client, [CLAN_A, CLAN_B], "Riya");
    expect(hits).toHaveLength(3);
    // Every hit carries the clan it came from, so the page can link correctly
    // rather than guessing from the current route.
    expect(new Set(hits.map((h) => h.clanId))).toEqual(new Set([CLAN_A, CLAN_B]));
  });

  it("returns nothing when given no clans, rather than everything", async () => {
    // The failure mode worth naming: an empty clan list must mean "search
    // nothing", never "no filter, so search all".
    expect(await searchPlayers(client, [], "Riya")).toEqual([]);
  });

  it("is case insensitive on names", async () => {
    const hits = await searchPlayers(client, [CLAN_A], "riya");
    expect(hits).toHaveLength(2);
  });

  it("matches a tag exactly, and case insensitively", async () => {
    expect(await searchPlayers(client, [CLAN_A], "#2pp0jccu")).toHaveLength(1);
    // A partial tag is not a query — matching it loosely would also make this an
    // enumeration tool.
    expect(await searchPlayers(client, [CLAN_A], "#2PP0")).toHaveLength(0);
  });

  it("treats % in a name as a literal, not a wildcard", async () => {
    // Without escaping, '%' matches everything and this returns the whole clan.
    const hits = await searchPlayers(client, [CLAN_A], "100%");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe("100% Pure");
  });

  it("treats a bare % as a literal too, so it cannot list the clan", async () => {
    const hits = await searchPlayers(client, [CLAN_A], "%");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.name).toBe("100% Pure");
  });

  it("includes former members, flagged", async () => {
    // R4 — they are not deleted, and finding someone who just left is a normal
    // reason to search.
    const hits = await searchPlayers(client, [CLAN_A], "Departed");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.leftAt).not.toBeNull();
  });

  it("ignores an empty or whitespace-only term", async () => {
    expect(await searchPlayers(client, [CLAN_A], "")).toEqual([]);
    expect(await searchPlayers(client, [CLAN_A], "   ")).toEqual([]);
  });
});
