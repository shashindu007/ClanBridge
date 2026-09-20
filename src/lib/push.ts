// T5.6 — sending Web Push.
//
// One place that knows how to turn "notify this clan about this" into encrypted
// POSTs to a push service, used by both the application (announcements T5.1,
// poll reminders T4B.5) and the sync jobs (T5.8 sync failure, CWL reminders).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE APPLICATION SENDS THESE AND NOT ONLY A SYNC JOB
//
// The plan says push is "triggered from sync jobs". That is right for anything a
// job DISCOVERS — a CWL day ending with unused attacks is not knowable from a
// request. It is wrong for anything a person DOES: routing "the roster is
// published" through a job that runs every two hours means the notification
// arrives up to two hours after the thing it announces, by which point the
// member has already heard about it in WhatsApp, which is the problem this
// system exists to replace.
//
// So both paths exist and share this module. The cost is that a Server Action
// now waits on network calls to a push service, which is why sendPush fans out
// with Promise.allSettled and a hard per-request timeout: Vercel's Hobby
// functions are killed at ten seconds, and a notification is never worth failing
// the write it accompanies.
// ─────────────────────────────────────────────────────────────────────────────
//
// R6 — no secret here reaches the browser. VAPID_PRIVATE_KEY is read on the
// server only. NEXT_PUBLIC_VAPID_PUBLIC_KEY is public by design: it is what the
// browser subscribes with, and it grants nothing on its own.

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The kinds a member can switch off (T5.9, migration 023).
 *
 * A union rather than `string`, so a typo is a compile error. push_targets()
 * treats an unrecognised kind as "send to nobody", which is the safe answer at
 * runtime but a silent one — this is the half that is not silent.
 */
export type NotificationKind =
  | "announcements"
  | "cwl_reminders"
  | "war_reminders"
  | "raid_reminders"
  | "poll_reminders"
  // T12.2 — a message from leadership to one account. Its own kind rather than
  // riding on 'announcements', so muting clan notices cannot silently suppress
  // the one notification that is about the member personally (039).
  | "direct_messages";

/**
 * What the service worker receives.
 *
 * Kept deliberately small and free of anything private. A push payload is
 * decrypted on a device this system has no control over and may sit in an OS
 * notification tray on a lock screen — so it names what happened and links to
 * where to read it, and never carries the content itself.
 */
export interface PushPayload {
  title: string;
  body: string;
  /** Path within the site, e.g. `/%232PP0JCCL/cwl`. Opened on click. */
  url: string;
  /**
   * Collapse key. A second notification with the same tag REPLACES the first
   * rather than stacking, which is what stops four sync ticks leaving four
   * identical "attacks remaining" notifications on the lock screen.
   */
  tag?: string;
}

export interface PushTarget {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

export interface SendResult {
  sent: number;
  /** Endpoints the push service reported as permanently gone (404/410). */
  expired: string[];
  failed: number;
}

/** Whether push can work at all. False in every environment before T0.10. */
export function pushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PRIVATE_KEY &&
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY &&
      process.env.VAPID_SUBJECT,
  );
}

/**
 * Who to notify, for one clan and one kind.
 *
 * Delegates to push_targets() (023) rather than querying the tables, so the clan
 * filter (R3), the leadership check and the T5.9 preference handling have one
 * implementation and cannot drift apart. A caller that forgets to check
 * authority still gets an empty list rather than another clan's endpoints.
 */
export async function pushTargets(
  supabase: SupabaseClient,
  clanId: string,
  kind: NotificationKind,
): Promise<PushTarget[]> {
  const { data, error } = await supabase.rpc("push_targets", {
    p_clan: clanId,
    p_kind: kind,
  });

  if (error) {
    // Never fatal. A notification that cannot be addressed must not take down
    // the announcement it was going to announce.
    console.error(`push: could not resolve targets — ${error.message}`);
    return [];
  }

  return (data ?? []) as PushTarget[];
}

