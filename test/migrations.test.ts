// QA for T1.4-T1.9 — the migrations, executed against a real Postgres.
//
// Everything here runs the actual files in supabase/migrations/. If a policy is
// wrong, a constraint is missing, or the SQL does not parse, these fail.
//
// The clan-isolation block is T3.7 brought forward: R3 calls the missing clan
// filter the most common bug in this project, and these policies are the net
// that catches it.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LIVE_ONLY_MIGRATIONS,
  PHASE1_MIGRATIONS,
  PHASE1_TABLES,
  RETIRED_MIGRATIONS,
  createHarness,
  readMigration,
  readSeed,
  type Harness,
} from "./pg-harness";

// Fixed ids so failures name something recognisable.
const CLAN_A = "aaaaaaaa-0000-4000-8000-000000000001";
const CLAN_B = "bbbbbbbb-0000-4000-8000-000000000001";
const USER_A = "aaaaaaaa-0000-4000-8000-000000000002";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";
const PLAYER_A = "aaaaaaaa-0000-4000-8000-000000000003";
const PLAYER_B = "bbbbbbbb-0000-4000-8000-000000000003";

/**
 * One row in every one of the 20 tables, split across two clans.
 *
 * Written as superuser, so RLS does not apply here — this mirrors how sync jobs
 * write with the service role key.
 */
