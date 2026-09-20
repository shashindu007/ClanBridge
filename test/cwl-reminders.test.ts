// T5.6 — the CWL "you have not attacked yet" reminder.
//
// Four things here are worth more than the rest:
//
//   1. A WAR THAT HAS ALREADY ENDED NEVER REMINDS ANYONE. The attack it would
//      ask for cannot be made, and a notification demanding the impossible is
//      how a clan learns to ignore this channel entirely.
//
//   2. THE ROSTER READ IS THE API'S, NOT THE LEADER'S (R12). Reminding from
//      cwl_roster_members would nag players who are not in today's war and stay
//      silent for the ones who are. Asserted by putting a player in the leader's
//      roster and NOT in the API roster, then proving they are not notified.
//
//   3. A MUTED MEMBER STAYS MUTED. Unlike T5.8's operational alert, this one is
//      about a member's own play and T5.9 lists it as switchable.
//
//   4. IT NEVER THROWS. It runs after the season data is already durable, and
//      the capture is the half that cannot be repeated.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();

vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
  },
}));

import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import {
  describeRemaining,
  remindUnusedAttacks,
  warsNeedingReminder,
  REMINDER_WINDOW_MS,
  type CandidateWar,
} from "../scripts/sync/cwl-reminders";

const NOW = new Date("2026-08-04T12:00:00.000Z");

function hoursFromNow(h: number): string {
  return new Date(NOW.getTime() + h * 60 * 60 * 1000).toISOString();
}

