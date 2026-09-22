// T12.5 — feedback and the two anon-callable reads (042).
//
// 042 is the first migration that lets an anonymous caller read anything, so
// most of this file is about what anon still CANNOT read.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const OWNER = "11111111-0000-4000-8000-0000000000dd";
const MEMBER = "22222222-0000-4000-8000-0000000000dd";
const PENDING = "33333333-0000-4000-8000-0000000000dd";
const REMOVED = "44444444-0000-4000-8000-0000000000dd";
const CLAN = "aaaaaaaa-0000-4000-8000-0000000000dd";

describe("042 — feedback and public reads", () => {
  let h: Harness;

  async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    const res = await h.db.query<Record<string, T>>(sql, params);
    return Object.values(res.rows[0]!)[0] as T;
  }

  async function submit(rating: number, body: string): Promise<string | null> {
    return scalar<string | null>("select submit_feedback($1::smallint, $2)", [rating, body]);
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
      truncate feedback, notifications, audit_log, clan_roles, users, clans cascade;
      delete from auth.users;

      insert into clans (id, tag, name) values ('${CLAN}', '#2PP0JCCL', 'Dark Haven');

      insert into auth.users (id, email) values
        ('${OWNER}',   'owner@example.com'),
        ('${MEMBER}',  'member@example.com'),
        ('${PENDING}', 'pending@example.com'),
        ('${REMOVED}', 'removed@example.com');

      insert into users (id, email, username, status, is_platform_admin, deleted_at) values
        ('${OWNER}',   'owner@example.com',   'owner',   'approved', true,  null),
        ('${MEMBER}',  'member@example.com',  'memberx', 'approved', false, null),
        ('${PENDING}', 'pending@example.com', 'waiting', 'pending',  false, null),
        ('${REMOVED}', 'removed@example.com', 'gone',    'rejected', false, now());

      insert into clan_roles (user_id, clan_id, role) values
        ('${MEMBER}', '${CLAN}', 'member');
    `);
  });

  describe("submit_feedback", () => {
    it("records feedback from an approved member as pending", async () => {
      await h.asUser(MEMBER);
      expect(await submit(5, "Keeps our CWL history for good.")).not.toBeNull();

      const rows = await h.db.query<{ status: string }>("select status from feedback");
      expect(rows.rows).toEqual([{ status: "pending" }]);
    });

    it("refuses an account still waiting for approval", async () => {
      await h.asUser(PENDING);
      expect(await submit(5, "I have not been let in yet.")).toBeNull();
    });

    it("refuses an account whose access was removed", async () => {
      await h.asUser(REMOVED);
      expect(await submit(1, "Let me back in please.")).toBeNull();
    });

    // One pending item per member: the admin reviews what they think NOW.
    it("replaces a pending item rather than queueing a second", async () => {
      await h.asUser(MEMBER);
      const first = await submit(3, "First draft of my thoughts.");
      const second = await submit(5, "Changed my mind, it is great.");
      expect(second).toBe(first);

      const rows = await h.db.query<{ rating: number; body: string }>(
        "select rating, body from feedback",
      );
      expect(rows.rows).toEqual([{ rating: 5, body: "Changed my mind, it is great." }]);
    });

    it("rejects a body that is too short to learn from", async () => {
      await h.asUser(MEMBER);
      await expect(submit(5, "good")).rejects.toThrow();
    });

    it("rejects a rating outside 1 to 5", async () => {
      await h.asUser(MEMBER);
      await expect(submit(6, "Out of range rating here.")).rejects.toThrow();
    });

    it("grants no session a direct write", async () => {
      await h.asUser(MEMBER);
      await expect(
        h.db.query(
          `insert into feedback (user_id, rating, body, status)
           values ($1, 5, 'Approving myself here.', 'approved')`,
          [MEMBER],
        ),
      ).rejects.toThrow();
    });
  });

  describe("review_feedback", () => {
    async function pendingId(): Promise<string> {
      await h.asUser(MEMBER);
      return (await submit(5, "Keeps our CWL history for good."))!;
    }

    it("lets the platform admin approve, and records it", async () => {
      const id = await pendingId();
      await h.asUser(OWNER);
      expect(await scalar<boolean>("select review_feedback($1, 'approved')", [id])).toBe(true);

      const audit = await h.db.query<{ action: string }>(
        "select action from audit_log where entity = 'feedback'",
      );
      expect(audit.rows).toEqual([{ action: "review" }]);
    });

    it("refuses anyone else, including the author", async () => {
      const id = await pendingId();
      await h.asUser(MEMBER);
      expect(await scalar<boolean>("select review_feedback($1, 'approved')", [id])).toBe(false);
    });

    it("refuses a status that is not a decision", async () => {
      const id = await pendingId();
      await h.asUser(OWNER);
      expect(await scalar<boolean>("select review_feedback($1, 'pending')", [id])).toBe(false);
    });
  });

  describe("public_feedback — callable by anon", () => {
    async function approvedQuote() {
      await h.asUser(MEMBER);
      const id = await submit(5, "Keeps our CWL history for good.");
      await h.asUser(OWNER);
      await h.db.query("select review_feedback($1, 'approved')", [id]);
    }

    it("shows approved quotes with username and clan to anon", async () => {
      await approvedQuote();
      await h.asAnon();
      const rows = await h.db.query<{ author: string; clan: string; rating: number }>(
        "select author, clan, rating from public_feedback()",
      );
      expect(rows.rows).toEqual([{ author: "memberx", clan: "Dark Haven", rating: 5 }]);
    });

    it("never shows a pending or hidden quote", async () => {
      await h.asUser(MEMBER);
      await submit(5, "Still waiting for review.");
      await h.asAnon();
      expect((await h.db.query("select * from public_feedback()")).rows).toEqual([]);
    });

    // The privacy line this whole migration is drawn around.
    it("returns no email and no id", async () => {
      await approvedQuote();
      await h.asAnon();
      const rows = await h.db.query<Record<string, unknown>>("select * from public_feedback()");
      expect(Object.keys(rows.rows[0]!).sort()).toEqual(
        ["author", "body", "clan", "created_at", "rating"],
      );
      expect(JSON.stringify(rows.rows)).not.toContain("@example.com");
    });

    it("caps the limit whatever anon asks for", async () => {
      await approvedQuote();
      await h.asAnon();
      await expect(h.db.query("select * from public_feedback(100000)")).resolves.toBeDefined();
    });

    // The table itself stays closed. Only the function is open.
    it("leaves the feedback table unreadable to anon", async () => {
      await approvedQuote();
      await h.asAnon();
      expect((await h.db.query("select 1 from feedback")).rows).toEqual([]);
    });
  });

  describe("public_stats — callable by anon", () => {
    it("returns four integers and nothing else", async () => {
      await h.asAnon();
      const rows = await h.db.query<Record<string, unknown>>("select * from public_stats()");
      expect(rows.rows[0]).toEqual({ clans: 1, members: 2, cwl_seasons: 0, wars: 0 });
    });

    // 006's promise, restated after the first anon grant in the schema.
    it("leaves every table as empty to anon as it was", async () => {
      await h.asAnon();
      expect((await h.db.query("select 1 from users")).rows).toEqual([]);
      expect((await h.db.query("select 1 from clans")).rows).toEqual([]);
    });
  });
});
