// T5.1 — announcement writes, against real Postgres with RLS on.
//
// These are the first human writes in the system that are not account
// decisions, and 021 routes them through security definer functions rather than
// insert policies. The reason is auditability, so that is what most of this file
// asserts: the row and its audit entry arrive together, and neither the write
// nor the audit can be performed by someone who should not.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const LEADER = "11111111-0000-4000-8000-0000000000a1";
const CO_LEADER = "22222222-0000-4000-8000-0000000000a2";
const MEMBER = "33333333-0000-4000-8000-0000000000a3";
const OUTSIDER = "44444444-0000-4000-8000-0000000000b1";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";

async function post(
  h: Harness,
  clan: string,
  title = "CWL starts Friday",
  body = "Sign up in the poll.",
): Promise<string> {
  const res = await h.db.query<{ id: string }>(
    `select post_announcement('${clan}', '${title}', '${body}', false) as id`,
  );
  return res.rows[0]!.id;
}

async function auditCount(h: Harness): Promise<number> {
  const res = await h.db.query<{ n: number }>(
    `select count(*)::int as n from audit_log where entity = 'announcements'`,
  );
  return res.rows[0]!.n;
}

describe("T5.1 — announcements", () => {
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
      truncate notifications, announcements, audit_log, clan_roles, users, clans cascade;
      delete from auth.users;

      insert into auth.users (id, email) values
        ('${LEADER}',    'leader@example.com'),
        ('${CO_LEADER}', 'co@example.com'),
        ('${MEMBER}',    'member@example.com'),
        ('${OUTSIDER}',  'outsider@example.com');

      insert into users (id, email, status) values
        ('${LEADER}',    'leader@example.com',   'approved'),
        ('${CO_LEADER}', 'co@example.com',       'approved'),
        ('${MEMBER}',    'member@example.com',   'approved'),
        ('${OUTSIDER}',  'outsider@example.com', 'approved');

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#2PP0JCCQ', 'Clan B');

      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER}',    '${CLAN_A}', 'leader'),
        ('${CO_LEADER}', '${CLAN_A}', 'co-leader'),
        ('${MEMBER}',    '${CLAN_A}', 'member'),
        ('${OUTSIDER}',  '${CLAN_B}', 'leader');
    `);
  });

  describe("who may post", () => {
    it("lets a leader post", async () => {
      await h.asUser(LEADER);
      const id = await post(h, CLAN_A);
      expect(id).toBeTruthy();
    });

    it("lets a co-leader post — they run the clan day to day", async () => {
      await h.asUser(CO_LEADER);
      expect(await post(h, CLAN_A)).toBeTruthy();
    });

    it("refuses an ordinary member", async () => {
      await h.asUser(MEMBER);
      await expect(post(h, CLAN_A)).rejects.toThrow(/leader or co-leader/);
    });

    it("refuses a leader of a DIFFERENT clan", async () => {
      // Being leader somewhere is not being leader here.
      await h.asUser(OUTSIDER);
      await expect(post(h, CLAN_A)).rejects.toThrow(/leader or co-leader/);
    });

    it("refuses an anonymous caller", async () => {
      await h.asAnon();
      await expect(post(h, CLAN_A)).rejects.toThrow();
    });
  });

  describe("R4 — the audit entry is not optional", () => {
    it("writes exactly one audit row with the announcement", async () => {
      await h.asUser(LEADER);
      await post(h, CLAN_A);
      expect(await auditCount(h)).toBe(1);
    });

    it("records the editor and what the title was before", async () => {
      await h.asUser(LEADER);
      const id = await post(h, CLAN_A, "Old title");
      await h.db.query(
        `select edit_announcement('${id}', 'New title', 'Updated body', true)`,
      );

      const res = await h.db.query<{ before: { title: string }; after: { title: string } }>(
        `select before, after from audit_log
          where entity = 'announcements' and action = 'update'`,
      );
      expect(res.rows[0]!.before.title).toBe("Old title");
      expect(res.rows[0]!.after.title).toBe("New title");
    });

    it("does not let a member forge an audit entry directly", async () => {
      // audit_log has a select policy for leaders and NO insert policy. Without
      // that, application-side auditing would let anyone attribute anything to
      // anyone — which is why 021 does not add one.
      await h.asUser(MEMBER);
      await expect(
        h.db.query(
          `insert into audit_log (user_id, clan_id, action, entity)
           values ('${MEMBER}', '${CLAN_A}', 'delete', 'announcements')`,
        ),
      ).rejects.toThrow();
    });

    it("audits a removal, so a vanished notice has an explanation", async () => {
      await h.asUser(LEADER);
      const id = await post(h, CLAN_A, "Vanishing act");
      await h.db.query(`select remove_announcement('${id}')`);

      const res = await h.db.query<{ before: { title: string } }>(
        `select before from audit_log
          where entity = 'announcements' and action = 'delete'`,
      );
      expect(res.rows[0]!.before.title).toBe("Vanishing act");
    });
  });

  describe("R4 — removal is soft", () => {
    it("sets deleted_at and keeps the row", async () => {
      await h.asUser(LEADER);
      const id = await post(h, CLAN_A);
      await h.db.query(`select remove_announcement('${id}')`);

      await h.asSuperuser();
      const res = await h.db.query<{ n: number; gone: number }>(
        `select count(*)::int as n,
                count(deleted_at)::int as gone
           from announcements where id = '${id}'`,
      );
      expect(res.rows[0]!.n).toBe(1); // still there
      expect(res.rows[0]!.gone).toBe(1); // but marked
    });

    it("removing twice is not an error and does not audit twice", async () => {
      await h.asUser(LEADER);
      const id = await post(h, CLAN_A);
      await h.db.query(`select remove_announcement('${id}')`);
      const again = await h.db.query<{ remove_announcement: boolean }>(
        `select remove_announcement('${id}')`,
      );

      expect(again.rows[0]!.remove_announcement).toBe(false);
      const res = await h.db.query<{ n: number }>(
        `select count(*)::int as n from audit_log where action = 'delete'`,
      );
      expect(res.rows[0]!.n).toBe(1);
    });
  });

  describe("validation happens in the database, not only the form", () => {
    it("rejects an empty title", async () => {
      await h.asUser(LEADER);
      await expect(post(h, CLAN_A, "   ")).rejects.toThrow(/needs a title/);
    });

    it("rejects an empty body", async () => {
      await h.asUser(LEADER);
      await expect(post(h, CLAN_A, "Title", "  ")).rejects.toThrow(/needs a body/);
    });

    it("trims rather than storing the whitespace", async () => {
      await h.asUser(LEADER);
      const id = await post(h, CLAN_A, "  Padded  ", "  body  ");
      await h.asSuperuser();
      const res = await h.db.query<{ title: string }>(
        `select title from announcements where id = '${id}'`,
      );
      expect(res.rows[0]!.title).toBe("Padded");
    });
  });

  // T9.6 — the viewer tells a co-leader they cannot read this and explains why.
  // That claim is only worth making if the database actually enforces it.
  describe("T9.6 — who may read the audit log", () => {
    beforeEach(async () => {
      await h.asUser(LEADER);
      await post(h, CLAN_A);
    });

    it("lets the leader read their own clan's entries", async () => {
      await h.asUser(LEADER);
      const res = await h.db.query<{ n: number }>(
        `select count(*)::int as n from audit_log`,
      );
      expect(res.rows[0]!.n).toBe(1);
    });

    it("shows a CO-LEADER nothing, even for their own clan", async () => {
      // Deliberate: the log holds entries about co-leaders, so they are subjects
      // of it rather than readers. 006 gates it on auth_leader_clan_ids(), which
      // is leader-only — this is why 021 added a separate leadership helper for
      // posting rather than widening that one.
      await h.asUser(CO_LEADER);
      const res = await h.db.query<{ n: number }>(
        `select count(*)::int as n from audit_log`,
      );
      expect(res.rows[0]!.n).toBe(0);
    });

    it("shows an ordinary member nothing", async () => {
      await h.asUser(MEMBER);
      const res = await h.db.query<{ n: number }>(
        `select count(*)::int as n from audit_log`,
      );
      expect(res.rows[0]!.n).toBe(0);
    });
  });

  describe("R3 — reading", () => {
    it("shows a member their own clan's announcements", async () => {
      await h.asUser(LEADER);
      await post(h, CLAN_A);

      await h.asUser(MEMBER);
      const res = await h.db.query<{ n: number }>(
        `select count(*)::int as n from announcements`,
      );
      expect(res.rows[0]!.n).toBe(1);
    });

    it("shows another clan's leader nothing", async () => {
      await h.asUser(LEADER);
      await post(h, CLAN_A);

      await h.asUser(OUTSIDER);
      const res = await h.db.query<{ n: number }>(
        `select count(*)::int as n from announcements`,
      );
      expect(res.rows[0]!.n).toBe(0);
    });
  });
});
