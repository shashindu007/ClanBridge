// Phase 6 / migration 024 — the war schema, at the database layer.
//
// Three things here are worth more than the rest:
//
//   1. A DRAFT LINEUP IS INVISIBLE TO MEMBERS, enforced by policy rather than by
//      the page. A draft is the leader thinking out loud with people on it who
//      will be cut; showing it causes exactly the arguments publishing prevents.
//
//   2. THE PLAN AND THE OUTCOME STAY SEPARATE (R12). war_lineup_members is who
//      the leader picked, war_members is who the API says played, war_targets is
//      who was told to attack, war_attacks is who did. A sync job that writes any
//      of the human ones has destroyed the comparison T6.10 exists to show — so
//      service_role is granted select on them and nothing more, and that is
//      asserted here rather than trusted to a comment.
//
//   3. A war that has ended cannot be re-planned. Editing the plan once the
//      outcome is known is how "plan versus reality" quietly becomes a report
//      that always agrees with itself.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHarness, type Harness } from "./pg-harness";

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";

const LEADER_A = "11111111-0000-4000-8000-0000000000a1";
const MEMBER_A = "22222222-0000-4000-8000-0000000000a2";
const LEADER_B = "33333333-0000-4000-8000-0000000000b1";

const PLAYER_A = "aaaaaaaa-0000-4000-8000-00000000f001";
const PLAYER_A2 = "aaaaaaaa-0000-4000-8000-00000000f002";
const PLAYER_B = "bbbbbbbb-0000-4000-8000-00000000f001";

const WAR_A = "99999999-0000-4000-8000-0000000000a1";
const WAR_B = "99999999-0000-4000-8000-0000000000b1";
const LINEUP_A = "88888888-0000-4000-8000-0000000000a1";

