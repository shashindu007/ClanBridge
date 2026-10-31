// The war and raid reminders that Settings offered and nothing sent.
//
// Against real Postgres, as the sync runs them. The cases that matter are the
// ones that would teach a clan to mute these: asking twice, asking someone who
// has nothing left to do, and asking about something already over.

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

const { endsWithin, RAID_REMINDER_WINDOW_MS, remindRaidAttacks, remindWarAttacks } = await import(
  "../scripts/sync/attack-reminders"
);
const { createHarness } = await import("./pg-harness");
const { createPgliteSupabase } = await import("./pglite-supabase");
type Harness = Awaited<ReturnType<typeof createHarness>>;

const NOW = new Date("2030-06-01T12:00:00Z");
const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

const CLAN = "aaaaaaaa-0000-4000-8000-00000000c1a1";
const OTHER_CLAN = "aaaaaaaa-0000-4000-8000-00000000c1a2";
const WAR = "cccccccc-0000-4000-8000-00000000a110";
const SEASON = "cccccccc-0000-4000-8000-00000000a111";

const DONE = "dddddddd-0000-4000-8000-0000000000d1";
const OWING = "dddddddd-0000-4000-8000-0000000000d2";
const NO_ACCOUNT = "dddddddd-0000-4000-8000-0000000000d3";
const USER_DONE = "eeeeeeee-0000-4000-8000-0000000000e1";
const USER_OWING = "eeeeeeee-0000-4000-8000-0000000000e2";

const clans = [{ id: CLAN, tag: "#2PP0JCCL", name: "Test Clan" }];

describe("endsWithin", () => {
  const FOUR_HOURS = 4 * 3_600_000;

  it("takes what ends inside the window", () => {
    expect(endsWithin(hoursFromNow(3), FOUR_HOURS, NOW)).not.toBeNull();
  });

  it("refuses what has already ended: that attack cannot be made", () => {
    expect(endsWithin(hoursFromNow(-1), FOUR_HOURS, NOW)).toBeNull();
    expect(endsWithin(NOW, FOUR_HOURS, NOW)).toBeNull();
  });

  it("refuses what is further off, and nonsense", () => {
    expect(endsWithin(hoursFromNow(5), FOUR_HOURS, NOW)).toBeNull();
    expect(endsWithin(null, FOUR_HOURS, NOW)).toBeNull();
    expect(endsWithin("not a date", FOUR_HOURS, NOW)).toBeNull();
  });
});

