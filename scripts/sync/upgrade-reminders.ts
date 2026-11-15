// "Your Cannon is done" — the push for an upgrade timer a member started on
// Base details (079).
//
// Run at the end of every clan sync (scripts/sync/clans.ts), which 069's
// heartbeat dispatches every half hour. So a reminder can be up to about thirty
// minutes late, and the page says so. The game's own notification is the exact
// one; this is the reminder for a member who has turned that off or plays on
// another device.
//
// ─────────────────────────────────────────────────────────────────────────────
// OWNER-ONLY, SO NOT push_targets()
//
// push_targets() answers "who in this CLAN wants this kind". A tracked upgrade
// belongs to a base's owner and has nothing to do with a clan — an alt outside
// every clan family is tracked the same way. So, as alerts.ts does, the
// recipients are read here with the service key (R6), straight from the base's
// owner, and filtered by their upgrade_reminders preference.
//
// R11 — THE ONE WRITE IS notified_at. 079 grants the sync nothing else on this
// table: it records that the reminder went, never anything about the village.
//
// NO FEED ROW. Every other kind also writes to the notifications feed (T12.3).
// Upgrade timers would add a row per upgrade for every member, for ever, on a
// 500 MB database — and Base details already shows every finished upgrade.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { retireExpired, sendPush, type PushTarget } from "@/lib/push";
import { encodeTag } from "@/lib/tags";

/** A reminder older than this is stamped and dropped: it would only be noise. */
const TOO_LATE_MS = 6 * 3_600_000;
/** One run's ceiling. The rest wait half an hour; nothing is lost. */
const BATCH = 500;

interface DueRow {
  id: string;
  player_id: string;
  subject: string;
  from_level: number;
  ends_at: string;
}

export interface ReminderResult {
  due: number;
  sent: number;
  skipped: number;
  pruned: number;
}

/** Group a base's finished upgrades into one line for the lock screen. */
export function reminderText(baseName: string, rows: ReadonlyArray<Pick<DueRow, "subject" | "from_level">>): {
  title: string;
  body: string;
} {
  if (rows.length === 1) {
    const r = rows[0]!;
    return {
      title: "Upgrade finished",
      body: `${r.subject} reached level ${r.from_level + 1} on ${baseName}.`,
    };
  }
  return {
    title: `${rows.length} upgrades finished`,
    body: `${rows.map((r) => r.subject).slice(0, 3).join(", ")}${rows.length > 3 ? " and more" : ""} on ${baseName}.`,
  };
}

/** Never throws: a reminder problem must not fail the clan sync that called it. */
export async function remindFinishedUpgrades(supabase: SupabaseClient, now: Date = new Date()): Promise<ReminderResult> {
  const result: ReminderResult = { due: 0, sent: 0, skipped: 0, pruned: 0 };
  try {
    const { data, error } = await supabase
      .from("tracked_upgrades")
      .select("id, player_id, subject, from_level, ends_at")
      .is("notified_at", null)
      .is("deleted_at", null)
      // Folded means the member (or the API) already saw it finish: no reminder.
      .is("folded_at", null)
      .lte("ends_at", now.toISOString())
      .order("ends_at")
      .limit(BATCH);
    if (error) throw new Error(error.message);

    const due = (data ?? []) as DueRow[];
    result.due = due.length;

    if (due.length) {
      const players = await ownersOf(supabase, [...new Set(due.map((r) => r.player_id))]);
      const muted = await mutedUsers(supabase, [...new Set([...players.values()].map((p) => p.user_id))]);
      const targets = await subscriptionsFor(supabase, [...new Set([...players.values()].map((p) => p.user_id))]);

      const byBase = new Map<string, DueRow[]>();
      for (const r of due) {
        const list = byBase.get(r.player_id) ?? [];
        list.push(r);
        byBase.set(r.player_id, list);
      }

      const expired: string[] = [];
      for (const [playerId, rows] of byBase) {
        const player = players.get(playerId);
        const fresh = rows.filter((r) => now.getTime() - Date.parse(r.ends_at) <= TOO_LATE_MS);
        const mine = player ? targets.filter((t) => t.user_id === player.user_id) : [];

        if (player && fresh.length && !muted.has(player.user_id) && mine.length) {
          const sent = await sendPush(mine, {
            ...reminderText(player.name, fresh),
            url: `/account/bases/${encodeTag(player.tag)}/details`,
            tag: `upgrades:${player.tag}`,
          });
          result.sent += sent.sent;
          expired.push(...sent.expired);
        } else {
          result.skipped += rows.length;
        }
      }
      await retireExpired(supabase, expired);

      const { error: stampError } = await supabase
        .from("tracked_upgrades")
        .update({ notified_at: now.toISOString() })
        .in(
          "id",
          due.map((r) => r.id),
        );
      if (stampError) throw new Error(`could not stamp reminders: ${stampError.message}`);
    }

    const { data: pruned } = await supabase.rpc("prune_tracked_upgrades");
    result.pruned = typeof pruned === "number" ? pruned : 0;

    if (result.due || result.pruned) {
      console.log(
        `  upgrade reminders: ${result.due} due, ${result.sent} sent, ${result.skipped} skipped, ${result.pruned} pruned`,
      );
    }
  } catch (error) {
    console.error(`  upgrade reminders failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return result;
}

async function ownersOf(
  supabase: SupabaseClient,
  playerIds: string[],
): Promise<Map<string, { user_id: string; tag: string; name: string }>> {
  const out = new Map<string, { user_id: string; tag: string; name: string }>();
  if (!playerIds.length) return out;
  const { data } = await supabase.from("players").select("id, user_id, tag, name").in("id", playerIds);
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    if (typeof r.user_id !== "string") continue; // an unclaimed base has nobody to tell
    out.set(r.id as string, { user_id: r.user_id, tag: String(r.tag), name: String(r.name ?? r.tag) });
  }
  return out;
}

/** Accounts that switched "Upgrade finished" off. No row means on (023's rule). */
async function mutedUsers(supabase: SupabaseClient, userIds: string[]): Promise<Set<string>> {
  if (!userIds.length) return new Set();
  const { data } = await supabase
    .from("notification_preferences")
    .select("user_id, upgrade_reminders")
    .in("user_id", userIds)
    .is("deleted_at", null);
  return new Set(
    ((data ?? []) as Array<{ user_id: string; upgrade_reminders: boolean | null }>)
      .filter((r) => r.upgrade_reminders === false)
      .map((r) => r.user_id),
  );
}

async function subscriptionsFor(supabase: SupabaseClient, userIds: string[]): Promise<PushTarget[]> {
  if (!userIds.length) return [];
  const { data } = await supabase
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", userIds)
    .is("deleted_at", null);
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    user_id: r.user_id as string,
    endpoint: r.endpoint as string,
    p256dh: r.p256dh as string,
    auth_key: r.auth as string,
  }));
}
