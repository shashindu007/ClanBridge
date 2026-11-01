// 074 — add_clan() and remove_clan().
//
// Other clans' finished lineups are what a leader stands to lose here, so the
// first thing these check is that nothing outside the one clan moves.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const OWNER = "11111111-0000-4000-8000-00000000000a";
const LEADER_A = "22222222-0000-4000-8000-00000000000a";
const COLEADER_A = "33333333-0000-4000-8000-00000000000a";
const LEADER_B = "44444444-0000-4000-8000-00000000000a";
const CLAN_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const CLAN_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ROSTER_A = "cccccccc-0000-4000-8000-00000000000a";
const ROSTER_B = "cccccccc-0000-4000-8000-00000000000b";
const PLAYER = "dddddddd-0000-4000-8000-00000000000a";

const SEASON = "2026-11";
const NEXT = "2026-12";
const NEW_TAG = "#2PP0JCCL";

describe("074 — adding and removing clans", () => {
  let h: Harness;

  async function addClan(seasons = [SEASON, NEXT], tag = NEW_TAG): Promise<string> {
    const list = seasons.map((s) => `'${s}'`).join(",");
    const res = await h.db.query<{ add_clan: string }>(
      `select add_clan('${tag}', 'New clan', array[${list}]::text[])`,
    );
    return res.rows[0]!.add_clan;
  }

  async function removeClan(clan: string): Promise<boolean> {
    const res = await h.db.query<{ remove_clan: boolean }>(`select remove_clan('${clan}')`);
    return res.rows[0]!.remove_clan;
  }

  async function count(table: string, where: string): Promise<number> {
    await h.asSuperuser();
    const res = await h.db.query<{ n: number }>(`select count(*)::int as n from ${table} where ${where}`);
    return res.rows[0]!.n;
  }

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.asSuperuser();
    await h.db.exec(`
      truncate cwl_roster_members, cwl_rosters, players, clan_roles, audit_log, users, clans cascade;
      delete from auth.users;

      insert into auth.users (id, email) values
        ('${OWNER}', 'owner@example.com'),
        ('${LEADER_A}', 'a@example.com'),
        ('${COLEADER_A}', 'co@example.com'),
        ('${LEADER_B}', 'b@example.com');
      insert into users (id, email, status) values
        ('${OWNER}', 'owner@example.com', 'pending'),
        ('${LEADER_A}', 'a@example.com', 'approved'),
        ('${COLEADER_A}', 'co@example.com', 'approved'),
        ('${LEADER_B}', 'b@example.com', 'approved');

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#8QUCLJY0', 'A'),
        ('${CLAN_B}', '#C2V89UGL', 'B');
      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER_A}', '${CLAN_A}', 'leader'),
        ('${COLEADER_A}', '${CLAN_A}', 'co-leader'),
        ('${LEADER_B}', '${CLAN_B}', 'leader');
      insert into players (id, clan_id, tag, name) values
        ('${PLAYER}', '${CLAN_A}', '#GJUUGRVCU', 'Picked');

      insert into cwl_rosters (id, clan_id, season, created_by, status) values
        ('${ROSTER_A}', '${CLAN_A}', '${SEASON}', '${LEADER_A}', 'published'),
        ('${ROSTER_B}', '${CLAN_B}', '${SEASON}', '${LEADER_B}', 'draft');
      insert into cwl_roster_members (roster_id, player_id, added_by) values
        ('${ROSTER_A}', '${PLAYER}', '${LEADER_A}');
    `);
    await h.asUser(OWNER);
    await h.db.query("select claim_platform_ownership()");
  });

  describe("add_clan", () => {
    it("gives a new clan a draft lineup for a season already started", async () => {
      expect(await addClan()).toBe("added");
      expect(
        await count(
          "cwl_rosters r join clans c on c.id = r.clan_id",
          `c.tag = '${NEW_TAG}' and r.season = '${SEASON}' and r.status = 'draft' and r.created_by = '${OWNER}'`,
        ),
      ).toBe(1);
    });

    it("does not start a season nobody has started", async () => {
      await addClan();
      expect(await count("cwl_rosters", `season = '${NEXT}'`)).toBe(0);
    });

    it("leaves every other clan's lineup exactly as it was", async () => {
      await h.asSuperuser();
      const before = await h.db.query(
        "select id, status, updated_at, created_by from cwl_rosters order by id",
      );
      const picks = await h.db.query("select id, roster_id, player_id, deleted_at from cwl_roster_members");

      await h.asUser(OWNER);
      await addClan();

      await h.asSuperuser();
      const after = await h.db.query(
        `select id, status, updated_at, created_by from cwl_rosters where clan_id in ('${CLAN_A}', '${CLAN_B}') order by id`,
      );
      expect(after.rows).toEqual(before.rows);
      expect((await h.db.query("select id, roster_id, player_id, deleted_at from cwl_roster_members")).rows).toEqual(
        picks.rows,
      );
    });

    it("reports a clan already here and changes nothing", async () => {
      expect(await addClan([SEASON], "#8QUCLJY0")).toBe("exists");
      expect(await count("audit_log", `action = 'add-clan'`)).toBe(0);
    });

    it("refuses anyone but the platform admin", async () => {
      await h.asUser(LEADER_A);
      expect(await addClan()).toBe("refused");
      expect(await count("clans", `tag = '${NEW_TAG}'`)).toBe(0);
    });
  });

  describe("remove_clan", () => {
    it("lets a leader remove their own clan, and audits it", async () => {
      await h.asUser(LEADER_A);
      expect(await removeClan(CLAN_A)).toBe(true);
      expect(await count("clans", `id = '${CLAN_A}' and deleted_at is not null`)).toBe(1);
      expect(await count("audit_log", `action = 'remove-clan' and user_id = '${LEADER_A}'`)).toBe(1);
    });

    it("lets the platform admin remove any clan", async () => {
      await h.asUser(OWNER);
      expect(await removeClan(CLAN_B)).toBe(true);
    });

    it("refuses a co-leader", async () => {
      await h.asUser(COLEADER_A);
      expect(await removeClan(CLAN_A)).toBe(false);
      expect(await count("clans", "deleted_at is not null")).toBe(0);
    });

    it("refuses a leader of another clan", async () => {
      await h.asUser(LEADER_B);
      expect(await removeClan(CLAN_A)).toBe(false);
      expect(await count("clans", "deleted_at is not null")).toBe(0);
    });

    it("leaves the other clans' lineups and roles alone", async () => {
      await h.asUser(LEADER_A);
      await removeClan(CLAN_A);
      expect(await count("cwl_rosters", `clan_id = '${CLAN_B}' and deleted_at is null`)).toBe(1);
      expect(await count("clan_roles", `clan_id = '${CLAN_B}' and deleted_at is null`)).toBe(1);
    });

    it("ends access through the role, deleting nothing", async () => {
      await h.asUser(LEADER_A);
      await removeClan(CLAN_A);
      const ids = await h.db.query("select auth_clan_ids()");
      expect(ids.rows).toEqual([]);
      expect(await count("clan_roles", `clan_id = '${CLAN_A}'`)).toBe(2);
      expect(await count("cwl_roster_members", `roster_id = '${ROSTER_A}' and deleted_at is null`)).toBe(1);
    });

    it("frees a picked player for another clan's lineup", async () => {
      await h.asUser(LEADER_A);
      await removeClan(CLAN_A);
      await h.asSuperuser();
      await expect(
        h.db.exec(
          `insert into cwl_roster_members (roster_id, player_id, added_by)
           values ('${ROSTER_B}', '${PLAYER}', '${LEADER_B}')`,
        ),
      ).resolves.not.toThrow();
    });
  });

  describe("adding a removed clan back", () => {
    beforeEach(async () => {
      await h.asUser(LEADER_A);
      await removeClan(CLAN_A);
      await h.asUser(OWNER);
    });

    it("brings back the clan, its roles and its lineup with the picks", async () => {
      expect(await addClan([SEASON], "#8QUCLJY0")).toBe("restored");
      expect(await count("clans", `id = '${CLAN_A}' and deleted_at is null`)).toBe(1);
      expect(await count("clan_roles", `clan_id = '${CLAN_A}' and deleted_at is null`)).toBe(2);
      expect(await count("cwl_rosters", `id = '${ROSTER_A}' and deleted_at is null and status = 'published'`)).toBe(1);
      expect(await count("cwl_roster_members", `roster_id = '${ROSTER_A}' and deleted_at is null`)).toBe(1);
    });

    it("does not revive a role that was retired before the removal", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `update clan_roles set deleted_at = deleted_at - interval '1 day' where user_id = '${COLEADER_A}'`,
      );
      await h.asUser(OWNER);
      await addClan([SEASON], "#8QUCLJY0");
      expect(await count("clan_roles", `user_id = '${COLEADER_A}' and deleted_at is null`)).toBe(0);
    });

    it("keeps a player picked elsewhere meanwhile off the restored lineup", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `insert into cwl_roster_members (roster_id, player_id, added_by)
         values ('${ROSTER_B}', '${PLAYER}', '${LEADER_B}')`,
      );
      await h.asUser(OWNER);
      await addClan([SEASON], "#8QUCLJY0");
      expect(await count("cwl_roster_members", `roster_id = '${ROSTER_B}' and deleted_at is null`)).toBe(1);
      expect(await count("cwl_roster_members", `roster_id = '${ROSTER_A}' and deleted_at is null`)).toBe(0);
    });
  });
});
