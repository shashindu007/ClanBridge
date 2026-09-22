// T12.2 — administering accounts after approval (039).
//
// The interesting tests are the refusals, not the happy paths. This migration
// hands a clan leader the ability to read other people's email addresses, write
// into their inbox and take their access away, so every test below is really one
// question: can somebody reach an account they have no business reaching.
//
// Four accounts, deliberately arranged so that every boundary has a body on each
// side of it:
//
//   OWNER     platform admin, no clan role at all (018's clanless admin)
//   LEADER_A  leader of clan A
//   MEMBER_A  member of clan A          <- LEADER_A's to administer
//   MEMBER_B  member of clan B          <- LEADER_A's to be refused

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const OWNER = "11111111-0000-4000-8000-0000000000aa";
const LEADER_A = "22222222-0000-4000-8000-0000000000aa";
const MEMBER_A = "33333333-0000-4000-8000-0000000000aa";
const MEMBER_B = "44444444-0000-4000-8000-0000000000aa";
const APPLICANT = "55555555-0000-4000-8000-0000000000aa";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";

interface AccountRow {
  id: string;
  email: string;
  status: string;
  removed_at: string | null;
  requested_clan: string | null;
  memberships: Array<{ clanId: string; clan: string; tag: string; role: string }>;
  players: Array<{ tag: string; name: string; thLevel: number | null }>;
  unread_messages: number;
}

