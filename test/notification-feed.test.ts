// T12.3 — the notification feed and presence (040).
//
// The assertion this whole file exists for is "muting a kind does not empty the
// feed". Everything else here is the usual clan boundary work, but that one is
// the bug 040 was written to fix: a notification used to be a Web Push and
// nothing else, so a member with no subscription — or with the kind switched
// off — was never told anything and there was no record that anyone had tried.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const LEADER_A = "11111111-0000-4000-8000-0000000000bb";
const MEMBER_A = "22222222-0000-4000-8000-0000000000bb";
const OTHER_A = "33333333-0000-4000-8000-0000000000bb";
const LEADER_B = "44444444-0000-4000-8000-0000000000bb";
const MEMBER_B = "55555555-0000-4000-8000-0000000000bb";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000bb";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";

describe("040 — the notification feed", () => {
  let h: Harness;

  async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    const res = await h.db.query<Record<string, T>>(sql, params);
    return Object.values(res.rows[0]!)[0] as T;
  }

  /**
   * One person's INBOX, filtered on recipient_id exactly as the repository is.
   *
   * The filter is not redundant against RLS and the distinction matters: "read
   * own notifications" deliberately returns both ends of the conversation, so a
   * leader can see what they have already sent somebody. A bare select is
   * therefore the sender's view as well, and an inbox that showed it would show
   * a leader every announcement they ever wrote.
   */
  async function feed(
    recipient: string,
  ): Promise<Array<{ title: string; read_at: string | null; kind: string }>> {
    const res = await h.db.query<{ title: string; read_at: string | null; kind: string }>(
      "select title, read_at, kind from notifications where recipient_id = $1 order by created_at",
      [recipient],
    );
    return res.rows;
  }

  async function announce(title = "Roster is up", url = "/x"): Promise<number> {
    return scalar<number>(
      "select notify_clan_members($1, $2, $3, $4, $5)",
      [CLAN_A, "announcements", title, "Body of the notice.", url],
    );
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
      truncate notifications, notification_preferences, push_subscriptions,
               account_messages, audit_log, clan_roles, users, clans cascade;
      delete from auth.users;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');

      insert into auth.users (id, email) values
        ('${LEADER_A}', 'leader-a@example.com'),
        ('${MEMBER_A}', 'member-a@example.com'),
        ('${OTHER_A}',  'other-a@example.com'),
        ('${LEADER_B}', 'leader-b@example.com'),
        ('${MEMBER_B}', 'member-b@example.com');

      insert into users (id, email, status) values
        ('${LEADER_A}', 'leader-a@example.com', 'approved'),
        ('${MEMBER_A}', 'member-a@example.com', 'approved'),
        ('${OTHER_A}',  'other-a@example.com',  'approved'),
        ('${LEADER_B}', 'leader-b@example.com', 'approved'),
        ('${MEMBER_B}', 'member-b@example.com', 'approved');

      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER_A}', '${CLAN_A}', 'leader'),
        ('${MEMBER_A}', '${CLAN_A}', 'member'),
        ('${OTHER_A}',  '${CLAN_A}', 'elder'),
        ('${LEADER_B}', '${CLAN_B}', 'leader'),
        ('${MEMBER_B}', '${CLAN_B}', 'member');
    `);
  });

  describe("notify_clan_members", () => {
    it("writes one row for every other member of the clan", async () => {
      await h.asUser(LEADER_A);
      // Two: MEMBER_A and OTHER_A. Not LEADER_A, who wrote it.
      expect(await announce()).toBe(2);

      await h.asUser(MEMBER_A);
      expect(await feed(MEMBER_A)).toHaveLength(1);
      await h.asUser(OTHER_A);
      expect(await feed(OTHER_A)).toHaveLength(1);
    });

    // Being notified of your own announcement a second after writing it was a
    // real complaint about the push path this replaces.
    it("does not notify the person who raised it", async () => {
      await h.asUser(LEADER_A);
      await announce();
      expect(await feed(LEADER_A)).toHaveLength(0);
    });

    it("does not reach another clan", async () => {
      await h.asUser(LEADER_A);
      await announce();

      await h.asUser(MEMBER_B);
      expect(await feed(MEMBER_B)).toHaveLength(0);
      await h.asUser(LEADER_B);
      expect(await feed(LEADER_B)).toHaveLength(0);
    });

    it("refuses a leader notifying a clan they do not run", async () => {
      await h.asUser(LEADER_A);
      expect(
        await scalar<number>("select notify_clan_members($1, $2, $3, $4)", [
          CLAN_B,
          "announcements",
          "Title",
          "Body",
        ]),
      ).toBe(0);
    });

    // Leadership, matching push_targets() (023) — an elder runs nothing.
    it("refuses an ordinary member and an elder", async () => {
      await h.asUser(MEMBER_A);
      expect(await announce()).toBe(0);
      await h.asUser(OTHER_A);
      expect(await announce()).toBe(0);
    });

    it("skips an account whose access was removed", async () => {
      await h.asUser(LEADER_A);
      await h.db.query("select remove_account($1, $2)", [MEMBER_A, "left the clan"]);
      // Only OTHER_A remains.
      expect(await announce()).toBe(1);
    });
  });

  // ── the bug 040 exists to fix ─────────────────────────────────────────────
  describe("muting governs the push, never the feed", () => {
    it("still records for a member who switched that kind off", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query(
        "insert into notification_preferences (user_id, announcements) values ($1, false)",
        [MEMBER_A],
      );

      await h.asUser(LEADER_A);
      expect(await announce()).toBe(2);

      await h.asUser(MEMBER_A);
      const rows = await feed(MEMBER_A);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.read_at).toBeNull();
    });

    // The other half of the same rule: the push genuinely is suppressed, so
    // this is a real preference rather than one the feed quietly ignores.
    it("does drop them from push_targets for that kind", async () => {
      await h.asSuperuser();
      await h.db.exec(`
        insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
          ('${MEMBER_A}', 'https://push.example/a', 'k', 'k'),
          ('${OTHER_A}',  'https://push.example/b', 'k', 'k');
        insert into notification_preferences (user_id, announcements)
        values ('${MEMBER_A}', false);
      `);

      await h.asUser(LEADER_A);
      const targets = await h.db.query(
        "select user_id from push_targets($1, $2)",
        [CLAN_A, "announcements"],
      );
      expect(targets.rows.map((r) => (r as { user_id: string }).user_id)).toEqual([OTHER_A]);

      // ...and the kind they did not mute is untouched.
      const war = await h.db.query("select user_id from push_targets($1, $2)", [
        CLAN_A,
        "war_reminders",
      ]);
      expect(war.rows).toHaveLength(2);
    });

    it("records for a member who has no push subscription at all", async () => {
      await h.asUser(LEADER_A);
      await announce();

      // MEMBER_A never registered a device — the case that previously meant
      // "told nobody, recorded nothing".
      await h.asUser(MEMBER_A);
      expect(await feed(MEMBER_A)).toHaveLength(1);
    });
  });

  describe("reading", () => {
    it("keeps a feed private to its recipient", async () => {
      await h.asUser(LEADER_A);
      await announce();

      // The sender sees what they sent (the policy's second arm) but through
      // sender_id, never as their own unread feed.
      await h.asUser(LEADER_A);
      const asSender = await h.db.query(
        "select 1 from notifications where recipient_id = $1",
        [LEADER_A],
      );
      expect(asSender.rows).toHaveLength(0);

      await h.asUser(MEMBER_B);
      expect(await feed(MEMBER_B)).toHaveLength(0);
    });

    it("marks one read, once", async () => {
      await h.asUser(LEADER_A);
      await announce();

      await h.asUser(MEMBER_A);
      const id = await scalar<string>("select id from notifications limit 1");
      expect(await scalar<boolean>("select mark_notification_read($1)", [id])).toBe(true);
      expect(await scalar<boolean>("select mark_notification_read($1)", [id])).toBe(false);
    });

    it("refuses to mark somebody else's read", async () => {
      await h.asUser(LEADER_A);
      await announce();

      await h.asSuperuser();
      const id = await scalar<string>(
        `select id from notifications where recipient_id = '${MEMBER_A}'`,
      );

      await h.asUser(OTHER_A);
      expect(await scalar<boolean>("select mark_notification_read($1)", [id])).toBe(false);
    });

    it("clears the lot, and only the caller's", async () => {
      await h.asUser(LEADER_A);
      await announce("One");
      await announce("Two");

      await h.asUser(MEMBER_A);
      expect(await scalar<number>("select mark_all_notifications_read()")).toBe(2);
      expect((await feed(MEMBER_A)).every((n) => n.read_at !== null)).toBe(true);

      await h.asUser(OTHER_A);
      expect((await feed(OTHER_A)).every((n) => n.read_at === null)).toBe(true);
    });

    // The reason marking read is a function and not an UPDATE policy.
    it("grants no session the ability to rewrite a notification", async () => {
      await h.asUser(LEADER_A);
      await announce();

      await h.asUser(MEMBER_A);
      await expect(
        h.db.query("update notifications set body = 'rewritten'"),
      ).rejects.toThrow();
    });
  });

  // A url from the database is written into a link AND into a push payload.
  describe("the url column", () => {
    it("refuses an absolute address", async () => {
      await h.asSuperuser();
      await expect(
        h.db.query(
          `insert into notifications (recipient_id, kind, title, body, url)
           values ('${MEMBER_A}', 'announcements', 't', 'b', 'https://evil.example')`,
        ),
      ).rejects.toThrow();
    });

    // The one a naive "starts with /" check waves through.
    it("refuses a protocol-relative address", async () => {
      await h.asSuperuser();
      await expect(
        h.db.query(
          `insert into notifications (recipient_id, kind, title, body, url)
           values ('${MEMBER_A}', 'announcements', 't', 'b', '//evil.example')`,
        ),
      ).rejects.toThrow();
    });
  });

  describe("send_account_message, now on the feed", () => {
    it("lands in the recipient's notifications", async () => {
      await h.asUser(LEADER_A);
      const id = await scalar<string | null>(
        "select send_account_message($1, $2, $3)",
        [MEMBER_A, "Missed attacks", "Please use both attacks."],
      );
      expect(id).not.toBeNull();

      await h.asUser(MEMBER_A);
      const rows = await feed(MEMBER_A);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.kind).toBe("direct_messages");
      expect(rows[0]!.title).toBe("Missed attacks");
    });

    // 039's boundary has to survive the rewrite.
    it("still refuses another clan's member", async () => {
      await h.asUser(LEADER_A);
      expect(
        await scalar<string | null>("select send_account_message($1, $2, $3)", [
          MEMBER_B,
          "Hello",
          "Body",
        ]),
      ).toBeNull();
    });

    it("still writes the subject to audit_log and never the body", async () => {
      await h.asUser(LEADER_A);
      await h.db.query("select send_account_message($1, $2, $3)", [
        MEMBER_A,
        "Missed attacks",
        "A private sentence that must not travel.",
      ]);

      await h.asSuperuser();
      const res = await h.db.query<{ after: Record<string, unknown> }>(
        "select after from audit_log where action = 'message'",
      );
      expect(res.rows[0]!.after).toMatchObject({ subject: "Missed attacks" });
      expect(JSON.stringify(res.rows[0]!.after)).not.toContain("must not travel");
    });
  });

  // ── presence ──────────────────────────────────────────────────────────────
  describe("presence", () => {
    async function presence() {
      const res = await h.db.query<{
        total_accounts: number;
        active_accounts: number;
        online_now: number;
        pending_accounts: number;
      }>("select * from platform_presence()");
      return res.rows[0]!;
    }

    it("counts accounts and nobody online until somebody is seen", async () => {
      await h.asUser(MEMBER_A);
      const before = await presence();
      expect(before.total_accounts).toBe(5);
      expect(before.active_accounts).toBe(5);
      expect(before.online_now).toBe(0);
    });

    it("counts the caller once they are touched", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query("select touch_last_seen()");
      expect((await presence()).online_now).toBe(1);
    });

    // The throttle is what stops this being a write on every page load.
    it("does not rewrite a timestamp that is still fresh", async () => {
      await h.asUser(MEMBER_A);
      await h.db.query("select touch_last_seen()");

      await h.asSuperuser();
      const first = await scalar<Date>(
        `select last_seen_at from users where id = '${MEMBER_A}'`,
      );

      await h.asUser(MEMBER_A);
      await h.db.query("select touch_last_seen()");

      await h.asSuperuser();
      const second = await scalar<Date>(
        `select last_seen_at from users where id = '${MEMBER_A}'`,
      );
      // By value: the driver hands back a fresh Date object each time, so
      // toBe() compares two distinct objects and fails even when the timestamp
      // never moved — which is the opposite of what this test is checking.
      expect(second.getTime()).toBe(first.getTime());
    });

    it("stops counting somebody last seen more than five minutes ago", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `update users set last_seen_at = now() - interval '6 minutes' where id = '${MEMBER_A}'`,
      );
      await h.asUser(OTHER_A);
      expect((await presence()).online_now).toBe(0);
    });

    it("leaves out a removed account", async () => {
      await h.asUser(LEADER_A);
      await h.db.query("select remove_account($1, $2)", [MEMBER_A, "left"]);
      const after = await presence();
      expect(after.total_accounts).toBe(4);
      expect(after.active_accounts).toBe(4);
    });

    // The same guard 037 and 038 use. An account with no clan role yet is not
    // told how many people are on the platform.
    //
    // ZEROS, not an empty result. platform_presence() is an aggregate with no
    // GROUP BY, and one of those always returns exactly one row even when its
    // WHERE matches nothing — so the guard shows up as counts of zero rather
    // than as no row. That reveals nothing, which is the requirement; the test
    // states it this way so the next person does not "fix" the function into
    // returning a row it never returned.
    it("tells a caller with no clan role nothing but zeros", async () => {
      await h.asSuperuser();
      await h.db.exec(`delete from clan_roles where user_id = '${MEMBER_A}'`);
      await h.asUser(MEMBER_A);
      expect(await presence()).toMatchObject({
        total_accounts: 0,
        active_accounts: 0,
        online_now: 0,
        pending_accounts: 0,
      });
    });
  });
});
