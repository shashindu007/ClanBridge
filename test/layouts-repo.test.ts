// T8.4 — the library's reads, against real Postgres.
//
// The schema rules are in layouts-schema.test.ts; this covers the layer the
// pages actually call, and three things it has to get right:
//
//   1. RANKED BY VOTES. The point of T8.5 is that the clan's opinion decides
//      what appears first. Ascending order still returns rows, still renders a
//      grid, and is exactly backwards.
//
//   2. FILTERS COMPOSE. TH and type are separate controls and a member will use
//      both. Applying only the last one set is the easy bug.
//
//   3. votedByMe IS PER CALLER. It drives whether the button says Vote or
//      Voted, so resolving it for the wrong member makes the whole control lie.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { addLayout, layoutsForClan, removeLayout } from "@/repositories/layouts";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";
const USER_A = "11111111-0000-4000-8000-0000000000a2";
const USER_A2 = "22222222-0000-4000-8000-0000000000a3";
const USER_B = "33333333-0000-4000-8000-0000000000b2";
const PLAYER_A = "44444444-0000-4000-8000-0000000000a4";

const WAR_15 = "55555555-0000-4000-8000-000000000001";
const FARM_15 = "55555555-0000-4000-8000-000000000002";
const WAR_14 = "55555555-0000-4000-8000-000000000003";
const OTHER_CLAN = "55555555-0000-4000-8000-000000000004";

describe("layoutsForClan (T8.4)", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
    await h.asSuperuser();
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.db.exec(`
      delete from base_layout_votes;
      delete from base_layouts;
      delete from clan_roles;
      delete from players;
      delete from users;
      delete from auth.users;
      delete from clans;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#20PP0JCC', 'Clan B');

      insert into auth.users (id, email) values
        ('${USER_A}',  'a@example.com'),
        ('${USER_A2}', 'a2@example.com'),
        ('${USER_B}',  'b@example.com');

      insert into users (id, email, status) values
        ('${USER_A}',  'a@example.com',  'approved'),
        ('${USER_A2}', 'a2@example.com', 'approved'),
        ('${USER_B}',  'b@example.com',  'approved');

      insert into clan_roles (user_id, clan_id, role) values
        ('${USER_A}',  '${CLAN_A}', 'member'),
        ('${USER_A2}', '${CLAN_A}', 'member'),
        ('${USER_B}',  '${CLAN_B}', 'member');

      -- USER_A has a linked player, so their name resolves. USER_A2 does not,
      -- which is the unverified case the page renders as "a member".
      insert into players (id, clan_id, user_id, tag, name) values
        ('${PLAYER_A}', '${CLAN_A}', '${USER_A}', '#22PJ000', 'Ann');

      insert into base_layouts
        (id, clan_id, uploaded_by, th_level, layout_type, copy_link, votes) values
        ('${WAR_15}',     '${CLAN_A}', '${USER_A}',  15, 'war',     'https://link.clashofclans.com/1', 2),
        ('${FARM_15}',    '${CLAN_A}', '${USER_A2}', 15, 'farming', 'https://link.clashofclans.com/2', 9),
        ('${WAR_14}',     '${CLAN_A}', '${USER_A}',  14, 'war',     'https://link.clashofclans.com/3', 5),
        ('${OTHER_CLAN}', '${CLAN_B}', '${USER_B}',  15, 'war',     'https://link.clashofclans.com/4', 99);
    `);
  });

  it("returns only this clan's layouts (R3)", async () => {
    const rows = await layoutsForClan(client, CLAN_A, USER_A);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.id)).not.toContain(OTHER_CLAN);
  });

  // Ascending still returns rows and still renders a grid. It is simply the
  // opposite of what voting is for.
  it("ranks by votes, highest first", async () => {
    const rows = await layoutsForClan(client, CLAN_A, USER_A);
    expect(rows.map((r) => r.votes)).toEqual([9, 5, 2]);
  });

  it("filters by Town Hall level", async () => {
    const rows = await layoutsForClan(client, CLAN_A, USER_A, { thLevel: 14 });
    expect(rows.map((r) => r.id)).toEqual([WAR_14]);
  });

  it("filters by type", async () => {
    const rows = await layoutsForClan(client, CLAN_A, USER_A, { layoutType: "farming" });
    expect(rows.map((r) => r.id)).toEqual([FARM_15]);
  });

  // Both controls exist on the page and a member will use both.
  it("composes the two filters rather than applying the last one", async () => {
    const rows = await layoutsForClan(client, CLAN_A, USER_A, {
      thLevel: 15,
      layoutType: "war",
    });
    expect(rows.map((r) => r.id)).toEqual([WAR_15]);
  });

  it("returns nothing when the filter matches nothing", async () => {
    const rows = await layoutsForClan(client, CLAN_A, USER_A, { thLevel: 9 });
    expect(rows).toEqual([]);
  });

  it("resolves the uploader's name, and leaves it null when unverified", async () => {
    const rows = await layoutsForClan(client, CLAN_A, USER_A);
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(WAR_15)!.uploaderName).toBe("Ann");
    // No players row for USER_A2 — the page shows "a member" rather than an
    // email address in a shared library.
    expect(byId.get(FARM_15)!.uploaderName).toBeNull();
  });

  describe("votedByMe", () => {
    beforeEach(async () => {
      await h.db.exec(
        `insert into base_layout_votes (layout_id, user_id)
         values ('${WAR_15}', '${USER_A}');`,
      );
    });

    it("is true only for the caller's own live vote", async () => {
      const mine = await layoutsForClan(client, CLAN_A, USER_A);
      expect(mine.find((r) => r.id === WAR_15)!.votedByMe).toBe(true);
      expect(mine.find((r) => r.id === WAR_14)!.votedByMe).toBe(false);

      // The same layout, a different member: the button must say Vote.
      const theirs = await layoutsForClan(client, CLAN_A, USER_A2);
      expect(theirs.find((r) => r.id === WAR_15)!.votedByMe).toBe(false);
    });

    // R4 — a withdrawn vote leaves a tombstone. Counting it would leave the
    // button stuck on "Voted" with no way back.
    it("ignores a withdrawn vote", async () => {
      await h.db.exec(
        `update base_layout_votes set deleted_at = now()
          where layout_id = '${WAR_15}' and user_id = '${USER_A}';`,
      );

      const rows = await layoutsForClan(client, CLAN_A, USER_A);
      expect(rows.find((r) => r.id === WAR_15)!.votedByMe).toBe(false);
    });
  });

  it("hides a soft-deleted layout (R4)", async () => {
    await h.db.exec(`update base_layouts set deleted_at = now() where id = '${WAR_15}';`);
    const rows = await layoutsForClan(client, CLAN_A, USER_A);
    expect(rows.map((r) => r.id)).not.toContain(WAR_15);
  });

  it("returns an empty list for a clan with no layouts", async () => {
    await h.db.exec(`delete from base_layouts;`);
    expect(await layoutsForClan(client, CLAN_A, USER_A)).toEqual([]);
  });
});