describe("039 — account administration", () => {
  let h: Harness;

  async function accounts(search?: string): Promise<AccountRow[]> {
    const res = await h.db.query<AccountRow>("select * from admin_accounts($1)", [
      search ?? null,
    ]);
    return res.rows;
  }

  /** The single value a `select fn(...)` returns, whatever the column is called. */
  async function scalar<T>(sql: string, params: unknown[] = []): Promise<T> {
    const res = await h.db.query<Record<string, T>>(sql, params);
    return Object.values(res.rows[0]!)[0] as T;
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
      truncate feedback, notifications, account_messages, audit_log, player_nicknames, players,
               clan_roles, users, clans cascade;
      delete from auth.users;

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');

      insert into auth.users (id, email) values
        ('${OWNER}',     'owner@example.com'),
        ('${LEADER_A}',  'leader-a@example.com'),
        ('${MEMBER_A}',  'member-a@example.com'),
        ('${MEMBER_B}',  'member-b@example.com'),
        ('${APPLICANT}', 'applicant@example.com');

      insert into users (id, email, username, status, is_platform_admin) values
        ('${OWNER}',     'owner@example.com',     'owner',    'approved', true),
        ('${LEADER_A}',  'leader-a@example.com',  'leadera',  'approved', false),
        ('${MEMBER_A}',  'member-a@example.com',  'membera',  'approved', false),
        ('${MEMBER_B}',  'member-b@example.com',  'memberb',  'approved', false);

      -- Pending, and verified into clan A. 013's audience, restated by
      -- auth_may_administer_account() so the directory and the approval queue
      -- cannot disagree about who a leader is allowed to see.
      insert into users (id, email, status, requested_clan_id) values
        ('${APPLICANT}', 'applicant@example.com', 'pending', '${CLAN_A}');

      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER_A}', '${CLAN_A}', 'leader'),
        ('${MEMBER_A}', '${CLAN_A}', 'member'),
        ('${MEMBER_B}', '${CLAN_B}', 'member');

      insert into players (clan_id, user_id, tag, name, th_level, verified) values
        ('${CLAN_A}', '${MEMBER_A}', '#PY0LQGRJ', 'Member A', 15, true),
        ('${CLAN_B}', '${MEMBER_B}', '#C2V89UGL', 'Member B', 14, true);
    `);
  });

  // ── who may see whom ──────────────────────────────────────────────────────
  describe("admin_accounts", () => {
    it("shows the platform admin every account", async () => {
      await h.asUser(OWNER);
      const rows = await accounts();
      expect(rows.map((r) => r.id).sort()).toEqual(
        [OWNER, LEADER_A, MEMBER_A, MEMBER_B, APPLICANT].sort(),
      );
    });

    it("shows a leader their own clan and the applicants to it, and nobody else", async () => {
      await h.asUser(LEADER_A);
      const rows = await accounts();
      expect(rows.map((r) => r.id).sort()).toEqual(
        [LEADER_A, MEMBER_A, APPLICANT].sort(),
      );
      // The boundary this whole migration exists on top of.
      expect(rows.map((r) => r.id)).not.toContain(MEMBER_B);
      expect(rows.map((r) => r.id)).not.toContain(OWNER);
    });

    it("shows an ordinary member nothing at all", async () => {
      await h.asUser(MEMBER_A);
      expect(await accounts()).toEqual([]);
    });

    // Not "zero rows" — anon holds no EXECUTE grant at all, so the call is
    // refused before the body runs. 015 makes the same point about
    // claim_platform_ownership(): returning false to an unauthenticated caller
    // would still mean the function had been reachable by one.
    it("is not callable by anon at all", async () => {
      await h.asAnon();
      await expect(accounts()).rejects.toThrow(/permission denied/);
    });

    // The reason this is a function and not a wider policy on `users`: the
    // table's own RLS must be exactly as narrow after 039 as it was before.
    //
    // Two rows, not one, and both predate this migration — the leader's own row
    // (006's "read own profile") and the pending applicant to their clan (013).
    // What matters is that MEMBER_A, whose full record admin_accounts() hands
    // this same caller, is still not among them.
    it("does not widen a bare select on users", async () => {
      await h.asUser(LEADER_A);
      const rows = await h.db.query<{ id: string }>("select id from users");
      expect(rows.rows.map((r) => r.id).sort()).toEqual([LEADER_A, APPLICANT].sort());
      expect(rows.rows.map((r) => r.id)).not.toContain(MEMBER_A);
    });

    it("carries the clans, roles and villages the screen needs", async () => {
      await h.asUser(LEADER_A);
      const member = (await accounts()).find((r) => r.id === MEMBER_A)!;
      expect(member.memberships).toEqual([
        { clanId: CLAN_A, clan: "Clan A", tag: "#2PP0JCCL", role: "member" },
      ]);
      expect(member.players).toEqual([
        { tag: "#PY0LQGRJ", name: "Member A", thLevel: 15 },
      ]);
    });

    it("names the clan an applicant verified into", async () => {
      await h.asUser(LEADER_A);
      const applicant = (await accounts()).find((r) => r.id === APPLICANT)!;
      expect(applicant.requested_clan).toBe("Clan A");
      expect(applicant.memberships).toEqual([]);
    });

    // Pending first: widening this screen from "pending only" must not bury the
    // one group of accounts that is actually waiting on somebody.
    it("puts accounts waiting for approval above approved ones", async () => {
      await h.asUser(LEADER_A);
      expect((await accounts())[0]!.id).toBe(APPLICANT);
    });

    it("searches email, username and village tag", async () => {
      await h.asUser(LEADER_A);
      expect((await accounts("member-a@")).map((r) => r.id)).toEqual([MEMBER_A]);
      expect((await accounts("membera")).map((r) => r.id)).toEqual([MEMBER_A]);
      expect((await accounts("PY0LQGRJ")).map((r) => r.id)).toEqual([MEMBER_A]);
      expect(await accounts("nobody")).toEqual([]);
    });

    // A search a leader runs must not reach past their own clan, which is the
    // failure mode a filter bolted onto an unscoped query always has.
    it("cannot search its way into another clan", async () => {
      await h.asUser(LEADER_A);
      expect(await accounts("member-b@example.com")).toEqual([]);
      expect(await accounts("C2V89UGL")).toEqual([]);
    });
  });

  // ── messaging ─────────────────────────────────────────────────────────────
  //
  // send_account_message() IS TESTED IN test/notification-feed.test.ts, NOT
  // HERE. 040 repointed it at the notifications feed one migration after this
  // one shipped, so its rows no longer land in account_messages and assertions
  // written against that table would pass only by testing a tombstone.
  //
  // What stays here is the one thing that belongs to THIS migration: the
  // authority boundary, which 040 did not touch and which is the reason
  // send_account_message() is a definer function at all.
  describe("send_account_message — 039's authority boundary", () => {
    it("refuses a leader writing to another clan's member", async () => {
      await h.asUser(LEADER_A);
      expect(
        await scalar<string | null>("select send_account_message($1, $2, $3)", [
          MEMBER_B,
          "Hello",
          "Body",
        ]),
      ).toBeNull();
    });

    it("refuses an ordinary member writing to anyone", async () => {
      await h.asUser(MEMBER_A);
      expect(
        await scalar<string | null>("select send_account_message($1, $2, $3)", [
          LEADER_A,
          "Hello",
          "Body",
        ]),
      ).toBeNull();
    });

    it("refuses a message to yourself", async () => {
      await h.asUser(LEADER_A);
      expect(
        await scalar<string | null>("select send_account_message($1, $2, $3)", [
          LEADER_A,
          "Hello",
          "Body",
        ]),
      ).toBeNull();
    });

    it("rejects a body longer than the column allows", async () => {
      await h.asUser(LEADER_A);
      await expect(
        h.db.query("select send_account_message($1, $2, $3)", [
          MEMBER_A,
          "Subject",
          "x".repeat(2001),
        ]),
      ).rejects.toThrow();
    });
  });

  describe("the unread badge on the directory", () => {
    // 040 repointed this count at notifications. Kept as an admin_accounts()
    // test because that is the function whose output it is, and because a
    // badge that silently reads zero forever is the exact failure a migration
    // that changes where rows live tends to leave behind.
    it("counts what the member has not read", async () => {
      await h.asUser(LEADER_A);
      await h.db.query("select send_account_message($1, $2, $3)", [
        MEMBER_A,
        "Missed attacks",
        "Body",
      ]);

      expect((await accounts()).find((r) => r.id === MEMBER_A)!.unread_messages).toBe(1);

      await h.asUser(MEMBER_A);
      await h.db.query("select mark_all_notifications_read()");

      await h.asUser(LEADER_A);
      expect((await accounts()).find((r) => r.id === MEMBER_A)!.unread_messages).toBe(0);
    });
  });

  // ── removal ───────────────────────────────────────────────────────────────
  describe("remove_account", () => {
    it("retires the roles, which is what actually revokes access", async () => {
      await h.asUser(LEADER_A);
      expect(
        await scalar<boolean>("select remove_account($1, $2)", [
          MEMBER_A,
          "kept skipping war attacks",
        ]),
      ).toBe(true);

      await h.asSuperuser();
      const user = await h.db.query<{ status: string; deleted_at: string | null }>(
        `select status, deleted_at from users where id = '${MEMBER_A}'`,
      );
      expect(user.rows[0]!.status).toBe("rejected");
      expect(user.rows[0]!.deleted_at).not.toBeNull();

      const live = await h.db.query(
        `select 1 from clan_roles where user_id = '${MEMBER_A}' and deleted_at is null`,
      );
      expect(live.rows).toHaveLength(0);
    });

    // R4. The row is the record of what happened, so the village stays claimed
    // and the history stays joinable.
    it("keeps the row, the village link and the audit reason", async () => {
      await h.asUser(LEADER_A);
      await h.db.query("select remove_account($1, $2)", [MEMBER_A, "kept skipping war attacks"]);

      await h.asSuperuser();
      const player = await h.db.query<{ user_id: string | null }>(
        `select user_id from players where tag = '#PY0LQGRJ'`,
      );
      expect(player.rows[0]!.user_id).toBe(MEMBER_A);

      const audit = await h.db.query<{ action: string; after: Record<string, unknown> }>(
        `select action, after from audit_log where entity = 'users' and action = 'remove'`,
      );
      expect(audit.rows[0]!.after).toMatchObject({ reason: "kept skipping war attacks" });
    });

    it("refuses another clan's member", async () => {
      await h.asUser(LEADER_A);
      expect(await scalar<boolean>("select remove_account($1)", [MEMBER_B])).toBe(false);
    });

    it("refuses an ordinary member removing anyone", async () => {
      await h.asUser(MEMBER_A);
      expect(await scalar<boolean>("select remove_account($1)", [LEADER_A])).toBe(false);
    });

    // Locking yourself out of the screen you did it from.
    it("refuses to remove yourself", async () => {
      await h.asUser(LEADER_A);
      expect(await scalar<boolean>("select remove_account($1)", [LEADER_A])).toBe(false);
    });

    // The escalation this migration would otherwise create: a clan leader
    // removing the platform owner and inheriting the installation.
    //
    // The owner is given a role in clan A first, ON PURPOSE. Without it
    // auth_may_administer_account() already says no and the test passes without
    // ever reaching the guard it claims to be testing — which is exactly the
    // shape of assertion that goes green after the thing it protects is
    // deleted. With the role, LEADER_A genuinely has authority over that
    // account and the platform-admin check is the only thing standing there.
    it("refuses to remove the platform admin, even by a leader who administers them", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `insert into clan_roles (user_id, clan_id, role)
         values ('${OWNER}', '${CLAN_A}', 'member');`,
      );

      await h.asUser(LEADER_A);
      // Authority really is there — the account is in their directory.
      expect((await accounts()).map((r) => r.id)).toContain(OWNER);

      await expect(
        h.db.query("select remove_account($1)", [OWNER]),
      ).rejects.toThrow(/platform admin account cannot be removed/);
    });

    // Authority is checked BEFORE anything that would reveal the target. A
    // leader with no claim on the owner's account gets a plain false, not the
    // named exception above — otherwise the function is an oracle for "which of
    // these uuids is the platform owner".
    it("tells a caller with no authority nothing about the platform admin", async () => {
      await h.asUser(LEADER_A);
      expect(await scalar<boolean>("select remove_account($1)", [OWNER])).toBe(false);
    });

    it("is not repeatable on an account already removed", async () => {
      await h.asUser(LEADER_A);
      expect(await scalar<boolean>("select remove_account($1)", [MEMBER_A])).toBe(true);
      expect(await scalar<boolean>("select remove_account($1)", [MEMBER_A])).toBe(false);
    });

    // Without the second arm of auth_may_administer_account()'s clan_roles
    // check this is where a removed account would vanish from the list of the
    // leader who removed it, taking the undo with it.
    it("leaves the removed account visible to the leader who removed it", async () => {
      await h.asUser(LEADER_A);
      await h.db.query("select remove_account($1)", [MEMBER_A]);

      const row = (await accounts()).find((r) => r.id === MEMBER_A);
      expect(row).toBeDefined();
      expect(row!.removed_at).not.toBeNull();
      expect(row!.memberships).toEqual([]);
    });
  });

  describe("restore_account", () => {
    it("puts the account back in the approval queue, not back in the clan", async () => {
      await h.asUser(LEADER_A);
      await h.db.query("select remove_account($1)", [MEMBER_A]);
      expect(await scalar<boolean>("select restore_account($1)", [MEMBER_A])).toBe(true);

      await h.asSuperuser();
      const user = await h.db.query<{
        status: string;
        deleted_at: string | null;
        approved_at: string | null;
      }>(`select status, deleted_at, approved_at from users where id = '${MEMBER_A}'`);
      expect(user.rows[0]!.status).toBe("pending");
      expect(user.rows[0]!.deleted_at).toBeNull();
      expect(user.rows[0]!.approved_at).toBeNull();

      // approve_account() (017) is the ONE thing that grants membership. A
      // restore that re-granted it would be a second, quieter door into a clan.
      const live = await h.db.query(
        `select 1 from clan_roles where user_id = '${MEMBER_A}' and deleted_at is null`,
      );
      expect(live.rows).toHaveLength(0);
    });

    it("does nothing to an account that was never removed", async () => {
      await h.asUser(LEADER_A);
      expect(await scalar<boolean>("select restore_account($1)", [MEMBER_A])).toBe(false);
    });

    it("refuses another clan's member", async () => {
      await h.asUser(OWNER);
      await h.db.query("select remove_account($1)", [MEMBER_B]);
      await h.asUser(LEADER_A);
      expect(await scalar<boolean>("select restore_account($1)", [MEMBER_B])).toBe(false);
    });
  });

  // ── the audit log widening ────────────────────────────────────────────────
  //
  // 023 spelled out the consequence of audit_log's only read policy: a row with
  // a null clan_id is invisible to everybody, forever. The platform admin acting
  // on a clanless account writes exactly such a row.
  describe("audit_log for a clanless platform admin action", () => {
    it("is readable by the platform admin", async () => {
      await h.asUser(OWNER);
      await h.db.query("select send_account_message($1, $2, $3)", [
        APPLICANT,
        "Before we approve you",
        "Link your village first.",
      ]);

      const res = await h.db.query<{ clan_id: string | null }>(
        "select clan_id from audit_log where action = 'message'",
      );
      expect(res.rows).toHaveLength(1);
      // Null because the applicant holds no role yet — which is precisely the
      // row the old policy could never show anyone.
      expect(res.rows[0]!.clan_id).toBeNull();
    });

    it("is still hidden from an ordinary member", async () => {
      await h.asUser(OWNER);
      await h.db.query("select send_account_message($1, $2, $3)", [
        APPLICANT,
        "Before we approve you",
        "Link your village first.",
      ]);

      await h.asUser(MEMBER_A);
      expect((await h.db.query("select 1 from audit_log")).rows).toHaveLength(0);
    });
  });
});
