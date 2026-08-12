// Phase 8 / migration 028 — the layout library at the database layer.
//
// Four things here are worth more than the rest:
//
//   1. ONE VOTE PER MEMBER, enforced by a partial unique index rather than by
//      the page. Without it every vote button is a +1 button and the ranking
//      measures who cared most rather than what the clan thinks.
//
//   2. THE COUNTER AND THE ROWS CANNOT COME APART. base_layouts.votes is a
//      cache; the definer functions move it and the vote row in one statement.
//      A page doing it in two can be interrupted between, leaving a score that
//      disagrees with the number of voters and nothing to say which is right.
//
//   3. A WITHDRAWN VOTE CAN BE CAST AGAIN (R4). The tombstone stays, and the
//      index's `where deleted_at is null` is what stops it blocking a re-vote.
//
//   4. ANOTHER CLAN'S LAYOUT IS "NOT FOUND", NOT "FORBIDDEN". A distinct error
//      would confirm the id exists (R3).

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";
const MEMBER_A = "11111111-0000-4000-8000-0000000000a2";
const OTHER_A = "22222222-0000-4000-8000-0000000000a3";
const MEMBER_B = "33333333-0000-4000-8000-0000000000b2";
const LAYOUT_A = "44444444-0000-4000-8000-00000000001a";
const LAYOUT_B = "55555555-0000-4000-8000-00000000001b";