async function seedFixtures(h: Harness) {
  await h.asSuperuser();
  await h.db.exec(`
    insert into clans (id, tag, name) values
      ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
      ('${CLAN_B}', '#8QUCLJY0', 'Clan B');

    insert into auth.users (id, email) values
      ('${USER_A}', 'a@example.com'),
      ('${USER_B}', 'b@example.com');

    -- Approved: since 046, a role only grants access to a live, approved
    -- account, which is the only kind approve_account() ever gives one to.
    insert into users (id, email, status) values
      ('${USER_A}', 'a@example.com', 'approved'),
      ('${USER_B}', 'b@example.com', 'approved');

    insert into clan_roles (user_id, clan_id, role) values
      ('${USER_A}', '${CLAN_A}', 'member'),
      ('${USER_B}', '${CLAN_B}', 'leader');

    insert into players (id, clan_id, user_id, tag, name, th_level) values
      ('${PLAYER_A}', '${CLAN_A}', '${USER_A}', '#PY0LQGRJ', 'Player A', 15),
      ('${PLAYER_B}', '${CLAN_B}', '${USER_B}', '#C2V89UGL', 'Player B', 14);

    -- T11.3. One per clan, like everything else here: "has fixture data present"
    -- and "can read every table" both iterate PHASE1_TABLES asserting a row
    -- exists, so a new table with no seed row fails both.
    insert into player_nicknames (player_id, nickname, set_by) values
      ('${PLAYER_A}', 'main', '${USER_A}'),
      ('${PLAYER_B}', 'alt',  '${USER_B}');

    insert into cwl_seasons (id, clan_id, season, league) values
      ('11111111-0000-4000-8000-000000000001', '${CLAN_A}', '2026-07', 'Crystal I'),
      ('22222222-0000-4000-8000-000000000001', '${CLAN_B}', '2026-07', 'Gold II');

    insert into cwl_wars (id, season_id, war_tag, day_number, opponent_name) values
      ('11111111-0000-4000-8000-000000000002', '11111111-0000-4000-8000-000000000001', '#8G9QRVJL', 1, 'Foe A'),
      ('22222222-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001', '#9CUVPYQ2', 1, 'Foe B');

    -- 019. The roster missed attacks are derived from: roster minus attacks.
    insert into cwl_war_members (war_id, player_id, map_position, th_level) values
      ('11111111-0000-4000-8000-000000000002', '${PLAYER_A}', 1, 16),
      ('22222222-0000-4000-8000-000000000002', '${PLAYER_B}', 1, 15);

    insert into cwl_attacks (war_id, player_id, attack_order, stars, destruction) values
      ('11111111-0000-4000-8000-000000000002', '${PLAYER_A}', 1, 3, 100.00),
      ('22222222-0000-4000-8000-000000000002', '${PLAYER_B}', 1, 2, 75.50);

    -- 048. The rest of the group, one row per clan's season.
    insert into cwl_group_clans (season_id, clan_tag, name) values
      ('11111111-0000-4000-8000-000000000001', '#2PP', 'Group rival A'),
      ('22222222-0000-4000-8000-000000000001', '#2QQ', 'Group rival B');

    insert into cwl_group_wars (season_id, war_tag, day_number, state, clan_tag, opponent_tag) values
      ('11111111-0000-4000-8000-000000000001', '#8G9QRVJL', 1, 'warEnded', '#2PP', '#2QQ'),
      ('22222222-0000-4000-8000-000000000001', '#9CUVPYQ2', 1, 'warEnded', '#2QQ', '#2PP');

    insert into cwl_bonuses (season_id, player_id, awarded_by, note) values
      ('11111111-0000-4000-8000-000000000001', '${PLAYER_A}', '${USER_A}', 'top stars'),
      ('22222222-0000-4000-8000-000000000001', '${PLAYER_B}', '${USER_B}', 'top stars');

    -- 010. One poll per clan, identically shaped, so a cross-clan leak in the
    -- policy shows up as a visible row rather than as an absence.
    insert into polls (id, scope, clan_id, poll_type, title, created_by) values
      ('33333333-0000-4000-8000-00000000000a', 'clan', '${CLAN_A}',
       'cwl_availability', 'CWL August — Clan A', '${USER_A}'),
      ('33333333-0000-4000-8000-00000000000b', 'clan', '${CLAN_B}',
       'cwl_availability', 'CWL August — Clan B', '${USER_B}');

    insert into poll_options (id, poll_id, label, sort_order) values
      ('44444444-0000-4000-8000-00000000000a', '33333333-0000-4000-8000-00000000000a', 'In', 1),
      ('44444444-0000-4000-8000-00000000000b', '33333333-0000-4000-8000-00000000000b', 'In', 1);

    insert into poll_responses (poll_id, player_id, option_id) values
      ('33333333-0000-4000-8000-00000000000a', '${PLAYER_A}', '44444444-0000-4000-8000-00000000000a'),
      ('33333333-0000-4000-8000-00000000000b', '${PLAYER_B}', '44444444-0000-4000-8000-00000000000b');

    -- 011. The PLAN (R12) — distinct from cwl_war_members, which is the outcome.
    insert into cwl_rosters (id, season, clan_id, created_by) values
      ('55555555-0000-4000-8000-00000000000a', '2026-07', '${CLAN_A}', '${USER_A}'),
      ('55555555-0000-4000-8000-00000000000b', '2026-07', '${CLAN_B}', '${USER_B}');

    insert into cwl_roster_members (roster_id, player_id, position, added_by) values
      ('55555555-0000-4000-8000-00000000000a', '${PLAYER_A}', 1, '${USER_A}'),
      ('55555555-0000-4000-8000-00000000000b', '${PLAYER_B}', 1, '${USER_B}');

    insert into wars (id, clan_id, opponent_name, start_time) values
      ('11111111-0000-4000-8000-000000000003', '${CLAN_A}', 'Foe A', now()),
      ('22222222-0000-4000-8000-000000000003', '${CLAN_B}', 'Foe B', now());

    insert into war_targets (war_id, player_id, target_position, assigned_by) values
      ('11111111-0000-4000-8000-000000000003', '${PLAYER_A}', 3, '${USER_A}'),
      ('22222222-0000-4000-8000-000000000003', '${PLAYER_B}', 5, '${USER_B}');

    insert into war_attacks (war_id, player_id, attack_order, stars, destruction) values
      ('11111111-0000-4000-8000-000000000003', '${PLAYER_A}', 1, 3, 100.00),
      ('22222222-0000-4000-8000-000000000003', '${PLAYER_B}', 1, 1, 42.00);

    -- 024 — the API's war roster. war_attacks above is what happened; this is
    -- who could have. The missed-attack list is the difference (R12).
    insert into war_members (war_id, player_id, map_position, th_level) values
      ('11111111-0000-4000-8000-000000000003', '${PLAYER_A}', 1, 15),
      ('22222222-0000-4000-8000-000000000003', '${PLAYER_B}', 1, 14);

    -- 026 — the other side. No players row and no FK to one: they are not
    -- members of any of the three clans, and putting them in the players table
    -- would place strangers in the member directory permanently (R4).
    insert into war_opponent_members (war_id, tag, name, map_position, th_level) values
      ('11111111-0000-4000-8000-000000000003', '#C2V89UGL', 'Opponent A', 1, 15),
      ('22222222-0000-4000-8000-000000000003', '#C2V89UGJ', 'Opponent B', 1, 14);

    -- 024 — and the leader's intended lineup, which no sync job may write.
    insert into war_lineups (id, clan_id, size, status, created_by) values
      ('11111111-0000-4000-8000-000000000009', '${CLAN_A}', 15, 'published', '${USER_A}'),
      ('22222222-0000-4000-8000-000000000009', '${CLAN_B}', 15, 'published', '${USER_B}');

    insert into war_lineup_members (lineup_id, player_id, position, added_by) values
      ('11111111-0000-4000-8000-000000000009', '${PLAYER_A}', 1, '${USER_A}'),
      ('22222222-0000-4000-8000-000000000009', '${PLAYER_B}', 1, '${USER_B}');

    insert into raid_seasons (id, clan_id, start_time) values
      ('11111111-0000-4000-8000-000000000004', '${CLAN_A}', now()),
      ('22222222-0000-4000-8000-000000000004', '${CLAN_B}', now());

    insert into raid_participants (raid_season_id, player_id, attacks_used, loot) values
      ('11111111-0000-4000-8000-000000000004', '${PLAYER_A}', 6, 12000),
      ('22222222-0000-4000-8000-000000000004', '${PLAYER_B}', 5, 9000);

    insert into clan_games (id, clan_id, season) values
      ('11111111-0000-4000-8000-000000000005', '${CLAN_A}', '2026-07'),
      ('22222222-0000-4000-8000-000000000005', '${CLAN_B}', '2026-07');

    insert into clan_games_scores (clan_games_id, player_id, points) values
      ('11111111-0000-4000-8000-000000000005', '${PLAYER_A}', 4000),
      ('22222222-0000-4000-8000-000000000005', '${PLAYER_B}', 2500);

    insert into base_layouts (id, clan_id, uploaded_by, th_level, layout_type, copy_link) values
      ('33333333-0000-4000-8000-000000000008', '${CLAN_A}', '${USER_A}', 15, 'war',
       'https://link.clashofclans.com/a'),
      ('44444444-0000-4000-8000-000000000008', '${CLAN_B}', '${USER_B}', 14, 'farming',
       'https://link.clashofclans.com/b');

    -- 028. One vote per clan, so the RLS probe has something to be denied.
    insert into base_layout_votes (layout_id, user_id) values
      ('33333333-0000-4000-8000-000000000008', '${USER_A}'),
      ('44444444-0000-4000-8000-000000000008', '${USER_B}');

    insert into announcements (clan_id, author_id, title, body) values
      ('${CLAN_A}', '${USER_A}', 'A notice', 'body'),
      ('${CLAN_B}', '${USER_B}', 'B notice', 'body');

    insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
      ('${USER_A}', 'https://push.example/a', 'k', 'k'),
      ('${USER_B}', 'https://push.example/b', 'k', 'k');

    -- 039. Filed under the RECIPIENT's clan, which is what clan_id means on this
    -- table — the authority the sender acted under. The senders are crossed over
    -- only because this fixture holds two accounts; send_account_message()
    -- refuses to write a message to yourself.
    insert into account_messages (recipient_id, sender_id, clan_id, subject, body) values
      ('${USER_A}', '${USER_B}', '${CLAN_A}', 'Missed war attacks', 'Please use both attacks.'),
      ('${USER_B}', '${USER_A}', '${CLAN_B}', 'Missed war attacks', 'Please use both attacks.');

    -- 042. One per user, like everything else here.
    insert into feedback (user_id, rating, body) values
      ('${USER_A}', 5, 'Keeps our CWL record safe.'),
      ('${USER_B}', 4, 'War board saves us so much time.');

    -- 040. account_messages above is a tombstone now; these are the live feed.
    -- One per clan, like everything else here.
    insert into notifications (recipient_id, sender_id, clan_id, kind, title, body, url) values
      ('${USER_A}', '${USER_B}', '${CLAN_A}', 'announcements', 'A notice', 'body', '/'),
      ('${USER_B}', '${USER_A}', '${CLAN_B}', 'announcements', 'A notice', 'body', '/');

    -- Only USER_A has a preference row. USER_B deliberately has none, so the
    -- "absent row means every kind is enabled" rule in 023 is exercised by
    -- push_targets() rather than merely asserted in a comment.
    insert into notification_preferences (user_id) values ('${USER_A}');

    insert into sync_log (job_type, clan_id, status) values
      ('clans', '${CLAN_A}', 'success'),
      ('clans', '${CLAN_B}', 'success');

    insert into audit_log (user_id, clan_id, action, entity) values
      ('${USER_A}', '${CLAN_A}', 'create', 'cwl_bonuses'),
      ('${USER_B}', '${CLAN_B}', 'create', 'cwl_bonuses');

    insert into member_snapshots (clan_id, player_id, donations, donations_received, trophies) values
      ('${CLAN_A}', '${PLAYER_A}', 1200, 900, 5200),
      ('${CLAN_B}', '${PLAYER_B}', 400, 1500, 4100);

    -- 036. Identically shaped per clan, like member_snapshots above.
    insert into player_progress (player_id, clan_id, th_level, units) values
      ('${PLAYER_A}', '${CLAN_A}', 15, '[]'),
      ('${PLAYER_B}', '${CLAN_B}', 14, '[]');

    -- 052. Same shape again: one per clan.
    insert into donation_counters (player_id, clan_id, troops_donated, spells_donated,
                                   sieges_donated, clan_donations, clan_donations_received) values
      ('${PLAYER_A}', '${CLAN_A}', 145000, 3700, 600, 1200, 900),
      ('${PLAYER_B}', '${CLAN_B}', 90000, 2100, 300, 400, 1500);
  `);
}

