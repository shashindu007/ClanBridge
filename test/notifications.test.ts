// T5.5 / T5.9 / T5.6 — the notification schema, at the database layer.
//
// Raw SQL rather than the supabase-js shim: these are policy tests, and what
// matters is what Postgres refuses. The shim implements no .rpc() either, and
// push_targets() is a function.
//
// The two cases worth more than the rest:
//
//   1. A push endpoint is a CAPABILITY URL. Anyone holding one can push to that
//      device until it expires. So "a member may not read another member's
//      subscription" is not tidiness — it is the whole security property of the
//      table, and push_targets() is the single deliberate hole in it.
//
//   2. An absent preference row means EVERY KIND ENABLED. If that ever inverts,
//      the failure is silent: push starts reaching nobody, the sending code
//      still reports success because it sent to every target it was given, and
//      the target list is simply empty. MEMBER_A has no preference row for
//      exactly this reason.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";

const LEADER_A = "11111111-0000-4000-8000-0000000000a1";
const MEMBER_A = "22222222-0000-4000-8000-0000000000a2";
const ELDER_A = "44444444-0000-4000-8000-0000000000a3";
const LEADER_B = "33333333-0000-4000-8000-0000000000b1";

async function count(h: Harness, sql: string): Promise<number> {
  const res = await h.db.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`);
  return res.rows[0]!.n;
}

/** push_targets as the currently-set role sees it. */
function targets(clan: string, kind: string): string {
  return `select * from push_targets('${clan}', '${kind}')`;
}

describe("T5 — notification schema", () => {
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
      truncate notifications, notification_preferences, push_subscriptions,
               clan_roles, players, users, clans cascade;
      delete from auth.users;

      insert into auth.users (id, email) values
        ('${LEADER_A}', 'leader-a@example.com'),
        ('${MEMBER_A}', 'member-a@example.com'),
        ('${ELDER_A}',  'elder-a@example.com'),
        ('${LEADER_B}', 'leader-b@example.com');

      insert into users (id, email, status) values
        ('${LEADER_A}', 'leader-a@example.com', 'approved'),
        ('${MEMBER_A}', 'member-a@example.com', 'approved'),
        ('${ELDER_A}',  'elder-a@example.com',  'approved'),
        ('${LEADER_B}', 'leader-b@example.com', 'approved');

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');

      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER_A}', '${CLAN_A}', 'leader'),
        ('${MEMBER_A}', '${CLAN_A}', 'member'),
        ('${ELDER_A}',  '${CLAN_A}', 'elder'),
        ('${LEADER_B}', '${CLAN_B}', 'leader');

      -- Every member of clan A has a device. MEMBER_A deliberately has NO
      -- preference row; ELDER_A has one with everything left at its default.
      insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
        ('${LEADER_A}', 'https://push.example/leader-a', 'k', 'k'),
        ('${MEMBER_A}', 'https://push.example/member-a', 'k', 'k'),
        ('${ELDER_A}',  'https://push.example/elder-a',  'k', 'k'),
        ('${LEADER_B}', 'https://push.example/leader-b', 'k', 'k');

      insert into notification_preferences (user_id) values ('${ELDER_A}');
    `);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T5.5 — a member registers their own device, and only their own
  // ───────────────────────────────────────────────────────────────────────────
  describe("push_subscriptions write policies (T5.5)", () => {
    it("lets a member register their own device", async () => {
      await h.asUser(MEMBER_A);
      await h.db.exec(`
        insert into push_subscriptions (user_id, endpoint, p256dh, auth)
        values ('${MEMBER_A}', 'https://push.example/member-a-2', 'k', 'k');
      `);
      expect(
        await count(h, `select 1 from push_subscriptions where deleted_at is null`),
      ).toBe(2); // their original plus the new one; the others are invisible
    });

    // The reason the insert policy pins user_id rather than merely requiring a
    // session: without it, a member registers a device against someone else's
    // account and quietly receives that person's notifications from then on.
    it("refuses a device registered against another account", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.exec(`
          insert into push_subscriptions (user_id, endpoint, p256dh, auth)
          values ('${LEADER_A}', 'https://push.example/stolen', 'k', 'k');
        `),
      ).rejects.toThrow(/row-level security/i);
    });

    it("lets a member soft delete their own subscription (R4)", async () => {
      await h.asUser(MEMBER_A);
      await h.db.exec(`
        update push_subscriptions set deleted_at = now()
        where endpoint = 'https://push.example/member-a';
      `);
      expect(
        await count(h, `select 1 from push_subscriptions where deleted_at is null`),
      ).toBe(0);
    });

    // `using` alone would allow this: the row is theirs when targeted, and only
    // the with check clause stops it becoming somebody else's on the way out.
    it("refuses reassigning your own subscription to another account", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.exec(
          `update push_subscriptions set user_id = '${LEADER_A}'
           where endpoint = 'https://push.example/member-a';`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("keeps another member's subscription unreadable", async () => {
      await h.asUser(MEMBER_A);
      expect(
        await count(h, `select 1 from push_subscriptions where user_id = '${LEADER_A}'`),
      ).toBe(0);
    });

    it("shows anon nothing at all", async () => {
      await h.asAnon();
      expect(await count(h, `select 1 from push_subscriptions`)).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T5.9 — preferences
  // ───────────────────────────────────────────────────────────────────────────
  describe("notification_preferences (T5.9)", () => {
    it("defaults every kind to enabled", async () => {
      await h.asUser(ELDER_A);
      const res = await h.db.query<{
        announcements: boolean;
        cwl_reminders: boolean;
        war_reminders: boolean;
        raid_reminders: boolean;
        poll_reminders: boolean;
      }>(`select announcements, cwl_reminders, war_reminders, raid_reminders,
                 poll_reminders
          from notification_preferences where user_id = '${ELDER_A}'`);

      expect(res.rows[0]).toEqual({
        announcements: true,
        cwl_reminders: true,
        war_reminders: true,
        raid_reminders: true,
        poll_reminders: true,
      });
    });

    it("lets a member set their own toggles", async () => {
      await h.asUser(MEMBER_A);
      await h.db.exec(
        `insert into notification_preferences (user_id, raid_reminders)
         values ('${MEMBER_A}', false);`,
      );
      expect(
        await count(
          h,
          `select 1 from notification_preferences
           where user_id = '${MEMBER_A}' and raid_reminders = false`,
        ),
      ).toBe(1);
    });

    it("refuses preferences written for another account", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.exec(
          `insert into notification_preferences (user_id) values ('${LEADER_A}');`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("keeps another member's preferences unreadable", async () => {
      await h.asUser(MEMBER_A);
      expect(
        await count(h, `select 1 from notification_preferences where user_id = '${ELDER_A}'`),
      ).toBe(0);
    });

    it("allows only one live preference row per member", async () => {
      await h.asUser(MEMBER_A);
      await h.db.exec(
        `insert into notification_preferences (user_id) values ('${MEMBER_A}');`,
      );
      await expect(
        h.db.exec(`insert into notification_preferences (user_id) values ('${MEMBER_A}');`),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T5.6 — push_targets()
  // ───────────────────────────────────────────────────────────────────────────
  describe("push_targets (T5.6)", () => {
    it("returns every subscribed member of the clan, to leadership", async () => {
      await h.asUser(LEADER_A);
      expect(await count(h, targets(CLAN_A, "announcements"))).toBe(3);
    });

    // The case that would break silently if the coalesce were dropped: MEMBER_A
    // has no preference row and must still be reached.
    it("treats a member with no preference row as opted in", async () => {
      await h.asUser(LEADER_A);
      expect(
        await count(
          h,
          `select * from push_targets('${CLAN_A}', 'cwl_reminders')
           where user_id = '${MEMBER_A}'`,
        ),
      ).toBe(1);
    });

    it("drops a member who opted out of that kind, and only that kind", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `update notification_preferences set announcements = false
         where user_id = '${ELDER_A}';`,
      );

      await h.asUser(LEADER_A);
      expect(await count(h, targets(CLAN_A, "announcements"))).toBe(2);
      expect(await count(h, targets(CLAN_A, "cwl_reminders"))).toBe(3);
    });

    it("never returns a member of another clan (R3)", async () => {
      await h.asUser(LEADER_A);
      expect(
        await count(
          h,
          `select * from push_targets('${CLAN_A}', 'announcements')
           where user_id = '${LEADER_B}'`,
        ),
      ).toBe(0);
    });

    // The authority check is inside the function, so a route that forgets to
    // guard its own call still cannot leak endpoints.
    it("returns nothing to an ordinary member of the clan", async () => {
      await h.asUser(MEMBER_A);
      expect(await count(h, targets(CLAN_A, "announcements"))).toBe(0);
    });

    it("returns nothing to an elder", async () => {
      await h.asUser(ELDER_A);
      expect(await count(h, targets(CLAN_A, "announcements"))).toBe(0);
    });

    it("returns nothing to the leader of a different clan", async () => {
      await h.asUser(LEADER_B);
      expect(await count(h, targets(CLAN_A, "announcements"))).toBe(0);
    });

    it("excludes a soft-deleted subscription", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `update push_subscriptions set deleted_at = now()
         where user_id = '${MEMBER_A}';`,
      );
      await h.asUser(LEADER_A);
      expect(await count(h, targets(CLAN_A, "announcements"))).toBe(2);
    });

    it("excludes a member whose clan role was revoked", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `update clan_roles set deleted_at = now()
         where user_id = '${MEMBER_A}' and clan_id = '${CLAN_A}';`,
      );
      await h.asUser(LEADER_A);
      expect(await count(h, targets(CLAN_A, "announcements"))).toBe(2);
    });

    // A typo in a call site should reach nobody. The alternative — an unknown
    // kind falling through to "send anyway" — turns one wrong string into a
    // notification every member receives and cannot switch off.
    it("sends to nobody for an unrecognised kind", async () => {
      await h.asUser(LEADER_A);
      expect(await count(h, targets(CLAN_A, "not_a_real_kind"))).toBe(0);
    });

    it("serves the sync jobs, which act for no user", async () => {
      await h.asServiceRole();
      expect(await count(h, targets(CLAN_A, "cwl_reminders"))).toBe(3);
    });
  });
});
