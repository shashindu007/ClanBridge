// T4B.1 / T4B.6 — polls and CWL rosters, at the database layer.
//
// Driven through raw SQL rather than the supabase-js shim because these are
// policy and trigger tests: what matters is what Postgres refuses, and the shim
// implements no .rpc() anyway.
//
// Two things here are worth more than the rest:
//
//   1. The double-booking guard. The spec says it must live in the database and
//      not only in the form, "otherwise the leader double-books someone and does
//      not find out until CWL has already started" — by which point the roster
//      is locked in game and a clan is a player short for the week.
//
//   2. "Members see counts; leadership sees names" (T4B.4). Enforced by policy,
//      because a member with the anon key and a REST client is not looking at
//      the UI.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";

const LEADER_A = "11111111-0000-4000-8000-0000000000a1";
const MEMBER_A = "22222222-0000-4000-8000-0000000000a2";
const LEADER_B = "33333333-0000-4000-8000-0000000000b1";
const ELDER_A = "44444444-0000-4000-8000-0000000000a3";

const PLAYER_A = "aaaaaaaa-0000-4000-8000-00000000f001";
const PLAYER_A2 = "aaaaaaaa-0000-4000-8000-00000000f002";
const PLAYER_B = "bbbbbbbb-0000-4000-8000-00000000f001";

const ROSTER_A = "55555555-0000-4000-8000-0000000000a1";
const ROSTER_B = "55555555-0000-4000-8000-0000000000b1";

const POLL = "66666666-0000-4000-8000-000000000001";
const OPT_IN = "77777777-0000-4000-8000-000000000001";
const OPT_OUT = "77777777-0000-4000-8000-000000000002";