async function count(h: Harness, table: string, where = "true"): Promise<number> {
  const res = await h.db.query<{ n: number }>(
    `select count(*)::int as n from ${table} where ${where}`,
  );
  return res.rows[0]!.n;
}

describe("T1.4-T1.9 — migrations apply to a real Postgres", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("applies all six migrations in order", async () => {
    // Reaching beforeAll without throwing is the assertion; this confirms the
    // schema is actually there rather than silently empty.
    const res = await h.db.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public'`,
    );
    expect(res.rows[0]!.n).toBe(PHASE1_TABLES.length);
  });

  it("creates every table the harness expects", async () => {
    const res = await h.db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    expect(res.rows.map((r) => r.tablename)).toEqual([...PHASE1_TABLES]);
  });

  // T1.9 structural half: RLS on, and a policy present. A table added later
  // without either fails here rather than leaking in production.
  it("enables row level security on every table", async () => {
    const res = await h.db.query<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public' and rowsecurity = false
       order by tablename`,
    );
    expect(res.rows.map((r) => r.tablename)).toEqual([]);
  });

  it("defines at least one policy on every table", async () => {
    const res = await h.db.query<{ tablename: string }>(
      `select t.tablename from pg_tables t
       where t.schemaname = 'public'
         and not exists (
           select 1 from pg_policies p
           where p.schemaname = 'public' and p.tablename = t.tablename
         )
       order by t.tablename`,
    );
    expect(res.rows.map((r) => r.tablename)).toEqual([]);
  });

  // 006 shipped select-only; 015 added the first writes, for leader-managed
  // clans. What must never appear is a DELETE policy — R4 says nothing is ever
  // deleted, so granting one would make that rule unenforceable at the database.
  it("defines no delete policy anywhere (R4)", async () => {
    const res = await h.db.query<{ tablename: string; policyname: string }>(
      `select tablename, policyname from pg_policies
       where schemaname = 'public' and cmd = 'DELETE'`,
    );
    expect(res.rows).toEqual([]);
  });

  it("grants no DELETE privilege to any end-user role (R4)", async () => {
    const res = await h.db.query<{ table_name: string; grantee: string }>(
      `select table_name, grantee from information_schema.role_table_grants
       where table_schema = 'public'
         and privilege_type = 'DELETE'
         and grantee in ('anon', 'authenticated')`,
    );
    expect(res.rows).toEqual([]);
  });

  it("restricts write policies to the tables that need them", async () => {
    const res = await h.db.query<{ tablename: string }>(
      `select distinct tablename from pg_policies
       where schemaname = 'public' and cmd in ('INSERT', 'UPDATE')
       order by tablename`,
    );
    // Write policies are added per feature, never as a blanket permission — so
    // this list is a deliberate inventory of everything a SESSION may write, and
    // it should be read as such when it changes.
    //
    //   clans, users                 015, leader-managed clans
    //   polls, poll_options          010, leadership opens a poll (T4B.2)
    //   poll_responses               010, a member answers for their own player
    //   cwl_rosters, ..._members     011, leadership builds the CWL plan (T4B.8)
    //   push_subscriptions           023, a member registers their own device (T5.5)
    //   notification_preferences     023, a member sets their own toggles (T5.9)
    //   war_lineups, ..._members     024, leadership plans a war lineup (T6.8)
    //   base_layouts                 028, any member uploads a layout (T8.3)
    //   player_nicknames             033, a member labels their own base (T11.3)
    //
    // The two from 023 and the one from 033 are the only entries here whose
    // subject and actor are the same person, which is why they are plain policies
    // rather than the audited definer functions 021 and 022 argued for: no such
    // row affects anyone else, and none has a clan_id to record an audit entry
    // against. 033's header works through the tempting fix — denormalising a
    // clan_id so the audit row becomes readable — and rejects it, because a
    // base's clan changes and a copy is either stale or maintained by a sync job
    // writing a human-decision table.
    //
    // Notably ABSENT and meant to stay absent: players and every cwl_* and war_*
    // GAME-FACT table (R11 — written only by sync jobs), including war_members,
    // plus announcements, cwl_bonuses and war_targets, whose writes go through
    // audited definer functions in 021/022/024 so that the write and its audit
    // row cannot come apart.
    //
    // clan_roles LEFT this list in 046. 015 gave it direct write policies, 044
    // moved every role change into set_clan_role() so its rules and its audit
    // row hold, and the leftover policies let a leader skip both with a plain
    // INSERT. Roles are now written only by definer functions.
    //
    // war_targets is the one worth pausing on: it is a human decision, so it
    // could have had a policy — but assigning a target must be audited (R4), and
    // 024 makes it a definer function for the reason 021 states.
    //
    // base_layouts is here while base_layout_votes is NOT, and the split is the
    // point: uploading a layout is a member's own row and needs no audit, but a
    // VOTE has to move a counter on another table in the same breath. Two
    // statements from the application can be interrupted between, leaving a
    // score that disagrees with the number of people who voted and nothing to
    // say which is right — so voting is a definer function (028).
    expect(res.rows.map((r) => r.tablename)).toEqual([
      "base_layouts",
      "clans",
      "cwl_roster_members",
      "cwl_rosters",
      "notification_preferences",
      "player_nicknames",
      "poll_options",
      "poll_responses",
      "polls",
      "push_subscriptions",
      "users",
      "war_lineup_members",
      "war_lineups",
    ]);
  });
});

describe("T1.10 — seed.sql", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await h.asSuperuser();
  });
  afterAll(async () => {
    await h?.close();
  });

  // The placeholders are intentionally impossible tags, so an un-edited seed
  // file aborts instead of inserting three fake clans that look real.
  it("refuses to run while the placeholder tags are still in it", async () => {
    await expect(h.db.exec(readSeed())).rejects.toThrow(/clans_tag_format/);
    expect(await count(h, "clans")).toBe(0);
  });

  // replaceAll, not replace: the header comment mentions #REPLACE1 too, and
  // swapping only the first occurrence would leave the real insert untouched.
  const withRealTags = () =>
    readSeed()
      .replaceAll("#REPLACE1", "#2PP0JCCL")
      .replaceAll("#REPLACE2", "#8QUCLJY0")
      .replaceAll("#REPLACE3", "#9V2GRJPY");

  it("inserts exactly three clans once real tags are filled in", async () => {
    await h.db.exec(withRealTags());
    expect(await count(h, "clans")).toBe(3);
  });

  // R5 — running a job five times must change nothing after the first.
  it("is idempotent when run twice", async () => {
    await h.db.exec(withRealTags());
    await h.db.exec(withRealTags());
    expect(await count(h, "clans")).toBe(3);
  });
});

describe("T1.9 done-when — anon with no session sees zero rows", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedFixtures(h);
  });
  afterAll(async () => {
    await h?.close();
  });

  it("has fixture data present when RLS is bypassed", async () => {
    await h.asSuperuser();
    for (const table of PHASE1_TABLES) {
      expect(await count(h, table), `${table} fixture`).toBeGreaterThan(0);
    }
  });

  // The spec's stated acceptance criterion for T1.9, verbatim.
  it.each([...PHASE1_TABLES])("anon reads zero rows from %s", async (table) => {
    await h.asAnon();
    expect(await count(h, table)).toBe(0);
  });
});

describe("T3.7 — a member of clan A cannot read clan B", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedFixtures(h);
  });
  afterAll(async () => {
    await h?.close();
  });

  it("sees only its own clan", async () => {
    await h.asUser(USER_A);
    const res = await h.db.query<{ tag: string }>(`select tag from clans`);
    expect(res.rows.map((r) => r.tag)).toEqual(["#2PP0JCCL"]);
  });

  it("sees only its own clan's players", async () => {
    await h.asUser(USER_A);
    const res = await h.db.query<{ name: string }>(`select name from players`);
    expect(res.rows.map((r) => r.name)).toEqual(["Player A"]);
  });

  // The two-level join (cwl_attacks -> cwl_wars -> cwl_seasons) is the policy
  // most likely to be written wrongly, so it is asserted from both sides.
  it("sees only its own clan's CWL attacks, through the two-level join", async () => {
    await h.asUser(USER_A);
    expect(await count(h, "cwl_attacks")).toBe(1);
    const res = await h.db.query<{ stars: number }>(`select stars from cwl_attacks`);
    expect(res.rows[0]!.stars).toBe(3); // Player A's attack, not Player B's 2

    await h.asUser(USER_B);
    const bRes = await h.db.query<{ stars: number }>(`select stars from cwl_attacks`);
    expect(bRes.rows.map((r) => r.stars)).toEqual([2]);
  });

  it.each([
    "clans",
    "players",
    "clan_roles",
    "cwl_seasons",
    "cwl_wars",
    "cwl_attacks",
    "cwl_bonuses",
    "wars",
    "war_targets",
    "war_attacks",
    // Both reach clan_id through a one-level join to `wars` (024, 026). Absent
    // from this list until now, which is how the coverage rots: a table arrives
    // with a policy nobody ever asserts.
    "war_members",
    "war_opponent_members",
    "raid_seasons",
    "raid_participants",
    "clan_games",
    "clan_games_scores",
    "base_layouts",
    "announcements",
    "sync_log",
    "member_snapshots",
    "player_progress",
    "donation_counters",
  ])("reads exactly one row from %s — its own", async (table) => {
    await h.asUser(USER_A);
    expect(await count(h, table)).toBe(1);
  });

  it("cannot read another member's profile row", async () => {
    await h.asUser(USER_A);
    const res = await h.db.query<{ email: string }>(`select email from users`);
    expect(res.rows.map((r) => r.email)).toEqual(["a@example.com"]);
  });

  it("cannot read another user's push subscriptions", async () => {
    await h.asUser(USER_A);
    expect(await count(h, "push_subscriptions")).toBe(1);
  });

  // T9.6 — audit_log is leader-only. User A is a member, user B is a leader.
  it("hides audit_log from a non-leader and shows it to a leader", async () => {
    await h.asUser(USER_A);
    expect(await count(h, "audit_log")).toBe(0);

    await h.asUser(USER_B);
    expect(await count(h, "audit_log")).toBe(1);
  });

  // T3.8 — a signed-up user with no clan_roles row is the pending state.
  it("shows nothing at all to a user with no clan role", async () => {
    await h.asSuperuser();
    const stranger = "cccccccc-0000-4000-8000-000000000001";
    await h.db.exec(`
      insert into auth.users (id, email) values ('${stranger}', 'c@example.com');
      insert into users (id, email) values ('${stranger}', 'c@example.com');
    `);

    await h.asUser(stranger);
    for (const table of PHASE1_TABLES) {
      if (table === "users") continue; // may read own profile
      expect(await count(h, table), `${table} for a pending user`).toBe(0);
    }
  });
});

describe("R5 — idempotency rests on the unique constraint", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedFixtures(h);
    await h.asSuperuser();
  });
  afterAll(async () => {
    await h?.close();
  });

  const attack = `
    insert into cwl_attacks (war_id, player_id, attack_order, stars, destruction)
    values ('11111111-0000-4000-8000-000000000002', '${PLAYER_A}', 1, 3, 100.00)
    on conflict do nothing
  `;

  it("re-inserting the same attack changes nothing", async () => {
    const before = await count(h, "cwl_attacks");
    await h.db.exec(attack);
    await h.db.exec(attack);
    await h.db.exec(attack);
    expect(await count(h, "cwl_attacks")).toBe(before);
  });

  // Proves the CONSTRAINT is doing the work, not the ON CONFLICT clause. This is
  // the silent failure T1.5 warns about: without the constraint the clause
  // matches nothing and every sync run duplicates every attack, with no error.
  it("duplicates immediately once the constraint is dropped", async () => {
    await h.db.exec(
      `alter table cwl_attacks drop constraint cwl_attacks_war_id_player_id_attack_order_key`,
    );
    const before = await count(h, "cwl_attacks");
    await h.db.exec(attack);
    expect(await count(h, "cwl_attacks")).toBe(before + 1);
  });
});

// T2.9 vs R5. The spec says "one row per player per run"; R5 says a re-run must
// change nothing. The generated captured_hour column is what reconciles them, so
// it is asserted directly rather than assumed.
describe("T2.9 — member_snapshots are idempotent within the hour", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedFixtures(h);
    await h.asSuperuser();
  });
  afterAll(async () => {
    await h?.close();
  });

  const snapshot = `
    insert into member_snapshots (clan_id, player_id, donations, trophies)
    values ('${CLAN_A}', '${PLAYER_A}', 1300, 5300)
    on conflict do nothing
  `;

  it("re-running the hourly sync writes nothing new", async () => {
    const before = await count(h, "member_snapshots");
    await h.db.exec(snapshot);
    await h.db.exec(snapshot);
    await h.db.exec(snapshot);
    expect(await count(h, "member_snapshots")).toBe(before);
  });

  it("derives captured_hour by truncating captured_at in UTC", async () => {
    const res = await h.db.query<{ same: boolean }>(
      `select captured_hour = date_trunc('hour', captured_at at time zone 'UTC') as same
       from member_snapshots limit 1`,
    );
    expect(res.rows[0]!.same).toBe(true);
  });

  // The bucket must not move when the connection's timezone does, or an hourly
  // job would write a second row simply because the runner is in another zone.
  it("is stable across session timezones", async () => {
    const read = async (tz: string) => {
      await h.db.exec(`set time zone '${tz}'`);
      const res = await h.db.query<{ h: string }>(
        `select captured_hour::text as h from member_snapshots order by captured_at limit 1`,
      );
      return res.rows[0]!.h;
    };

    const utc = await read("UTC");
    const colombo = await read("Asia/Colombo");
    await h.db.exec(`set time zone 'UTC'`);
    expect(colombo).toBe(utc);
  });

  // 054 — the key is a 30-minute slot now, for the half-hourly clans sync. If it
  // were still the hour, the second run of every hour would write nothing and
  // report success.
  it("allows a new row in the next half hour (054)", async () => {
    const before = await count(h, "member_snapshots");
    await h.db.exec(`
      insert into member_snapshots (clan_id, player_id, captured_at, donations)
      values ('${CLAN_A}', '${PLAYER_A}', date_bin('30 minutes', now(), timestamptz '2000-01-01') + interval '31 minutes', 1350)
      on conflict do nothing
    `);
    expect(await count(h, "member_snapshots")).toBe(before + 1);
  });

  it("allows a new row in the next hour", async () => {
    const before = await count(h, "member_snapshots");
    await h.db.exec(`
      insert into member_snapshots (clan_id, player_id, captured_at, donations)
      values ('${CLAN_A}', '${PLAYER_A}', now() + interval '1 hour', 1400)
    `);
    expect(await count(h, "member_snapshots")).toBe(before + 1);
  });

  it("keeps snapshots for different players in the same hour", async () => {
    const before = await count(h, "member_snapshots");
    await h.db.exec(`
      insert into member_snapshots (clan_id, player_id, donations)
      values ('${CLAN_B}', '${PLAYER_B}', 500)
      on conflict do nothing
    `);
    // Player B already has a row this hour from the fixtures, so this is a no-op.
    expect(await count(h, "member_snapshots")).toBe(before);
  });
});

describe("R4 — nothing is removed by a cascade", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedFixtures(h);
    await h.asSuperuser();
  });
  afterAll(async () => {
    await h?.close();
  });

  // Note the wording: `on delete restrict` produces "violates RESTRICT setting
  // of foreign key constraint", which is a different message from the default
  // NO ACTION. Matching loosely covers both.
  it("refuses to delete a clan that still has players", async () => {
    await expect(
      h.db.exec(`delete from clans where id = '${CLAN_A}'`),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it("refuses to delete a war that still has attacks", async () => {
    await expect(
      h.db.exec(
        `delete from cwl_wars where id = '11111111-0000-4000-8000-000000000002'`,
      ),
    ).rejects.toThrow(/foreign key constraint/i);
  });

  it("declares no cascading foreign keys anywhere", async () => {
    const res = await h.db.query<{ conname: string }>(
      `select conname from pg_constraint
       where contype = 'f' and confdeltype <> 'r'`,
    );
    expect(res.rows.map((r) => r.conname)).toEqual([]);
  });
});

describe("check constraints reject bad data", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedFixtures(h);
    await h.asSuperuser();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("rejects a lowercase clan tag", async () => {
    await expect(
      h.db.exec(`insert into clans (tag, name) values ('#2pp0jccl', 'x')`),
    ).rejects.toThrow(/clans_tag_format/);
  });

  it("rejects a clan tag with no hash", async () => {
    await expect(
      h.db.exec(`insert into clans (tag, name) values ('2PP0JCCL', 'x')`),
    ).rejects.toThrow(/clans_tag_format/);
  });

  it("rejects more than three stars", async () => {
    await expect(
      h.db.exec(`
        insert into cwl_attacks (war_id, player_id, attack_order, stars, destruction)
        values ('11111111-0000-4000-8000-000000000002', '${PLAYER_A}', 9, 4, 100.00)
      `),
    ).rejects.toThrow(/stars/);
  });

  it("rejects destruction above 100", async () => {
    await expect(
      h.db.exec(`
        insert into cwl_attacks (war_id, player_id, attack_order, stars, destruction)
        values ('11111111-0000-4000-8000-000000000002', '${PLAYER_A}', 8, 3, 101.00)
      `),
    ).rejects.toThrow(/destruction/);
  });

  it("rejects a second role for the same user in the same clan", async () => {
    await expect(
      h.db.exec(
        `insert into clan_roles (user_id, clan_id, role) values ('${USER_A}', '${CLAN_A}', 'leader')`,
      ),
    ).rejects.toThrow(/duplicate key|clan_roles_user_id_clan_id_key/i);
  });

  it("rejects an unknown role", async () => {
    await expect(
      h.db.exec(
        `insert into clan_roles (user_id, clan_id, role) values ('${USER_B}', '${CLAN_A}', 'coLeader')`,
      ),
    ).rejects.toThrow(/clan_roles_role_check/);
  });

  // 036 re-declared the job_type check to admit the players sync. Re-declaring
  // a check is where a value quietly goes missing, so both ends are asserted.
  it("accepts the players job type 036 added, and still rejects an unknown one", async () => {
    await h.db.exec(`insert into sync_log (job_type, status) values ('players', 'success')`);
    await h.db.exec(`insert into sync_log (job_type, status) values ('clan-games', 'success')`);
    await expect(
      h.db.exec(`insert into sync_log (job_type, status) values ('buildings', 'success')`),
    ).rejects.toThrow(/sync_log_job_type_check/);
  });

  it("rejects an unknown sync_log status", async () => {
    await expect(
      h.db.exec(`insert into sync_log (job_type, status) values ('cwl', 'errored')`),
    ).rejects.toThrow(/sync_log_status_check/);
  });

  // R10 — notInWar and a missing CWL group must be recordable as an ordinary
  // outcome, not a failure.
  it("accepts the skipped status that R10 depends on", async () => {
    await h.db.exec(
      `insert into sync_log (job_type, status, skip_reason) values ('cwl', 'skipped', 'noCwlGroup')`,
    );
    expect(await count(h, "sync_log", `status = 'skipped'`)).toBe(1);
  });
});

// A test that cannot fail is not a test, and the clan-isolation block above is
// the one guarding R3 — the rule the spec calls the most common bug here. This
// deliberately breaks auth_clan_ids() and proves the isolation assertions really
// do depend on the policy, rather than passing because the fixture was empty or
// the role never switched.
describe("the isolation tests have teeth", () => {
  let h: Harness;

  beforeAll(async () => {
    const sql = PHASE1_MIGRATIONS.map(readMigration);
    // Same signature, wrong body: every clan, for everyone.
    sql.push(`
      create or replace function auth_clan_ids()
      returns setof uuid language sql stable security definer set search_path = ''
      as $$ select id from public.clans $$;
    `);
    h = await createHarness({ sql });
    await seedFixtures(h);
  });
  afterAll(async () => {
    await h?.close();
  });

  it("leaks clan B to clan A's member once the policy is broken", async () => {
    await h.asUser(USER_A);
    expect(await count(h, "clans")).toBe(2);
    expect(await count(h, "players")).toBe(2);
    expect(await count(h, "cwl_attacks")).toBe(2);
  });

  // Anon must STILL see nothing even with the clan policy broken, because
  // auth.uid() is null and the policies are scoped `to authenticated`. If this
  // ever fails, the anon key alone would expose the database.
  it("still shows anon nothing, because the policies are scoped to authenticated", async () => {
    await h.asAnon();
    expect(await count(h, "clans")).toBe(0);
    expect(await count(h, "cwl_attacks")).toBe(0);
  });
});

// supabase/apply-all.sql is what actually gets pasted into the SQL editor, so it
// is the artefact that must work — not just the individual files. Applying nine
// files by hand invites a wrong order, and 002 references 001 while 006
// references everything, so a half-applied schema is worse than none.
describe("supabase/apply-all.sql — the bundle that gets pasted", () => {
  let h: Harness;

  beforeAll(async () => {
    const bundle = readFileSync(join(process.cwd(), "supabase", "apply-all.sql"), "utf8");
    // One exec, exactly as the SQL editor receives it — begin/commit included.
    h = await createHarness({ sql: [bundle] });
  });
  afterAll(async () => {
    await h?.close();
  });

  it("creates every table in a single transaction", async () => {
    const res = await h.db.query<{ tablename: string }>(
      `select tablename from pg_tables where schemaname = 'public' order by tablename`,
    );
    expect(res.rows.map((r) => r.tablename)).toEqual([...PHASE1_TABLES]);
  });

  it("leaves RLS enabled on every table", async () => {
    const res = await h.db.query<{ tablename: string }>(
      `select tablename from pg_tables
       where schemaname = 'public' and rowsecurity = false`,
    );
    expect(res.rows.map((r) => r.tablename)).toEqual([]);
  });

  it("is regenerated from the same migration list the harness uses", () => {
    const bundle = readFileSync(join(process.cwd(), "supabase", "apply-all.sql"), "utf8");
    // Catches a stale bundle: add a migration, forget `npm run migrations:bundle`,
    // and this fails rather than the schema silently lagging behind.
    for (const file of PHASE1_MIGRATIONS) {
      expect(bundle, `${file} missing from the bundle`).toContain(`-- ${file}`);
    }
  });

  // 010 and 011 were stubs and are now real (T4B.1, T4B.6), so they belong in
  // the bundle and the loop above already requires them. 012 (war lineups,
  // T6.8) is still comment-only: bundling a file that creates nothing would
  // record it as applied and quietly skip the real one when it is written.
  it("excludes the T6.8 stub that is still comment-only", () => {
    const bundle = readFileSync(join(process.cwd(), "supabase", "apply-all.sql"), "utf8");
    expect(bundle).not.toContain(`-- 012_war_lineups.sql\n`);
  });
});

/**
 * Every .sql file is in exactly one list — the check that would have caught 029.
 *
 * PHASE1_MIGRATIONS answered two different questions for twenty-eight files
 * running: what the schema consists of, and what has to be applied. 029 split
 * them. It is deliberately absent from the harness list because PGlite has no
 * storage schema — and being absent from the harness list also made it absent
 * from `migrations:apply`, which then printed "Nothing to do" and meant it.
 *
 * The failure mode is what makes this worth a test rather than a convention. A
 * forgotten migration produces no error when it is forgotten. It produces one
 * later, from Postgres or the storage service, naming a missing table or bucket
 * and never naming a file — for one user, in production, on the one path nobody
 * ran locally because locally the file WAS applied.
 */
describe("the migration lists cover the directory", () => {
  const files = readdirSync(join(process.cwd(), "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  it("accounts for every file in the directory", () => {
    const known = new Set<string>([
      ...PHASE1_MIGRATIONS,
      ...LIVE_ONLY_MIGRATIONS,
      ...RETIRED_MIGRATIONS,
    ]);
    const orphans = files.filter((f) => !known.has(f));

    expect(
      orphans,
      "Add each to PHASE1_MIGRATIONS (both), LIVE_ONLY_MIGRATIONS (Supabase only) " +
        "or RETIRED_MIGRATIONS (nothing applies it) in test/pg-harness.ts",
    ).toEqual([]);
  });

  it("names each file once and only once", () => {
    const all = [...PHASE1_MIGRATIONS, ...LIVE_ONLY_MIGRATIONS, ...RETIRED_MIGRATIONS];
    const seen = new Set<string>();
    const twice = all.filter((f) => (seen.has(f) ? true : (seen.add(f), false)));

    // A file in two lists is a file with two contradictory answers to "does this
    // run on PGlite". Whichever the reader picks, half the tooling disagrees.
    expect(twice).toEqual([]);
  });

  it("lists nothing that does not exist on disk", () => {
    const onDisk = new Set(files);
    const all = [...PHASE1_MIGRATIONS, ...LIVE_ONLY_MIGRATIONS, ...RETIRED_MIGRATIONS];

    // A renamed or deleted file fails the harness with ENOENT at boot, which is
    // loud. RETIRED_MIGRATIONS is the quiet one — nothing reads those, so a
    // stale name there survives indefinitely and misdescribes the tree.
    expect(all.filter((f) => !onDisk.has(f))).toEqual([]);
  });

  // The harness runs PHASE1_MIGRATIONS. Anything in LIVE_ONLY that PGlite could
  // in fact run belongs in PHASE1 instead, where the suite can check it.
  it("keeps live-only migrations to the schemas PGlite does not have", () => {
    for (const file of LIVE_ONLY_MIGRATIONS) {
      const sql = readMigration(file);
      expect(sql, `${file} is live-only but touches no Supabase-owned schema`).toMatch(
        /\b(storage|auth|realtime|vault)\./,
      );
    }
  });
});

// The bug this suite missed the first time round.
//
// 006_rls.sql granted anon and authenticated but not service_role, so every sync
// job failed with "42501 permission denied" on first contact with real Supabase.
// It survived because the harness only ever acted as superuser, anon or
// authenticated — never as the role the sync jobs actually use.
describe("service_role privileges (fixed by 014)", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await createHarness();
    await seedFixtures(h);
  });
  afterAll(async () => {
    await h?.close();
  });

  it("can read every table", async () => {
    await h.asServiceRole();
    for (const table of PHASE1_TABLES) {
      expect(await count(h, table), table).toBeGreaterThan(0);
    }
  });

  it("bypasses RLS, as sync jobs require", async () => {
    await h.asServiceRole();
    // Both clans, not just one — a sync job acts for no user and must see all.
    expect(await count(h, "clans")).toBe(2);
  });

  it("can insert — this is what was broken", async () => {
    await h.asServiceRole();
    await expect(
      h.db.exec(`insert into clans (tag, name) values ('#20000000', 'probe')`),
    ).resolves.toBeDefined();
  });

  it("can update, so soft delete works", async () => {
    await h.asServiceRole();
    await expect(
      h.db.exec(`update clans set deleted_at = now() where tag = '#20000000'`),
    ).resolves.toBeDefined();
  });

  // R4 enforced by privilege rather than by convention. A sync job that tries a
  // hard delete now fails loudly instead of destroying history no one can refetch.
  it("CANNOT delete — R4 enforced by the database, not by discipline", async () => {
    await h.asServiceRole();
    await expect(
      h.db.exec(`delete from cwl_attacks`),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot delete from any table", async () => {
    await h.asServiceRole();
    for (const table of ["clans", "players", "cwl_attacks", "war_attacks", "audit_log"]) {
      await expect(h.db.exec(`delete from ${table}`), table).rejects.toThrow(
        /permission denied/i,
      );
    }
  });
});

/**
 * Migrations allowed to contain a DELETE, each a decision made on purpose.
 *
 * 053 — thin_old_data(): the platform owner chose to thin old readings to stay
 * inside the free tier. It removes redundant readings BETWEEN kept ones, never a
 * fact that exists nowhere else, and only when the platform admin presses the
 * button. test/data-retention.test.ts pins exactly which rows survive.
 */
const DELETE_EXCEPTIONS: readonly string[] = ["053_data_retention.sql"];

describe("the migration files themselves", () => {
  it("contains no DELETE statements (R4)", () => {
    for (const file of PHASE1_MIGRATIONS) {
      if (DELETE_EXCEPTIONS.includes(file)) continue;
      expect(readMigration(file), file).not.toMatch(/^\s*delete\s+from/im);
    }
  });

  it("contains no on delete cascade (R4)", () => {
    for (const file of PHASE1_MIGRATIONS) {
      expect(readMigration(file), file).not.toMatch(/on\s+delete\s+cascade/i);
    }
  });
});
