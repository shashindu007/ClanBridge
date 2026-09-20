// T10.1 — migration 030, against real Postgres.
//
// Two new columns on `users`, and no new policy — which is the part worth
// testing. 015's "own profile update" and its guard trigger were written before
// these columns existed, so whether a member can set their own username, cannot
// set anybody else's, and still cannot touch status or is_platform_admin is
// decided by how those two interact with a schema they predate. That is exactly
// the sort of thing that is assumed rather than checked.
//
// The password itself is not here and cannot be: it lives in
// auth.users.encrypted_password, written only by Supabase's own updateUser. This
// database stores no credential material.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const ALICE = "11111111-0000-4000-8000-00000000010a";
const BOB = "22222222-0000-4000-8000-00000000010b";

async function username(h: Harness, id: string): Promise<string | null> {
  await h.asSuperuser();
  const res = await h.db.query<{ username: string | null }>(
    `select username from users where id = $1`,
    [id],
  );
  return res.rows[0]?.username ?? null;
}

describe("030 — username and password_set_at", () => {
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
      truncate notifications, member_snapshots, clan_roles, players, audit_log, users, clans cascade;
      delete from auth.users;

      insert into auth.users (id, email) values
        ('${ALICE}', 'alice@example.com'),
        ('${BOB}',   'bob@example.com');

      insert into users (id, email) values
        ('${ALICE}', 'alice@example.com'),
        ('${BOB}',   'bob@example.com');
    `);
  });

  describe("the shape of a username", () => {
    it("accepts the ordinary ones", async () => {
      await h.asUser(ALICE);
      for (const name of ["abc", "shashi", "shashi_007", "x".repeat(20)]) {
        await h.db.query(`update users set username = $1 where id = $2`, [name, ALICE]);
        expect(await username(h, ALICE)).toBe(name);
        await h.asUser(ALICE);
      }
    });

    // The constraint is the enforced half of the rule; lib/account.ts is the
    // half that produces a sentence. Both exist, and this is the one that holds
    // if a caller forgets the other.
    it.each([
      ["too short", "ab"],
      ["too long", "x".repeat(21)],
      ["uppercase", "Shashi"],
      ["a space", "sha shi"],
      ["a hyphen", "sha-shi"],
      ["a dot", "sha.shi"],
      ["punctuation", "shashi!"],
      ["an accent", "shashí"],
    ])("refuses %s", async (_label, name) => {
      await h.asUser(ALICE);
      await expect(
        h.db.query(`update users set username = $1 where id = $2`, [name, ALICE]),
      ).rejects.toThrow();
    });

    it("allows null, because every account starts without one", async () => {
      expect(await username(h, ALICE)).toBeNull();
    });
  });

  describe("uniqueness", () => {
    it("refuses a handle somebody else already has", async () => {
      await h.asUser(ALICE);
      await h.db.query(`update users set username = 'shashi' where id = $1`, [ALICE]);

      await h.asUser(BOB);
      await expect(
        h.db.query(`update users set username = 'shashi' where id = $1`, [BOB]),
      ).rejects.toThrow(/users_username_key|duplicate key/);
    });

    // Two constraints say "no case collisions" and only one of them can be
    // demonstrated by writing rows: the check constraint refuses uppercase
    // outright, even to a superuser, so 'Shashi' and 'shashi' can never both
    // exist to collide.
    //
    // The index is the belt to that pair of braces, and it is asserted by
    // definition rather than by behaviour. It matters if the check constraint is
    // ever relaxed to preserve case — at which point "Shashi" and "shashi"
    // become two members with one handle unless the index is already folding.
    it("refuses an uppercase handle outright, so a case collision cannot arise", async () => {
      await h.asSuperuser();
      await expect(
        h.db.query(`update users set username = 'Shashi' where id = $1`, [ALICE]),
      ).rejects.toThrow(/users_username_check/);
    });

    it("indexes on lower(username), so folding survives a relaxed constraint", async () => {
      await h.asSuperuser();
      const res = await h.db.query<{ indexdef: string }>(
        `select indexdef from pg_indexes
         where schemaname = 'public' and indexname = 'users_username_key'`,
      );
      expect(res.rows[0]!.indexdef).toMatch(/lower\(username\)/);
      // Partial, or a soft-deleted account keeps its handle forever (R4).
      expect(res.rows[0]!.indexdef).toMatch(/deleted_at IS NULL/i);
    });

    // R4 — nothing is hard deleted here, so a soft-deleted account would
    // otherwise hold its handle forever.
    it("frees the handle when the account is soft deleted", async () => {
      await h.asSuperuser();
      await h.db.query(`update users set username = 'shashi' where id = $1`, [ALICE]);
      await h.db.query(`update users set deleted_at = now() where id = $1`, [ALICE]);

      await h.asUser(BOB);
      await h.db.query(`update users set username = 'shashi' where id = $1`, [BOB]);
      expect(await username(h, BOB)).toBe("shashi");
    });

    // Re-entrancy. /account/setup writes the username first and the flag last,
    // so a member who fails at the password step lands back on the form with
    // their handle already saved and submits it again.
    it("lets a member rewrite their own handle to the value it already has", async () => {
      await h.asUser(ALICE);
      await h.db.query(`update users set username = 'shashi' where id = $1`, [ALICE]);
      await h.db.query(`update users set username = 'shashi' where id = $1`, [ALICE]);
      expect(await username(h, ALICE)).toBe("shashi");
    });
  });

  describe("who may write them", () => {
    it("lets a member set their own", async () => {
      await h.asUser(ALICE);
      await h.db.query(
        `update users set username = 'alice', password_set_at = now() where id = $1`,
        [ALICE],
      );

      await h.asSuperuser();
      const res = await h.db.query<{ username: string; password_set_at: string | null }>(
        `select username, password_set_at from users where id = $1`,
        [ALICE],
      );
      expect(res.rows[0]!.username).toBe("alice");
      expect(res.rows[0]!.password_set_at).not.toBeNull();
    });

    // 015's "own profile update" is `using (id = auth.uid())`, so the row is
    // invisible to the update rather than refused — no rows change, and no error
    // is raised. Asserting the VALUE rather than the outcome is the only way to
    // catch it.
    it("does not let a member set somebody else's", async () => {
      await h.asUser(ALICE);
      await h.db.query(`update users set username = 'stolen' where id = $1`, [BOB]);
      expect(await username(h, BOB)).toBeNull();
    });

    it("does not let an anonymous visitor set anyone's", async () => {
      await h.asAnon();
      await h.db
        .query(`update users set username = 'anon' where id = $1`, [ALICE])
        .catch(() => undefined);
      expect(await username(h, ALICE)).toBeNull();
    });
  });

  // The columns are new; the escalation guard is not. 030 adds no policy, so the
  // question is whether widening what a member may write to their own row
  // widened it further than intended.
  describe("the 015 guard still holds", () => {
    it("refuses is_platform_admin alongside a username", async () => {
      await h.asUser(ALICE);
      await expect(
        h.db.query(
          `update users set username = 'alice', is_platform_admin = true where id = $1`,
          [ALICE],
        ),
      ).rejects.toThrow(/is_platform_admin cannot be set directly/);
    });

    it("refuses status alongside a username", async () => {
      await h.asUser(ALICE);
      await expect(
        h.db.query(
          `update users set username = 'alice', status = 'approved' where id = $1`,
          [ALICE],
        ),
      ).rejects.toThrow(/approve_account/);
    });

    // Setting the flag without a password is self-sabotage, not escalation: the
    // Sign in button then fails for that account and they are back on the magic
    // link. It is left writable deliberately, because the guard cannot tell the
    // setup action's write from anybody else's — 030 says so at more length.
    it("permits password_set_at, which is the deliberate hole", async () => {
      await h.asUser(ALICE);
      await h.db.query(`update users set password_set_at = now() where id = $1`, [ALICE]);

      await h.asSuperuser();
      const res = await h.db.query<{ password_set_at: string | null }>(
        `select password_set_at from users where id = $1`,
        [ALICE],
      );
      expect(res.rows[0]!.password_set_at).not.toBeNull();
    });
  });

  // R-nothing-stores-credentials. If this ever fails, something has added a
  // password column to this database and it must be reverted, not accommodated.
  it("stores no credential material", async () => {
    await h.asSuperuser();
    const res = await h.db.query<{ column_name: string }>(`
      select column_name
      from information_schema.columns
      where table_schema = 'public'
        and (column_name ilike '%password%' or column_name ilike '%secret%'
             or column_name ilike '%hash%'  or column_name ilike '%salt%')
    `);
    // password_set_at is a timestamp, not a credential. Nothing else may match.
    expect(res.rows.map((r) => r.column_name)).toEqual(["password_set_at"]);
  });
});