describe("addLayout and removeLayout", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
    await h.asSuperuser();
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.db.exec(`
      delete from base_layouts;
      delete from clan_roles;
      delete from users;
      delete from auth.users;
      delete from clans;

      insert into clans (id, tag, name) values ('${CLAN_A}', '#2PP0JCCL', 'Clan A');
      insert into auth.users (id, email) values ('${USER_A}', 'a@example.com');
      insert into users (id, email, status) values ('${USER_A}', 'a@example.com', 'approved');
      insert into clan_roles (user_id, clan_id, role) values ('${USER_A}', '${CLAN_A}', 'member');
    `);
  });

  it("inserts and returns the new id", async () => {
    const result = await addLayout(client, {
      clanId: CLAN_A,
      uploadedBy: USER_A,
      thLevel: 15,
      layoutType: "war",
      copyLink: "https://link.clashofclans.com/x",
      imageUrl: `${CLAN_A}/abc.jpg`,
      description: "Anti-3-star",
    });

    expect(result.error).toBeUndefined();
    expect(result.id).toBeTruthy();
  });

  it("refuses a layout type outside the CHECK constraint", async () => {
    const result = await addLayout(client, {
      clanId: CLAN_A,
      uploadedBy: USER_A,
      thLevel: 15,
      // Past the TypeScript type on purpose — the database is the backstop for
      // a value that reached the action from somewhere other than the form.
      layoutType: "cwl" as never,
      copyLink: "https://link.clashofclans.com/x",
      imageUrl: null,
      description: null,
    });

    expect(result.error).toBeTruthy();
  });

  // R4 — removal is deleted_at, never a DELETE.
  it("soft deletes, leaving the row in place", async () => {
    const { id } = await addLayout(client, {
      clanId: CLAN_A,
      uploadedBy: USER_A,
      thLevel: 15,
      layoutType: "war",
      copyLink: "https://link.clashofclans.com/x",
      imageUrl: null,
      description: null,
    });

    expect((await removeLayout(client, CLAN_A, id!)).error).toBeUndefined();

    const res = await h.db.query<{ n: number; deleted: number }>(
      `select count(*)::int as n,
              count(deleted_at)::int as deleted
         from base_layouts where id = '${id}'`,
    );
    expect(res.rows[0]!.n).toBe(1);
    expect(res.rows[0]!.deleted).toBe(1);
  });

  // R3 — the clan filter is in the query, not only in the policy.
  it("will not remove a layout through the wrong clan id", async () => {
    const { id } = await addLayout(client, {
      clanId: CLAN_A,
      uploadedBy: USER_A,
      thLevel: 15,
      layoutType: "war",
      copyLink: "https://link.clashofclans.com/x",
      imageUrl: null,
      description: null,
    });

    await removeLayout(client, CLAN_B, id!);

    const res = await h.db.query<{ deleted: number }>(
      `select count(deleted_at)::int as deleted from base_layouts where id = '${id}'`,
    );
    expect(res.rows[0]!.deleted).toBe(0);
  });
});