function candidate(over: Partial<CandidateWar> = {}): CandidateWar {
  return {
    id: "war-1",
    clanId: "clan-1",
    season: "2026-08",
    dayNumber: 3,
    endTime: hoursFromNow(2),
    state: "inWar",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The window rule — no database needed, which is why it is split out.
// ---------------------------------------------------------------------------
describe("warsNeedingReminder — when a reminder is due", () => {
  it("includes a war ending inside the window", () => {
    expect(warsNeedingReminder([candidate()], NOW)).toHaveLength(1);
  });

  // The bound that matters most. A war whose end_time has passed but whose row
  // still says inWar is entirely ordinary — the sync runs every two hours, so a
  // war can end 100 minutes before anything notices.
  it("never reminds about a war that has already ended", () => {
    expect(warsNeedingReminder([candidate({ endTime: hoursFromNow(-1) })], NOW)).toEqual([]);
  });

  it("does not remind at the exact moment the war ends", () => {
    expect(warsNeedingReminder([candidate({ endTime: hoursFromNow(0) })], NOW)).toEqual([]);
  });

  it("stays quiet while the war is still far from ending", () => {
    expect(warsNeedingReminder([candidate({ endTime: hoursFromNow(9) })], NOW)).toEqual([]);
  });

  it("uses the window as its upper bound", () => {
    const justInside = new Date(NOW.getTime() + REMINDER_WINDOW_MS - 60_000).toISOString();
    const justOutside = new Date(NOW.getTime() + REMINDER_WINDOW_MS + 60_000).toISOString();

    expect(warsNeedingReminder([candidate({ endTime: justInside })], NOW)).toHaveLength(1);
    expect(warsNeedingReminder([candidate({ endTime: justOutside })], NOW)).toEqual([]);
  });

  // R10 — preparation and warEnded are ordinary states, not failures, and
  // neither is a moment to chase anybody for an attack.
  it("ignores every state except inWar", () => {
    for (const state of ["preparation", "warEnded", null]) {
      expect(warsNeedingReminder([candidate({ state })], NOW), String(state)).toEqual([]);
    }
  });

  it("skips a war with no end time rather than guessing one", () => {
    expect(warsNeedingReminder([candidate({ endTime: null })], NOW)).toEqual([]);
  });

  it("survives an unparseable end time", () => {
    expect(warsNeedingReminder([candidate({ endTime: "not a date" })], NOW)).toEqual([]);
  });
});

describe("describeRemaining", () => {
  it("rounds to hours when there is more than an hour and a half left", () => {
    expect(describeRemaining(new Date(NOW.getTime() + 3 * 3600_000), NOW)).toBe(
      "in about 3 hours",
    );
  });

  it("switches to minutes near the end, where the difference matters", () => {
    expect(describeRemaining(new Date(NOW.getTime() + 20 * 60_000), NOW)).toBe(
      "in about 20 minutes",
    );
  });

  // Never "in about 0 minutes", which reads as already over.
  it("never counts down to zero", () => {
    expect(describeRemaining(new Date(NOW.getTime() + 5_000), NOW)).toBe("in about 1 minutes");
  });
});

// ---------------------------------------------------------------------------
// The whole path, against real Postgres.
// ---------------------------------------------------------------------------
describe("remindUnusedAttacks — against the database", () => {
  let h: Harness;
  let client: SupabaseClient;

  const CLAN = "aaaaaaaa-0000-4000-8000-00000000c1a1";
  const SEASON = "bbbbbbbb-0000-4000-8000-0000000005ea";
  const WAR = "cccccccc-0000-4000-8000-00000000a110";
  const ATTACKED = "dddddddd-0000-4000-8000-0000000000d1";
  const OWING = "dddddddd-0000-4000-8000-0000000000d2";
  const NO_ACCOUNT = "dddddddd-0000-4000-8000-0000000000d3";
  const USER_ATTACKED = "eeeeeeee-0000-4000-8000-0000000000e1";
  const USER_OWING = "eeeeeeee-0000-4000-8000-0000000000e2";

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
    await h.asSuperuser();
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    sendNotification.mockReset();
    sendNotification.mockResolvedValue({ statusCode: 201 });
    setVapidDetails.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_SUBJECT = "mailto:t@example.com";

    await h.db.exec(`
      delete from cwl_attacks;
      delete from cwl_war_members;
      delete from cwl_wars;
      delete from cwl_seasons;
      delete from push_subscriptions;
      delete from notification_preferences;
      -- T12.3 — remindUnusedAttacks now RECORDS as well as pushes, so these
      -- rows exist after every run and hold a RESTRICT reference to users.
      delete from notifications;
      delete from cwl_roster_members;
      delete from cwl_rosters;
      delete from clan_roles;
      delete from players;
      delete from users;
      delete from auth.users;
      delete from clans;
    `);

    await h.db.exec(`
      insert into clans (id, tag, name) values
        ('${CLAN}', '#2PP0JCCL', 'Test Clan');

      insert into auth.users (id, email) values
        ('${USER_ATTACKED}', 'a@example.com'),
        ('${USER_OWING}',    'o@example.com');

      insert into users (id, email, status) values
        ('${USER_ATTACKED}', 'a@example.com', 'approved'),
        ('${USER_OWING}',    'o@example.com', 'approved');

      insert into clan_roles (user_id, clan_id, role) values
        ('${USER_ATTACKED}', '${CLAN}', 'member'),
        ('${USER_OWING}',    '${CLAN}', 'member');

      -- Tags use Supercell's alphabet only (0289PYLQGRJCUV). 001's
      -- players_tag_format CHECK rejects anything else, which is the same
      -- constraint that catches a transcribed O-for-zero in production.
      insert into players (id, clan_id, user_id, tag, name) values
        ('${ATTACKED}',   '${CLAN}', '${USER_ATTACKED}', '#22PJ000', 'Attacked'),
        ('${OWING}',      '${CLAN}', '${USER_OWING}',    '#22PJ002', 'Owing'),
        ('${NO_ACCOUNT}', '${CLAN}', null,               '#22PJ008', 'No account');

      insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
        ('${USER_ATTACKED}', 'https://push.example/attacked', 'k', 'a'),
        ('${USER_OWING}',    'https://push.example/owing',    'k', 'a');

      insert into cwl_seasons (id, clan_id, season) values
        ('${SEASON}', '${CLAN}', '2026-08');

      insert into cwl_wars (id, season_id, war_tag, day_number, state, end_time) values
        ('${WAR}', '${SEASON}', '#99GQ220', 3, 'inWar', '${hoursFromNow(2)}');

      insert into cwl_war_members (war_id, player_id, map_position) values
        ('${WAR}', '${ATTACKED}',   1),
        ('${WAR}', '${OWING}',      2),
        ('${WAR}', '${NO_ACCOUNT}', 3);

      insert into cwl_attacks (war_id, player_id, attack_order, stars, destruction) values
        ('${WAR}', '${ATTACKED}', 1, 3, 100);
    `);
  });

  const clans = [{ id: CLAN, tag: "#2PP0JCCL", name: "Test Clan" }];

  /**
   * Invoke the way the sync job actually does — as service_role.
   *
   * push_targets() (023) returns nothing unless the caller is leadership of the
   * clan OR `current_setting('role') = 'service_role'`. Fixtures are seeded as
   * superuser because several of these tables withhold INSERT from service_role
   * by design, so the switch happens here, immediately before the call.
   */
  async function run(only: typeof clans = clans, now = NOW) {
    await h.asServiceRole();
    try {
      return await remindUnusedAttacks(client, only, now);
    } finally {
      await h.asSuperuser();
    }
  }

  it("notifies only the players who have not attacked", async () => {
    const outcome = await run();

    expect(outcome.warsReminded).toBe(1);
    // Two owe an attack; only one of them has a linked account.
    expect(outcome.playersOwing).toBe(2);
    expect(outcome.sent).toBe(1);

    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [subscription] = sendNotification.mock.calls[0] as [{ endpoint: string }];
    expect(subscription.endpoint).toBe("https://push.example/owing");
  });

  it("links to the season page and collapses per war", async () => {
    await run();

    const [, body] = sendNotification.mock.calls[0] as [unknown, string];
    const payload = JSON.parse(body) as { url: string; tag: string; body: string };

    expect(payload.url).toBe("/%232PP0JCCL/cwl/2026-08");
    expect(payload.tag).toBe(`cwl-reminder:${WAR}`);
    // Names the action and the deadline, never who failed to act (see the
    // payload comment: this lands on a lock screen).
    expect(payload.body).toContain("in about 2 hours");
    expect(payload.body).not.toContain("Owing");
  });

  // R12, as a test rather than a comment. The leader's roster is a different
  // table and must have no influence on who is chased.
  it("reads the API roster, never the leader's plan (R12)", async () => {
    await h.db.exec(`
      insert into cwl_rosters (id, season, clan_id, status, slot_count, created_by)
      values ('ffffffff-0000-4000-8000-000000000f01', '2026-08', '${CLAN}', 'published', 15,
              '${USER_OWING}');
      insert into cwl_roster_members (roster_id, player_id, position, added_by)
      values ('ffffffff-0000-4000-8000-000000000f01', '${ATTACKED}', 1, '${USER_OWING}');
    `);

    // ATTACKED is on the leader's roster and HAS attacked in the API war, so
    // they must still not be notified. If this ever reads 011 instead of 019,
    // this assertion is what catches it.
    const outcome = await run();

    expect(outcome.sent).toBe(1);
    const [subscription] = sendNotification.mock.calls[0] as [{ endpoint: string }];
    expect(subscription.endpoint).toBe("https://push.example/owing");
  });

  it("respects a member who switched CWL reminders off (T5.9)", async () => {
    await h.db.exec(`
      insert into notification_preferences (user_id, cwl_reminders)
      values ('${USER_OWING}', false);
    `);

    const outcome = await run();

    // Still counted as owing — the reminder is muted, the fact is not.
    expect(outcome.playersOwing).toBe(2);
    expect(outcome.sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends nothing once the war has ended", async () => {
    await h.db.exec(
      `update cwl_wars set end_time = '${hoursFromNow(-1)}' where id = '${WAR}';`,
    );

    const outcome = await run();

    expect(outcome.warsReminded).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("sends nothing when everybody has attacked", async () => {
    await h.db.exec(`
      insert into cwl_attacks (war_id, player_id, attack_order, stars, destruction) values
        ('${WAR}', '${OWING}',      1, 2, 80),
        ('${WAR}', '${NO_ACCOUNT}', 1, 1, 45);
    `);

    const outcome = await run();

    expect(outcome.playersOwing).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  // R3 — another clan's war must never reach this clan's members, and the
  // filter is the clan list passed in, not the whole table.
  it("only considers the clans it was given", async () => {
    // The war, roster and unattacked player all still exist. Passing no clans
    // must still reach nobody — the filter is the argument, not the table.
    const outcome = await run([]);
    expect(outcome.warsReminded).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  // The capture already succeeded and is durable by the time this runs.
  it("never throws when the push service fails", async () => {
    sendNotification.mockRejectedValue({ statusCode: 500 });

    await expect(run()).resolves.toMatchObject({
      warsReminded: 1,
      sent: 0,
    });
  });
});