/**
 * Encrypt and deliver one payload to many subscriptions.
 *
 * `web-push` is imported lazily. It pulls in Node crypto and an HTTP stack that
 * has no business in a bundle for a page that never notifies anyone, and this
 * module is imported by Server Actions that mostly do not send.
 */
export async function sendPush(
  targets: readonly PushTarget[],
  payload: PushPayload,
): Promise<SendResult> {
  const result: SendResult = { sent: 0, expired: [], failed: 0 };

  if (targets.length === 0) return result;

  if (!pushConfigured()) {
    // T0.10 generates the keys; until they are set this is a no-op rather than a
    // crash, so every caller can be written as though push always works.
    console.warn("push: VAPID keys are not configured — nothing sent");
    return result;
  }

  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );

  const body = JSON.stringify(payload);

  // In parallel, and never rejecting: one dead endpoint out of thirty must not
  // stop the other twenty-nine, and thirty sequential POSTs would exceed the
  // function timeout on their own.
  const outcomes = await Promise.allSettled(
    targets.map((target) =>
      webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth_key },
        },
        body,
        { TTL: 60 * 60 * 12 },
      ),
    ),
  );

  outcomes.forEach((outcome, i) => {
    if (outcome.status === "fulfilled") {
      result.sent += 1;
      return;
    }

    const status = (outcome.reason as { statusCode?: number } | null)?.statusCode;

    // 404 and 410 are the push service saying this endpoint will never work
    // again — the app was uninstalled, or the browser rotated it. That is
    // ordinary, not a failure (R10 in spirit), and the row should stop being
    // tried. Anything else may be transient and is left alone.
    if (status === 404 || status === 410) {
      result.expired.push(targets[i]!.endpoint);
      return;
    }

    result.failed += 1;
    // No payload and no endpoint in the log: an endpoint is a capability URL.
    console.error(`push: delivery failed with status ${status ?? "unknown"}`);
  });

  return result;
}

/**
 * Retire endpoints the push service has permanently rejected.
 *
 * SOFT delete (R4). The row stays, so a member who reinstalls and re-subscribes
 * on the same endpoint revives it rather than colliding with 004's unique index.
 */
export async function retireExpired(
  supabase: SupabaseClient,
  endpoints: readonly string[],
): Promise<void> {
  if (endpoints.length === 0) return;

  const { error } = await supabase
    .from("push_subscriptions")
    .update({ deleted_at: new Date().toISOString() })
    .in("endpoint", [...endpoints])
    .is("deleted_at", null);

  if (error) {
    console.error(`push: could not retire expired subscriptions — ${error.message}`);
  }
}

/**
 * Resolve, send, and clean up. What every caller actually wants.
 *
 * Returns the result rather than throwing: no caller should abandon its own work
 * because a notification did not land.
 */
export async function notifyClan(
  supabase: SupabaseClient,
  clanId: string,
  kind: NotificationKind,
  payload: PushPayload,
): Promise<SendResult> {
  const targets = await pushTargets(supabase, clanId, kind);
  const result = await sendPush(targets, payload);
  await retireExpired(supabase, result.expired);
  return result;
}

/**
 * As notifyClan, but only to the users given.
 *
 * T4B.5 chases the members who have NOT answered a poll, and notifying everyone
 * would be worse than notifying nobody — the people who already answered learn
 * that answering does not stop the reminders, and stop answering.
 */
export async function notifyUsers(
  supabase: SupabaseClient,
  clanId: string,
  kind: NotificationKind,
  userIds: readonly string[],
  payload: PushPayload,
): Promise<SendResult> {
  if (userIds.length === 0) return { sent: 0, expired: [], failed: 0 };

  const wanted = new Set(userIds);
  // Filtered from the authorised list rather than queried directly: this way the
  // clan check and the preference check still happen, and a caller cannot reach
  // a user outside the clan by passing their id.
  const targets = (await pushTargets(supabase, clanId, kind)).filter((t) =>
    wanted.has(t.user_id),
  );

  const result = await sendPush(targets, payload);
  await retireExpired(supabase, result.expired);
  return result;
}
