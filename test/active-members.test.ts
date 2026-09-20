// T12.4 — active_members() (041).
//
// Two things worth testing and one of them is easy to get wrong twice: the
// function must never hand out an email address, and NULL last_seen_at must
// sort LAST. Postgres orders NULLs FIRST on a descending sort, so a list titled
// "who is around" would otherwise open with the people who have never once
// opened the app.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const MEMBER_A = "11111111-0000-4000-8000-0000000000cc";
const MEMBER_B = "22222222-0000-4000-8000-0000000000cc";
const NEVER_SEEN = "33333333-0000-4000-8000-0000000000cc";
const OUTSIDER = "44444444-0000-4000-8000-0000000000cc";
const REMOVED = "55555555-0000-4000-8000-0000000000cc";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000cc";

interface MemberRow {
  id: string;
  username: string | null;
  display_name: string | null;
  last_seen_at: Date | null;
  is_online: boolean;
  clans: Array<{ clan: string; tag: string; role: string }>;
}

describe("041 — active_members", () => {
  let h: Harness;

  async function members(): Promise<MemberRow[]> {
    const res = await h.db.query<MemberRow>("select * from active_members()");
    return res.rows;
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
      truncate notifications, clan_roles, users, clans cascade;
      delete from auth.users;

      insert into clans (id, tag, name) values ('${CLAN_A}', '#2PP0JCCL', 'Clan A');

      insert into auth.users (id, email) values
        ('${MEMBER_A}',   'a@example.com'),
        ('${MEMBER_B}',   'b@example.com'),
        ('${NEVER_SEEN}', 'n@example.com'),
        ('${OUTSIDER}',   'o@example.com'),
        ('${REMOVED}',    'r@example.com');

      insert into users (id, email, username, status, last_seen_at) values
        ('${MEMBER_A}',   'a@example.com', 'alpha',  'approved', now() - interval '1 minute'),
        ('${MEMBER_B}',   'b@example.com', 'bravo',  'approved', now() - interval '2 hours'),
        ('${NEVER_SEEN}', 'n@example.com', 'ghost',  'approved', null),
        ('${OUTSIDER}',   'o@example.com', 'nobody', 'approved', now()),
        ('${REMOVED}',    'r@example.com', 'gone',   'approved', now());

      insert into clan_roles (user_id, clan_id, role) values
        ('${MEMBER_A}',   '${CLAN_A}', 'leader'),
        ('${MEMBER_B}',   '${CLAN_A}', 'member'),
        ('${NEVER_SEEN}', '${CLAN_A}', 'member'),
        ('${REMOVED}',    '${CLAN_A}', 'member');
    `);
  });

  it("lists every approved account, with their clan and role", async () => {
    await h.asUser(MEMBER_A);
    const rows = await members();
    // OUTSIDER holds no clan role, but is an approved ACCOUNT and appears —
    // the guard is on the CALLER, not on the people listed. Their clans array
    // is simply empty, which is how the platform owner shows up before
    // granting themselves anything.
    expect(rows.map((r) => r.username).sort()).toEqual(
      ["alpha", "bravo", "ghost", "gone", "nobody"].sort(),
    );

    const alpha = rows.find((r) => r.username === "alpha")!;
    expect(alpha.clans).toEqual([{ clan: "Clan A", tag: "#2PP0JCCL", role: "leader" }]);
  });

  // The privacy line this function is drawn around.
  it("returns no email column at all", async () => {
    await h.asUser(MEMBER_A);
    const rows = await members();
    expect(Object.keys(rows[0]!)).not.toContain("email");
    expect(JSON.stringify(rows)).not.toContain("@example.com");
  });

  it("does not widen a bare select on users", async () => {
    await h.asUser(MEMBER_A);
    const rows = await h.db.query<{ id: string }>("select id from users");
    expect(rows.rows.map((r) => r.id)).toEqual([MEMBER_A]);
  });

  it("marks only the last five minutes as online", async () => {
    await h.asUser(MEMBER_A);
    const rows = await members();
    expect(rows.find((r) => r.username === "alpha")!.is_online).toBe(true);
    expect(rows.find((r) => r.username === "bravo")!.is_online).toBe(false);
    // Never seen is not online, and must not be null-ish either — the page
    // branches on this boolean.
    expect(rows.find((r) => r.username === "ghost")!.is_online).toBe(false);
  });

  // Postgres sorts NULLs FIRST on a descending order, so without `nulls last`
  // the member who has never opened the app heads a list of who is around.
  it("sorts online first and never-seen last", async () => {
    await h.asUser(MEMBER_A);
    const rows = await members();

    // Stated as a property rather than as fixed positions: 'gone' and 'alpha'
    // are both online and their order between themselves is just whichever was
    // touched more recently, which is not what this test is about.
    const lastOnline = rows.map((r) => r.is_online).lastIndexOf(true);
    const firstOffline = rows.map((r) => r.is_online).indexOf(false);
    expect(lastOnline).toBeLessThan(firstOffline);

    // The one that breaks silently. NULL last_seen_at sorts FIRST under a
    // descending order unless it is told otherwise.
    expect(rows.at(-1)!.username).toBe("ghost");
    // And within the offline group, more recent is higher.
    const offline = rows.filter((r) => !r.is_online).map((r) => r.username);
    expect(offline).toEqual(["bravo", "ghost"]);
  });

  it("leaves out an account whose access was removed", async () => {
    await h.asSuperuser();
    await h.db.exec(
      `update users set deleted_at = now() where id = '${REMOVED}'`,
    );
    await h.asUser(MEMBER_A);
    expect((await members()).map((r) => r.username)).not.toContain("gone");
  });

  it("leaves out an account that is not approved yet", async () => {
    await h.asSuperuser();
    await h.db.exec(
      `update users set status = 'pending' where id = '${MEMBER_B}'`,
    );
    await h.asUser(MEMBER_A);
    expect((await members()).map((r) => r.username)).not.toContain("bravo");
  });

  // The guard, same as 037/038/040: it is about the CALLER.
  it("shows nothing to a caller with no clan role", async () => {
    await h.asUser(OUTSIDER);
    expect(await members()).toEqual([]);
  });

  it("is not callable by anon at all", async () => {
    await h.asAnon();
    await expect(members()).rejects.toThrow(/permission denied/);
  });

  // The list and the tally sit next to each other on the page, so they must
  // agree about what "online" means.
  it("agrees with platform_presence about who is online", async () => {
    await h.asUser(MEMBER_A);
    const online = (await members()).filter((r) => r.is_online).length;
    const res = await h.db.query<{ online_now: number }>(
      "select online_now from platform_presence()",
    );
    expect(online).toBe(res.rows[0]!.online_now);
  });
});