describe("attack reminders — against the database", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
  });
  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    sendNotification.mockReset();
    sendNotification.mockResolvedValue({ statusCode: 201 });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    process.env.VAPID_PRIVATE_KEY = "priv";
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "pub";
    process.env.VAPID_SUBJECT = "mailto:t@example.com";

    await h.asSuperuser();
    await h.db.exec(`
      truncate feedback, notifications, notification_preferences, push_subscriptions,
               war_attacks, war_members, wars, raid_participants, raid_seasons,
               clan_roles, players, users, clans cascade;
      delete from auth.users;

      insert into clans (id, tag, name) values
        ('${CLAN}', '#2PP0JCCL', 'Test Clan'),
        ('${OTHER_CLAN}', '#8QUCLJY0', 'Other Clan');

      insert into auth.users (id, email) values
        ('${USER_DONE}',  'd@example.com'),
        ('${USER_OWING}', 'o@example.com');

      insert into users (id, email, status) values
        ('${USER_DONE}',  'd@example.com', 'approved'),
        ('${USER_OWING}', 'o@example.com', 'approved');

      insert into clan_roles (user_id, clan_id, role) values
        ('${USER_DONE}',  '${CLAN}', 'member'),
        ('${USER_OWING}', '${CLAN}', 'member');

      insert into players (id, clan_id, user_id, tag, name) values
        ('${DONE}',       '${CLAN}', '${USER_DONE}',  '#22PJ000', 'Done'),
        ('${OWING}',      '${CLAN}', '${USER_OWING}', '#22PJ002', 'Owing'),
        ('${NO_ACCOUNT}', '${CLAN}', null,            '#22PJ008', 'No account');

      insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
        ('${USER_DONE}',  'https://push.example/done',  'k', 'a'),
        ('${USER_OWING}', 'https://push.example/owing', 'k', 'a');
    `);
  });

  async function asSync(fn: () => Promise<void>): Promise<void> {
    await h.asServiceRole();
    try {
      await fn();
    } finally {
      await h.asSuperuser();
    }
  }

  const endpoints = () =>
    sendNotification.mock.calls.map((call) => (call[0] as { endpoint: string }).endpoint);
  const payload = () => JSON.parse(sendNotification.mock.calls[0]![1] as string) as Record<string, string>;

  describe("war", () => {
    async function seedWar(endHours = 2, state = "inWar"): Promise<void> {
      await h.db.exec(`
        insert into wars (id, clan_id, state, opponent_tag, team_size, start_time, end_time)
        values ('${WAR}', '${CLAN}', '${state}', '#99GQ220', 3,
                '${hoursFromNow(endHours - 24)}', '${hoursFromNow(endHours)}');

        insert into war_members (war_id, player_id, map_position, attacks_allowed) values
          ('${WAR}', '${DONE}',       1, 2),
          ('${WAR}', '${OWING}',      2, 2),
          ('${WAR}', '${NO_ACCOUNT}', 3, 2);

        insert into war_attacks (war_id, player_id, attack_order, stars, destruction) values
          ('${WAR}', '${DONE}',  1, 3, 100),
          ('${WAR}', '${DONE}',  2, 3, 100),
          ('${WAR}', '${OWING}', 1, 2, 80);
      `);
    }

    it("asks only those who still have an attack, however many they used", async () => {
      await seedWar();
      await asSync(() => remindWarAttacks(client, clans, NOW));
      expect(endpoints()).toEqual(["https://push.example/owing"]);
    });

    it("says what to do and where, without naming anybody", async () => {
      await seedWar();
      await asSync(() => remindWarAttacks(client, clans, NOW));

      const sent = payload();
      expect(sent.body).toContain("in about 2 hours");
      expect(sent.url).toBe(`/${encodeURIComponent("#2PP0JCCL")}/war`);
      expect(JSON.stringify(sent)).not.toContain("Owing");
    });

    // A war sync runs every half hour. Eight of these per war is how a clan
    // learns to mute the channel.
    it("sends once per war, however many runs land in the window", async () => {
      await seedWar();
      await asSync(() => remindWarAttacks(client, clans, NOW));
      await asSync(() => remindWarAttacks(client, clans, new Date(NOW.getTime() + 30 * 60_000)));

      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it("waits until the war is close to ending", async () => {
      await seedWar(6);
      await asSync(() => remindWarAttacks(client, clans, NOW));
      expect(sendNotification).not.toHaveBeenCalled();

      const row = await h.db.query<{ reminded_at: Date | null }>(`select reminded_at from wars`);
      expect(row.rows[0]!.reminded_at).toBeNull(); // so the later run still sends
    });

    it("says nothing about a war that has ended", async () => {
      await seedWar(-1);
      await asSync(() => remindWarAttacks(client, clans, NOW));
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it("leaves a muted member muted", async () => {
      await seedWar();
      await h.db.exec(`
        insert into notification_preferences (user_id, war_reminders) values ('${USER_OWING}', false);
      `);
      await asSync(() => remindWarAttacks(client, clans, NOW));
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it("never fails the sync when the push service does", async () => {
      await seedWar();
      sendNotification.mockRejectedValue(new Error("push service down"));
      await expect(asSync(() => remindWarAttacks(client, clans, NOW))).resolves.toBeUndefined();
    });

    it("only reads the clans it was given (R3)", async () => {
      await seedWar();
      await asSync(() => remindWarAttacks(client, [{ id: OTHER_CLAN, tag: "#8QUCLJY0", name: "Other" }], NOW));
      expect(sendNotification).not.toHaveBeenCalled();
    });
  });

  describe("raids", () => {
    async function seedWeekend(endHours = 20, state = "ongoing"): Promise<void> {
      await h.db.exec(`
        insert into raid_seasons (id, clan_id, state, start_time, end_time)
        values ('${SEASON}', '${CLAN}', '${state}', '${hoursFromNow(endHours - 72)}', '${hoursFromNow(endHours)}');

        insert into raid_participants (raid_season_id, player_id, attacks_used, attack_limit, bonus_attack_limit)
        values ('${SEASON}', '${DONE}', 6, 5, 1);
      `);
    }

    it("asks the member who has not started, whom the API does not list", async () => {
      await seedWeekend();
      await asSync(() => remindRaidAttacks(client, clans, NOW));
      expect(endpoints()).toEqual(["https://push.example/owing"]);
    });

    it("asks a raider with attacks left", async () => {
      await seedWeekend();
      await h.db.exec(`
        insert into raid_participants (raid_season_id, player_id, attacks_used, attack_limit, bonus_attack_limit)
        values ('${SEASON}', '${OWING}', 3, 5, 1);
      `);
      await asSync(() => remindRaidAttacks(client, clans, NOW));
      expect(endpoints()).toEqual(["https://push.example/owing"]);
    });

    // attacksOwed() will not invent a limit, so a raider with none is left alone.
    it("leaves a raider alone when what they were offered is unknown", async () => {
      await seedWeekend();
      await h.db.exec(`
        insert into raid_participants (raid_season_id, player_id, attacks_used)
        values ('${SEASON}', '${OWING}', 3);
      `);
      await asSync(() => remindRaidAttacks(client, clans, NOW));
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it("sends once per weekend", async () => {
      await seedWeekend();
      await asSync(() => remindRaidAttacks(client, clans, NOW));
      await asSync(() => remindRaidAttacks(client, clans, new Date(NOW.getTime() + 60 * 60_000)));
      expect(sendNotification).toHaveBeenCalledTimes(1);
    });

    it("waits for the last day", async () => {
      await seedWeekend(RAID_REMINDER_WINDOW_MS / 3_600_000 + 1);
      await asSync(() => remindRaidAttacks(client, clans, NOW));
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it("says nothing about a weekend that has closed", async () => {
      await seedWeekend(20, "ended");
      await asSync(() => remindRaidAttacks(client, clans, NOW));
      expect(sendNotification).not.toHaveBeenCalled();
    });

    it("leaves a muted member muted", async () => {
      await seedWeekend();
      await h.db.exec(`
        insert into notification_preferences (user_id, raid_reminders) values ('${USER_OWING}', false);
      `);
      await asSync(() => remindRaidAttacks(client, clans, NOW));
      expect(sendNotification).not.toHaveBeenCalled();
    });
  });
});