async function count(h: Harness, sql: string): Promise<number> {
  const res = await h.db.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`);
  return res.rows[0]!.n;
}

describe("Phase 6 — the war schema (024)", () => {
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
      truncate war_lineup_members, war_lineups, war_targets, war_attacks,
               war_members, wars, clan_roles, players, users, clans cascade;
      delete from auth.users;

      insert into auth.users (id, email) values
        ('${LEADER_A}', 'leader-a@example.com'),
        ('${MEMBER_A}', 'member-a@example.com'),
        ('${LEADER_B}', 'leader-b@example.com');

      insert into users (id, email, status) values
        ('${LEADER_A}', 'leader-a@example.com', 'approved'),
        ('${MEMBER_A}', 'member-a@example.com', 'approved'),
        ('${LEADER_B}', 'leader-b@example.com', 'approved');

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');

      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER_A}', '${CLAN_A}', 'leader'),
        ('${MEMBER_A}', '${CLAN_A}', 'member'),
        ('${LEADER_B}', '${CLAN_B}', 'leader');

      insert into players (id, clan_id, user_id, tag, name) values
        ('${PLAYER_A}',  '${CLAN_A}', '${MEMBER_A}', '#PY0LQGRJ', 'Member A'),
        ('${PLAYER_A2}', '${CLAN_A}', null,          '#PY0LQGRC', 'Member A2'),
        ('${PLAYER_B}',  '${CLAN_B}', '${LEADER_B}', '#C2V89UGL', 'Member B');

      insert into wars (id, clan_id, state, start_time) values
        ('${WAR_A}', '${CLAN_A}', 'inWar', now()),
        ('${WAR_B}', '${CLAN_B}', 'inWar', now());

      -- PLAYER_A is in the war; PLAYER_A2 deliberately is not, so "you cannot
      -- assign a target to somebody who is not playing" is exercised.
      insert into war_members (war_id, player_id, map_position, th_level) values
        ('${WAR_A}', '${PLAYER_A}', 1, 15),
        ('${WAR_B}', '${PLAYER_B}', 1, 14);
    `);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // war_members — the API roster (R11 game fact)
  // ───────────────────────────────────────────────────────────────────────────
  describe("war_members", () => {
    it("is readable by a member of that clan", async () => {
      await h.asUser(MEMBER_A);
      expect(await count(h, `select 1 from war_members`)).toBe(1);
    });

    it("never leaks another clan's roster (R3)", async () => {
      await h.asUser(MEMBER_A);
      expect(await count(h, `select 1 from war_members where war_id = '${WAR_B}'`)).toBe(0);
    });

    it("shows anon nothing", async () => {
      await h.asAnon();
      expect(await count(h, `select 1 from war_members`)).toBe(0);
    });

    // R11 — a game fact. A session may read it and never write it, no matter
    // whose clan it is or what role they hold.
    it("cannot be written by a leader", async () => {
      await h.asUser(LEADER_A);
      await expect(
        h.db.exec(
          `insert into war_members (war_id, player_id) values ('${WAR_A}', '${PLAYER_A2}');`,
        ),
      ).rejects.toThrow(/permission denied|row-level security/i);
    });

    it("defaults to two attacks per member, unlike CWL's one", async () => {
      await h.asSuperuser();
      const res = await h.db.query<{ attacks_allowed: number }>(
        `select attacks_allowed from war_members where war_id = '${WAR_A}'`,
      );
      expect(res.rows[0]!.attacks_allowed).toBe(2);
    });

    // The idempotency key. Without it the sync duplicates the whole roster on
    // every run, silently (R5).
    it("refuses a duplicate roster row", async () => {
      await h.asSuperuser();
      await expect(
        h.db.exec(
          `insert into war_members (war_id, player_id) values ('${WAR_A}', '${PLAYER_A}');`,
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T6.4 — assign_war_target
  // ───────────────────────────────────────────────────────────────────────────
  describe("assign_war_target (T6.4)", () => {
    it("lets leadership assign, and audits it", async () => {
      await h.asUser(LEADER_A);
      await h.db.exec(`select assign_war_target('${WAR_A}', '${PLAYER_A}', 3::smallint, 'hit the AQ');`);

      expect(await count(h, `select 1 from war_targets where war_id = '${WAR_A}'`)).toBe(1);
      expect(
        await count(h, `select 1 from audit_log where action = 'assign-target'`),
      ).toBe(1);
    });

    // 003's comment says reassigning UPDATES the row and records the change,
    // rather than inserting a second target. Two live targets for one player is
    // not a plan.
    it("updates rather than duplicating when reassigned", async () => {
      await h.asUser(LEADER_A);
      await h.db.exec(`select assign_war_target('${WAR_A}', '${PLAYER_A}', 3::smallint);`);
      await h.db.exec(`select assign_war_target('${WAR_A}', '${PLAYER_A}', 7::smallint);`);

      expect(await count(h, `select 1 from war_targets where war_id = '${WAR_A}'`)).toBe(1);

      const res = await h.db.query<{ target_position: number }>(
        `select target_position from war_targets where war_id = '${WAR_A}'`,
      );
      expect(res.rows[0]!.target_position).toBe(7);
      // Both assignments recorded — "when was I moved off base 3" has an answer.
      expect(await count(h, `select 1 from audit_log where action = 'assign-target'`)).toBe(2);
    });

    it("refuses an ordinary member", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.exec(`select assign_war_target('${WAR_A}', '${PLAYER_A}', 3::smallint);`),
      ).rejects.toThrow(/only a leader or co-leader/i);
    });

    it("refuses the leader of another clan (R3)", async () => {
      await h.asUser(LEADER_B);
      await expect(
        h.db.exec(`select assign_war_target('${WAR_A}', '${PLAYER_A}', 3::smallint);`),
      ).rejects.toThrow(/only a leader or co-leader/i);
    });

    // Otherwise the missed-attack list contains somebody who was never able to
    // attack, and the leader spends the evening chasing them.
    it("refuses a player who is not in the war", async () => {
      await h.asUser(LEADER_A);
      await expect(
        h.db.exec(`select assign_war_target('${WAR_A}', '${PLAYER_A2}', 3::smallint);`),
      ).rejects.toThrow(/not in this war/i);
    });

    // R12 — the plan is compared to reality, never rewritten to match it.
    it("refuses to change the plan once the war has ended", async () => {
      await h.asSuperuser();
      await h.db.exec(`update wars set state = 'warEnded' where id = '${WAR_A}';`);

      await h.asUser(LEADER_A);
      await expect(
        h.db.exec(`select assign_war_target('${WAR_A}', '${PLAYER_A}', 3::smallint);`),
      ).rejects.toThrow(/has ended/i);
    });

    it("clears a target softly, keeping the record (R4)", async () => {
      await h.asUser(LEADER_A);
      await h.db.exec(`select assign_war_target('${WAR_A}', '${PLAYER_A}', 3::smallint);`);
      await h.db.exec(`select clear_war_target('${WAR_A}', '${PLAYER_A}');`);

      expect(
        await count(h, `select 1 from war_targets where war_id = '${WAR_A}' and deleted_at is null`),
      ).toBe(0);

      await h.asSuperuser();
      expect(await count(h, `select 1 from war_targets where war_id = '${WAR_A}'`)).toBe(1);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // T6.8 — lineups (R11 human decision)
  // ───────────────────────────────────────────────────────────────────────────
  describe("war_lineups (T6.8)", () => {
    beforeEach(async () => {
      await h.asUser(LEADER_A);
      await h.db.exec(`
        insert into war_lineups (id, clan_id, size, created_by)
        values ('${LINEUP_A}', '${CLAN_A}', 15, '${LEADER_A}');

        insert into war_lineup_members (lineup_id, player_id, added_by)
        values ('${LINEUP_A}', '${PLAYER_A}', '${LEADER_A}');
      `);
    });

    it("lets leadership build a draft", async () => {
      await h.asUser(LEADER_A);
      expect(await count(h, `select 1 from war_lineups where status = 'draft'`)).toBe(1);
    });

    // The headline case. Enforced by policy, so the page cannot leak it.
    it("hides a draft from ordinary members", async () => {
      await h.asUser(MEMBER_A);
      expect(await count(h, `select 1 from war_lineups`)).toBe(0);
      expect(await count(h, `select 1 from war_lineup_members`)).toBe(0);
    });

    it("shows it to members once published", async () => {
      await h.asUser(LEADER_A);
      await h.db.exec(
        `update war_lineups set status = 'published', published_at = now()
         where id = '${LINEUP_A}';`,
      );

      await h.asUser(MEMBER_A);
      expect(await count(h, `select 1 from war_lineups`)).toBe(1);
      expect(await count(h, `select 1 from war_lineup_members`)).toBe(1);
    });

    it("never shows another clan's lineup, published or not (R3)", async () => {
      await h.asUser(LEADER_A);
      await h.db.exec(
        `update war_lineups set status = 'published' where id = '${LINEUP_A}';`,
      );

      await h.asUser(LEADER_B);
      expect(await count(h, `select 1 from war_lineups`)).toBe(0);
    });

    it("refuses a member building a lineup", async () => {
      await h.asUser(MEMBER_A);
      await expect(
        h.db.exec(
          `insert into war_lineups (clan_id, size, created_by)
           values ('${CLAN_A}', 15, '${MEMBER_A}');`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("allows one entry per player per lineup", async () => {
      await h.asUser(LEADER_A);
      await expect(
        h.db.exec(
          `insert into war_lineup_members (lineup_id, player_id, added_by)
           values ('${LINEUP_A}', '${PLAYER_A}', '${LEADER_A}');`,
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    });

    // R11, as a privilege rather than a comment. A sync job re-runs every
    // fifteen minutes; if it could write here, one routine tick would erase an
    // hour of the leader's work and R4 leaves no deleted row to recover.
    it("cannot be written by a sync job", async () => {
      await h.asServiceRole();
      await expect(
        h.db.exec(
          `insert into war_lineup_members (lineup_id, player_id, added_by)
           values ('${LINEUP_A}', '${PLAYER_A2}', '${LEADER_A}');`,
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it("is still readable by a sync job, for T6.10", async () => {
      await h.asServiceRole();
      expect(await count(h, `select 1 from war_lineup_members`)).toBe(1);
    });
  });
});
