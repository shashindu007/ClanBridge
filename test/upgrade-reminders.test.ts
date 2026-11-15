// 079 — the "upgrade finished" push, against the real schema on PGlite.
//
// What is pinned: an ended timer is stamped once and only once, an owner who
// switched the kind off is stamped without a push, a reminder hours late is
// dropped rather than sent, and nothing here ever throws into the clan sync.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";

const sendPush = vi.fn(async (targets: unknown[], _payload: unknown) => ({
  sent: targets.length,
  expired: [] as string[],
  failed: 0,
}));
vi.mock("@/lib/push", () => ({
  sendPush: (targets: unknown[], payload: unknown) => sendPush(targets, payload),
  retireExpired: vi.fn(async () => {}),
}));

const { remindFinishedUpgrades, reminderText } = await import("../scripts/sync/upgrade-reminders");

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
const OWNER = "11111111-0000-4000-8000-0000000000a2";
const MUTED = "33333333-0000-4000-8000-0000000000a4";
const MAIN = "44444444-0000-4000-8000-00000000001a";
const QUIET = "55555555-0000-4000-8000-00000000001b";

describe("reminderText", () => {
  it("names one upgrade and the level it reached", () => {
    expect(reminderText("Main", [{ subject: "Cannon", from_level: 19 }])).toEqual({
      title: "Upgrade finished",
      body: "Cannon reached level 20 on Main.",
    });
  });

  it("groups several into one notification", () => {
    const text = reminderText("Main", [
      { subject: "Cannon", from_level: 19 },
      { subject: "Archer Queen", from_level: 90 },
      { subject: "Wall", from_level: 16 },
      { subject: "Mortar", from_level: 15 },
    ]);
    expect(text.title).toBe("4 upgrades finished");
    expect(text.body).toBe("Cannon, Archer Queen, Wall and more on Main.");
  });
});

describe("remindFinishedUpgrades", () => {
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
    sendPush.mockClear();
    await h.asSuperuser();
    await h.db.exec(`
      truncate tracked_upgrades, push_subscriptions, notification_preferences, clan_roles, players, users, clans cascade;
      delete from auth.users;

      insert into clans (id, tag, name) values ('${CLAN_A}', '#2PP0JCCL', 'Clan A');
      insert into auth.users (id, email) values ('${OWNER}', 'o@example.com'), ('${MUTED}', 'm@example.com');
      insert into users (id, email, status) values
        ('${OWNER}', 'o@example.com', 'approved'),
        ('${MUTED}', 'm@example.com', 'approved');
      insert into players (id, clan_id, user_id, tag, name, th_level, verified) values
        ('${MAIN}',  '${CLAN_A}', '${OWNER}', '#PY0LQGRJ', 'Main',  17, true),
        ('${QUIET}', '${CLAN_A}', '${MUTED}', '#L2QYGJ9P', 'Quiet', 17, true);
      insert into push_subscriptions (user_id, endpoint, p256dh, auth) values
        ('${OWNER}', 'https://push.example/owner', 'p', 'a'),
        ('${MUTED}', 'https://push.example/muted', 'p', 'a');
      insert into notification_preferences (user_id, upgrade_reminders) values ('${MUTED}', false);

      insert into tracked_upgrades (player_id, created_by, village, subject_type, subject, from_level, workshop, started_at, ends_at) values
        ('${MAIN}',  '${OWNER}', 'home', 'building', 'Cannon', 19, 'builders', now() - interval '2 hours', now() - interval '5 minutes'),
        ('${MAIN}',  '${OWNER}', 'home', 'building', 'Mortar', 15, 'builders', now() - interval '2 days',  now() - interval '1 day'),
        ('${MAIN}',  '${OWNER}', 'home', 'building', 'Wall',   16, 'builders', now(),                      now() + interval '1 hour'),
        ('${QUIET}', '${MUTED}', 'home', 'building', 'Cannon', 19, 'builders', now() - interval '2 hours', now() - interval '5 minutes');
    `);
    await h.asServiceRole();
  });

  it("sends one push per base for what just ended, and stamps every ended row", async () => {
    const result = await remindFinishedUpgrades(client);
    expect(result).toMatchObject({ due: 3, sent: 1 });

    expect(sendPush).toHaveBeenCalledTimes(1);
    const [targets, payload] = sendPush.mock.calls[0]!;
    expect(targets).toHaveLength(1);
    // The day-old Mortar is stamped, not announced.
    expect(payload).toMatchObject({
      body: "Cannon reached level 20 on Main.",
      url: "/account/bases/%23PY0LQGRJ/details",
      tag: "upgrades:#PY0LQGRJ",
    });

    await h.asSuperuser();
    const stamped = await h.db.query<{ subject: string; notified: boolean }>(
      `select subject, notified_at is not null as notified from tracked_upgrades order by subject, player_id`,
    );
    expect(stamped.rows.filter((r) => r.notified)).toHaveLength(3);
    expect(stamped.rows.find((r) => r.subject === "Wall")?.notified).toBe(false);
  });

  it("does not announce the same row twice", async () => {
    await remindFinishedUpgrades(client);
    sendPush.mockClear();
    await h.asServiceRole();
    expect(await remindFinishedUpgrades(client)).toMatchObject({ due: 0, sent: 0 });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("does not remind about an upgrade the member or the API has already folded", async () => {
    await h.asSuperuser();
    await h.db.exec(`
      update tracked_upgrades set folded_at = now() where subject = 'Cannon' and player_id = '${MAIN}';
    `);
    await h.asServiceRole();

    // MAIN's Cannon is folded; the day-old Mortar is still stamped and dropped.
    expect(await remindFinishedUpgrades(client)).toMatchObject({ due: 2, sent: 0 });
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("never throws, even when the database refuses", async () => {
    const broken = {
      from: () => {
        throw new Error("boom");
      },
    } as unknown as SupabaseClient;
    await expect(remindFinishedUpgrades(broken)).resolves.toMatchObject({ due: 0, sent: 0 });
  });
});