async function rows(h: Harness, sql: string): Promise<number> {
  const res = await h.db.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`);
  return res.rows[0]!.n;
}

describe("T4B — polls and rosters", () => {
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
      truncate cwl_roster_members, cwl_rosters, poll_responses, poll_options, polls,
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

      -- MEMBER_A owns two accounts, which is normal in a three-clan family
      -- (Architecture.md 7.1) and is why answers belong to a player, not a user.
      insert into players (id, clan_id, user_id, tag, name) values
        ('${PLAYER_A}',  '${CLAN_A}', '${MEMBER_A}', '#PY0LQGRJ', 'Member A'),
        ('${PLAYER_A2}', '${CLAN_A}', '${MEMBER_A}', '#PY0LQGRC', 'Member A alt'),
        ('${PLAYER_B}',  '${CLAN_B}', '${LEADER_B}', '#C2V89UGL', 'Member B');

      insert into cwl_rosters (id, season, clan_id, created_by) values
        ('${ROSTER_A}', '2026-08', '${CLAN_A}', '${LEADER_A}'),
        ('${ROSTER_B}', '2026-08', '${CLAN_B}', '${LEADER_B}');
    `);
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the double-booking guard (T4B.6)", () => {
    it("refuses the same player in two clans' rosters in one season", async () => {
      await h.db.exec(
        `insert into cwl_roster_members (roster_id, player_id, added_by)
         values ('${ROSTER_A}', '${PLAYER_A}', '${LEADER_A}')`,
      );

      await expect(
        h.db.exec(
          `insert into cwl_roster_members (roster_id, player_id, added_by)
           values ('${ROSTER_B}', '${PLAYER_A}', '${LEADER_B}')`,
        ),
      ).rejects.toThrow(/already in the Clan A roster for season 2026-08/);
    });

    it("names the clan they are already in, so the leader can act on it", async () => {
      await h.db.exec(
        `insert into cwl_roster_members (roster_id, player_id, added_by)
         values ('${ROSTER_B}', '${PLAYER_B}', '${LEADER_B}')`,
      );

      // The message has to identify WHERE the clash is. "duplicate key" would
      // send the leader hunting through three rosters by hand.
      await expect(
        h.db.exec(
          `insert into cwl_roster_members (roster_id, player_id, added_by)
           values ('${ROSTER_A}', '${PLAYER_B}', '${LEADER_A}')`,
        ),
      ).rejects.toThrow(/Clan B/);
    });

    it("allows the move once they are removed from the first roster (R4 soft delete)", async () => {
      await h.db.exec(`
        insert into cwl_roster_members (roster_id, player_id, added_by)
        values ('${ROSTER_A}', '${PLAYER_A}', '${LEADER_A}');
        update cwl_roster_members set deleted_at = now()
        where roster_id = '${ROSTER_A}' and player_id = '${PLAYER_A}';
      `);

      await h.db.exec(
        `insert into cwl_roster_members (roster_id, player_id, added_by)
         values ('${ROSTER_B}', '${PLAYER_A}', '${LEADER_B}')`,
      );

      expect(await rows(h, `select id from cwl_roster_members where deleted_at is null`)).toBe(1);
      // The dropped row survives — members ask when they were dropped, and the
      // answer should not depend on memory.
      expect(await rows(h, `select id from cwl_roster_members`)).toBe(2);
    });

    it("does not confuse different seasons", async () => {
      await h.db.exec(`
        insert into cwl_rosters (id, season, clan_id, created_by)
        values ('99999999-0000-4000-8000-000000000001', '2026-09', '${CLAN_B}', '${LEADER_B}');

        insert into cwl_roster_members (roster_id, player_id, added_by) values
          ('${ROSTER_A}', '${PLAYER_A}', '${LEADER_A}'),
          ('99999999-0000-4000-8000-000000000001', '${PLAYER_A}', '${LEADER_B}');
      `);
      expect(await rows(h, `select id from cwl_roster_members`)).toBe(2);
    });

    it("still refuses the same player twice in ONE roster", async () => {
      await h.db.exec(
        `insert into cwl_roster_members (roster_id, player_id, added_by)
         values ('${ROSTER_A}', '${PLAYER_A}', '${LEADER_A}')`,
      );
      await expect(
        h.db.exec(
          `insert into cwl_roster_members (roster_id, player_id, added_by)
           values ('${ROSTER_A}', '${PLAYER_A}', '${LEADER_A}')`,
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("a draft roster is the leader thinking out loud (T4B.8/T4B.10)", () => {
    it("is invisible to an ordinary member", async () => {
      await h.asUser(MEMBER_A);
      expect(await rows(h, `select id from cwl_rosters where id = '${ROSTER_A}'`)).toBe(0);
    });

    it("becomes visible once published", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `update cwl_rosters set status = 'published', published_at = now()
         where id = '${ROSTER_A}'`,
      );
      await h.asUser(MEMBER_A);
      expect(await rows(h, `select id from cwl_rosters where id = '${ROSTER_A}'`)).toBe(1);
    });

    it("is visible to its own leadership while still a draft", async () => {
      await h.asUser(LEADER_A);
      expect(await rows(h, `select id from cwl_rosters where id = '${ROSTER_A}'`)).toBe(1);
    });

    it("never shows another clan's roster, published or not", async () => {
      await h.asSuperuser();
      await h.db.exec(`update cwl_rosters set status = 'published' where id = '${ROSTER_B}'`);
      await h.asUser(MEMBER_A);
      expect(await rows(h, `select id from cwl_rosters where clan_id = '${CLAN_B}'`)).toBe(0);
    });

    it("refuses an elder trying to build a roster", async () => {
      await h.asUser(ELDER_A);
      await expect(
        h.db.exec(
          `insert into cwl_rosters (season, clan_id, created_by)
           values ('2026-10', '${CLAN_A}', '${ELDER_A}')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("refuses a leader of clan A building clan B's roster", async () => {
      await h.asUser(LEADER_A);
      await expect(
        h.db.exec(
          `insert into cwl_rosters (season, clan_id, created_by)
           values ('2026-10', '${CLAN_B}', '${LEADER_A}')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("polls (T4B.2-T4B.4)", () => {
    beforeEach(async () => {
      await h.asSuperuser();
      await h.db.exec(`
        insert into polls (id, scope, clan_id, poll_type, title, created_by, closes_at)
        values ('${POLL}', 'clan', '${CLAN_A}', 'cwl_availability',
                'CWL August', '${LEADER_A}', now() + interval '2 days');

        insert into poll_options (id, poll_id, label, sort_order) values
          ('${OPT_IN}',  '${POLL}', 'In',  1),
          ('${OPT_OUT}', '${POLL}', 'Out', 2);
      `);
    });

    it("lets a member answer for a player they own", async () => {
      await h.asUser(MEMBER_A);
      await h.db.exec(
        `insert into poll_responses (poll_id, player_id, option_id)
         values ('${POLL}', '${PLAYER_A}', '${OPT_IN}')`,
      );
      expect(await rows(h, `select id from poll_responses`)).toBe(1);
    });

    it("refuses an answer on behalf of someone else's player", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.exec(
          `insert into poll_responses (poll_id, player_id, option_id)
           values ('${POLL}', '${PLAYER_B}', '${OPT_IN}')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("accepts one answer per account for a member with two", async () => {
      await h.asUser(MEMBER_A);
      await h.db.exec(`
        insert into poll_responses (poll_id, player_id, option_id) values
          ('${POLL}', '${PLAYER_A}',  '${OPT_IN}'),
          ('${POLL}', '${PLAYER_A2}', '${OPT_OUT}');
      `);
      expect(await rows(h, `select id from poll_responses`)).toBe(2);
    });

    it("refuses a second answer for the same account", async () => {
      await h.asUser(MEMBER_A);
      await h.db.exec(
        `insert into poll_responses (poll_id, player_id, option_id)
         values ('${POLL}', '${PLAYER_A}', '${OPT_IN}')`,
      );
      await expect(
        h.db.exec(
          `insert into poll_responses (poll_id, player_id, option_id)
           values ('${POLL}', '${PLAYER_A}', '${OPT_OUT}')`,
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });

    // Editable until it closes, then locked — in the POLICY, not the form. A
    // closed poll that a crafted request can still edit is a poll whose result
    // is not final.
    it("refuses an answer once the poll has closed", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `update polls set closes_at = now() - interval '1 hour' where id = '${POLL}'`,
      );
      await h.asUser(MEMBER_A);
      await expect(
        h.db.exec(
          `insert into poll_responses (poll_id, player_id, option_id)
           values ('${POLL}', '${PLAYER_A}', '${OPT_IN}')`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    describe("members see counts, leadership sees names (T4B.4)", () => {
      beforeEach(async () => {
        await h.asSuperuser();
        await h.db.exec(`
          insert into poll_responses (poll_id, player_id, option_id) values
            ('${POLL}', '${PLAYER_A}',  '${OPT_IN}'),
            ('${POLL}', '${PLAYER_A2}', '${OPT_OUT}');
        `);
      });

      it("shows leadership every response", async () => {
        await h.asUser(LEADER_A);
        expect(await rows(h, `select id from poll_responses`)).toBe(2);
      });

      it("shows an elder only their own, not the clan's", async () => {
        await h.asUser(ELDER_A);
        expect(await rows(h, `select id from poll_responses`)).toBe(0);
      });

      it("still gives that elder the counts, via the aggregate function", async () => {
        await h.asUser(ELDER_A);
        const res = await h.db.query<{ label: string; votes: string }>(
          `select label, votes from poll_option_counts('${POLL}') order by sort_order`,
        );
        expect(res.rows.map((r) => [r.label, Number(r.votes)])).toEqual([
          ["In", 1],
          ["Out", 1],
        ]);
      });

      it("gives another clan's member nothing, counts included", async () => {
        await h.asUser(LEADER_B);
        expect(await rows(h, `select id from polls where id = '${POLL}'`)).toBe(0);
        const res = await h.db.query(`select * from poll_option_counts('${POLL}')`);
        expect(res.rows).toHaveLength(0);
      });
    });

    it("shows a family-scoped poll to every clan", async () => {
      await h.asSuperuser();
      await h.db.exec(
        `insert into polls (scope, clan_id, poll_type, title, created_by)
         values ('family', null, 'cwl_availability', 'CWL across all clans', '${LEADER_A}')`,
      );
      await h.asUser(LEADER_B);
      expect(await rows(h, `select id from polls where scope = 'family'`)).toBe(1);
    });

    it("refuses a clan poll with no clan, and a family poll with one", async () => {
      await h.asSuperuser();
      await expect(
        h.db.exec(
          `insert into polls (scope, clan_id, poll_type, title, created_by)
           values ('clan', null, 'general', 'bad', '${LEADER_A}')`,
        ),
      ).rejects.toThrow(/polls_scope_clan/);
      await expect(
        h.db.exec(
          `insert into polls (scope, clan_id, poll_type, title, created_by)
           values ('family', '${CLAN_A}', 'general', 'bad', '${LEADER_A}')`,
        ),
      ).rejects.toThrow(/polls_scope_clan/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("R4 — nothing is deleted", () => {
    it.each(["polls", "poll_options", "poll_responses", "cwl_rosters", "cwl_roster_members"])(
      "gives no delete privilege on %s, to anyone",
      async (table) => {
        for (const role of ["authenticated", "anon", "service_role"]) {
          const res = await h.db.query<{ ok: boolean }>(
            `select has_table_privilege('${role}', '${table}', 'delete') as ok`,
          );
          expect(res.rows[0]!.ok, `${role} can delete from ${table}`).toBe(false);
        }
      },
    );
  });
});