describe("Phase 8 — the layout library (028)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.asSuperuser();
    await h.db.exec(`
      delete from audit_log;
      delete from base_layout_votes;
      delete from base_layouts;
      delete from clan_roles;
      delete from users;
      delete from auth.users;
      delete from clans;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#20PP0JCC', 'Clan B');

      insert into auth.users (id, email) values
        ('${MEMBER_A}', 'a@example.com'),
        ('${OTHER_A}',  'a2@example.com'),
        ('${MEMBER_B}', 'b@example.com');

      insert into users (id, email, status) values
        ('${MEMBER_A}', 'a@example.com',  'approved'),
        ('${OTHER_A}',  'a2@example.com', 'approved'),
        ('${MEMBER_B}', 'b@example.com',  'approved');

      insert into clan_roles (user_id, clan_id, role) values
        ('${MEMBER_A}', '${CLAN_A}', 'member'),
        ('${OTHER_A}',  '${CLAN_A}', 'member'),
        ('${MEMBER_B}', '${CLAN_B}', 'member');

      insert into base_layouts (id, clan_id, uploaded_by, th_level, layout_type, copy_link)
      values
        ('${LAYOUT_A}', '${CLAN_A}', '${MEMBER_A}', 15, 'war',
         'https://link.clashofclans.com/a'),
        ('${LAYOUT_B}', '${CLAN_B}', '${MEMBER_B}', 14, 'farming',
         'https://link.clashofclans.com/b');
    `);
  });

  /** The vote counter as stored on the layout row. */
  async function counter(layout: string): Promise<number> {
    const res = await h.db.query<{ votes: number }>(
      `select votes from base_layouts where id = $1`,
      [layout],
    );
    return res.rows[0]!.votes;
  }

  /** Live vote rows for a layout — the tombstones excluded, as the index sees it. */
  async function liveVotes(layout: string): Promise<number> {
    const res = await h.db.query<{ n: number }>(
      `select count(*)::int as n from base_layout_votes
        where layout_id = $1 and deleted_at is null`,
      [layout],
    );
    return res.rows[0]!.n;
  }

  describe("vote_for_layout", () => {
    it("records a vote and moves the counter with it", async () => {
      await h.asUser(MEMBER_A);
      const res = await h.db.query<{ vote_for_layout: number }>(
        `select vote_for_layout('${LAYOUT_A}')`,
      );

      expect(res.rows[0]!.vote_for_layout).toBe(1);
      await h.asSuperuser();
      expect(await counter(LAYOUT_A)).toBe(1);
      expect(await liveVotes(LAYOUT_A)).toBe(1);
    });

    // The reason the table exists. A double-tap on a phone is not a mistake
    // worth showing somebody, so this is a no-op rather than an error.
    it("is idempotent — voting twice leaves one vote", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(`select vote_for_layout('${LAYOUT_A}')`);
      const res = await h.db.query<{ vote_for_layout: number }>(
        `select vote_for_layout('${LAYOUT_A}')`,
      );

      expect(res.rows[0]!.vote_for_layout).toBe(1);
      await h.asSuperuser();
      expect(await counter(LAYOUT_A)).toBe(1);
      expect(await liveVotes(LAYOUT_A)).toBe(1);
    });

    it("counts different members separately", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(`select vote_for_layout('${LAYOUT_A}')`);
      await h.asUser(OTHER_A);
      const res = await h.db.query<{ vote_for_layout: number }>(
        `select vote_for_layout('${LAYOUT_A}')`,
      );

      expect(res.rows[0]!.vote_for_layout).toBe(2);
      await h.asSuperuser();
      expect(await liveVotes(LAYOUT_A)).toBe(2);
    });

    // R3. "not found" rather than "forbidden" is deliberate — a distinct error
    // would confirm the id exists.
    it("refuses another clan's layout, and does not admit it exists", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.query(`select vote_for_layout('${LAYOUT_B}')`),
      ).rejects.toThrow(/layout not found/);

      await h.asSuperuser();
      expect(await counter(LAYOUT_B)).toBe(0);
    });

    it("refuses a layout that does not exist at all, with the same message", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.query(`select vote_for_layout('99999999-0000-4000-8000-000000000999')`),
      ).rejects.toThrow(/layout not found/);
    });

    it("refuses a soft-deleted layout", async () => {
      await h.asSuperuser();
      await h.db.exec(`update base_layouts set deleted_at = now() where id = '${LAYOUT_A}';`);

      await h.asUser(MEMBER_A);
      await expect(
        h.db.query(`select vote_for_layout('${LAYOUT_A}')`),
      ).rejects.toThrow(/layout not found/);
    });

    it("writes an audit_log row for the vote (R4)", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(`select vote_for_layout('${LAYOUT_A}')`);

      await h.asSuperuser();
      const res = await h.db.query<{ action: string; clan_id: string }>(
        `select action, clan_id from audit_log where entity = 'base_layouts'`,
      );
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0]!.action).toBe("vote");
      expect(res.rows[0]!.clan_id).toBe(CLAN_A);
    });
  });

  describe("unvote_layout", () => {
    it("withdraws the vote and drops the counter", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(`select vote_for_layout('${LAYOUT_A}')`);
      const res = await h.db.query<{ unvote_layout: number }>(
        `select unvote_layout('${LAYOUT_A}')`,
      );

      expect(res.rows[0]!.unvote_layout).toBe(0);
      await h.asSuperuser();
      expect(await counter(LAYOUT_A)).toBe(0);
      expect(await liveVotes(LAYOUT_A)).toBe(0);
    });

    // R4 — the row stays. This is what the partial index has to tolerate.
    it("keeps the row as a tombstone rather than deleting it", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(`select vote_for_layout('${LAYOUT_A}')`);
      await h.db.query(`select unvote_layout('${LAYOUT_A}')`);

      await h.asSuperuser();
      const res = await h.db.query<{ n: number }>(
        `select count(*)::int as n from base_layout_votes where layout_id = '${LAYOUT_A}'`,
      );
      expect(res.rows[0]!.n).toBe(1);
    });

    // The bug the partial index exists to prevent: a member who unvotes once
    // could never vote again, because the tombstone collided with the new row.
    it("lets the same member vote again afterwards", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(`select vote_for_layout('${LAYOUT_A}')`);
      await h.db.query(`select unvote_layout('${LAYOUT_A}')`);
      const res = await h.db.query<{ vote_for_layout: number }>(
        `select vote_for_layout('${LAYOUT_A}')`,
      );

      expect(res.rows[0]!.vote_for_layout).toBe(1);
      await h.asSuperuser();
      expect(await liveVotes(LAYOUT_A)).toBe(1);
      // Still one row — revived, not duplicated.
      const rows = await h.db.query<{ n: number }>(
        `select count(*)::int as n from base_layout_votes where layout_id = '${LAYOUT_A}'`,
      );
      expect(rows.rows[0]!.n).toBe(1);
    });

    it("is idempotent, and the counter never goes negative", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(`select unvote_layout('${LAYOUT_A}')`);
      const res = await h.db.query<{ unvote_layout: number }>(
        `select unvote_layout('${LAYOUT_A}')`,
      );

      expect(res.rows[0]!.unvote_layout).toBe(0);
      await h.asSuperuser();
      expect(await counter(LAYOUT_A)).toBe(0);
    });
  });

  describe("direct table access", () => {
    // The grant is what makes the definer functions the ONLY way in. A member
    // who could insert here could add a vote without moving the counter, and
    // nothing would ever notice the two had drifted.
    it("refuses a member inserting a vote row themselves", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.query(
          `insert into base_layout_votes (layout_id, user_id)
           values ('${LAYOUT_A}', '${MEMBER_A}')`,
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it("lets a member read votes on their own clan's layouts only", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(`select vote_for_layout('${LAYOUT_A}')`);
      await h.asUser(MEMBER_B);
      await h.db.query(`select vote_for_layout('${LAYOUT_B}')`);

      await h.asUser(MEMBER_A);
      const res = await h.db.query<{ layout_id: string }>(
        `select layout_id from base_layout_votes`,
      );
      expect(res.rows.map((r) => r.layout_id)).toEqual([LAYOUT_A]);
    });
  });

  describe("base_layouts write policies (T8.3)", () => {
    it("lets any member upload to their own clan", async () => {
      await h.asUser(OTHER_A);
      await h.db.query(
        `insert into base_layouts (clan_id, uploaded_by, th_level, layout_type, copy_link)
         values ('${CLAN_A}', '${OTHER_A}', 16, 'trophy', 'https://link.clashofclans.com/c')`,
      );

      await h.asSuperuser();
      const res = await h.db.query<{ n: number }>(
        `select count(*)::int as n from base_layouts where clan_id = '${CLAN_A}'`,
      );
      expect(res.rows[0]!.n).toBe(2);
    });

    it("refuses an upload attributed to somebody else", async () => {
      await h.asUser(OTHER_A);
      await expect(
        h.db.query(
          `insert into base_layouts (clan_id, uploaded_by, th_level, layout_type, copy_link)
           values ('${CLAN_A}', '${MEMBER_A}', 16, 'trophy', 'https://x')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("refuses an upload into another clan", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.query(
          `insert into base_layouts (clan_id, uploaded_by, th_level, layout_type, copy_link)
           values ('${CLAN_B}', '${MEMBER_A}', 16, 'trophy', 'https://x')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    // Removal is deleted_at, which is an UPDATE — so "can I delete my layout"
    // is really "can I update my own row".
    it("lets the uploader soft-delete their own layout", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(`update base_layouts set deleted_at = now() where id = '${LAYOUT_A}'`);

      await h.asSuperuser();
      const res = await h.db.query<{ deleted_at: string | null }>(
        `select deleted_at from base_layouts where id = '${LAYOUT_A}'`,
      );
      expect(res.rows[0]!.deleted_at).not.toBeNull();
    });

    it("does not let one member edit another's layout", async () => {
      await h.asUser(OTHER_A);
      await h.db.query(`update base_layouts set description = 'x' where id = '${LAYOUT_A}'`);

      // No error — the policy filters the row out rather than raising, which is
      // how UPDATE works under RLS. The assertion is that nothing changed.
      await h.asSuperuser();
      const res = await h.db.query<{ description: string | null }>(
        `select description from base_layouts where id = '${LAYOUT_A}'`,
      );
      expect(res.rows[0]!.description).toBeNull();
    });
  });
});
