// T12.3 — the notification feed, from the reader's side.
//
// The writes are not here. Every notification is raised by lib/push.ts, which
// records the row and rings the doorbell in that order; a repository function
// that inserted one would be a second way to do it, and the two would disagree
// about whether preferences apply the first time somebody was in a hurry.
//
// R3 — no clanId parameter, and that is correct rather than the omission
// repositories/README.md warns about. A notification belongs to a PERSON, who
// may hold roles in several clans; 040's "read own notifications" policy scopes
// every read below to the two ends of the conversation, and the clan the
// notification was raised under is a column on it rather than a filter for it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeMessage } from "@/lib/errors";

export interface FeedNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** A path within this site. 040's check constraint guarantees it is relative. */
  url: string;
  createdAt: string;
  readAt: string | null;
  clanId: string | null;
  senderId: string | null;
}

const COLUMNS = "id, kind, title, body, url, created_at, read_at, clan_id, sender_id";

function toNotification(row: Record<string, unknown>): FeedNotification {
  return {
    id: row.id as string,
    kind: row.kind as string,
    title: row.title as string,
    body: row.body as string,
    url: (row.url as string | null) ?? "/",
    createdAt: row.created_at as string,
    readAt: (row.read_at as string | null) ?? null,
    clanId: (row.clan_id as string | null) ?? null,
    senderId: (row.sender_id as string | null) ?? null,
  };
}

/**
 * The signed-in member's feed, newest first.
 *
 * The `recipient_id` filter is NOT redundant against RLS, and leaving it out is
 * the one bug this query can have: 040's policy deliberately returns both ends
 * of the conversation so a leader can see what they have already sent, which
 * means a bare select is the sender's view as well. Without the filter a leader
 * would find every announcement they ever wrote sitting in their own inbox.
 */
export async function feedFor(
  supabase: SupabaseClient,
  userId: string,
  limit = 100,
): Promise<FeedNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select(COLUMNS)
    .eq("recipient_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    safeMessage("notification-feed", error, "");
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map(toNotification);
}

/**
 * How many the member has not opened. The number on the bell.
 *
 * `head: true` with an exact count, so this is counted on the server and no row
 * data crosses the wire. It runs in the app shell on every navigation — see
 * (app)/layout.tsx for why that is affordable in parallel and would not be in
 * sequence (T10.9).
 */
export async function unreadCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", userId)
    .is("read_at", null)
    .is("deleted_at", null);

  if (error) {
    // Never fatal. A badge that cannot be counted must not take down the shell
    // that every page in the product renders inside.
    safeMessage("notification-unread-count", error, "");
    return 0;
  }

  return count ?? 0;
}

/** Mark one read. False if it is not the caller's, or was already read. */
export async function markRead(
  supabase: SupabaseClient,
  notificationId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("mark_notification_read", {
    p_id: notificationId,
  });

  if (error) {
    safeMessage("mark-notification-read", error, "");
    return false;
  }

  return data === true;
}

/** Clear the whole unread list. Returns how many were cleared. */
export async function markAllRead(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase.rpc("mark_all_notifications_read");

  if (error) {
    safeMessage("mark-all-notifications-read", error, "");
    return 0;
  }

  return (data as number | null) ?? 0;
}

/**
 * What one leader has already sent one member, newest first.
 *
 * Both filters matter. `sender_id` is what makes this the caller's own record
 * rather than the member's whole inbox — a message from a DIFFERENT leader is
 * between those two people, and 040's policy already refuses it. Stating it
 * here means the admin screen cannot accidentally come to depend on that.
 */
export async function sentTo(
  supabase: SupabaseClient,
  senderId: string,
  recipientId: string,
): Promise<FeedNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select(COLUMNS)
    .eq("recipient_id", recipientId)
    .eq("sender_id", senderId)
    .eq("kind", "direct_messages")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    safeMessage("notifications-sent-to", error, "");
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map(toNotification);
}

// ---------------------------------------------------------------------------
// Presence (T12.3).
// ---------------------------------------------------------------------------

export interface PlatformPresence {
  totalAccounts: number;
  activeAccounts: number;
  onlineNow: number;
  pendingAccounts: number;
}

const NOBODY: PlatformPresence = {
  totalAccounts: 0,
  activeAccounts: 0,
  onlineNow: 0,
  pendingAccounts: 0,
};

/**
 * Account counts, and who has loaded a page in the last five minutes.
 *
 * Counts only — platform_presence() (040) never returns a list, because every
 * approved member can call it and `users` holds email addresses. The directory
 * of people is /search, which reads in-game names.
 *
 * Zeros for a caller with no clan role. That is the function's guard showing
 * through rather than an error: it is an aggregate, so it always returns one
 * row, and the row is empty when the guard says no.
 */
export async function platformPresence(
  supabase: SupabaseClient,
): Promise<PlatformPresence> {
  const { data, error } = await supabase.rpc("platform_presence");

  if (error) {
    safeMessage("platform-presence", error, "");
    return NOBODY;
  }

  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return NOBODY;

  return {
    totalAccounts: (row.total_accounts as number | null) ?? 0,
    activeAccounts: (row.active_accounts as number | null) ?? 0,
    onlineNow: (row.online_now as number | null) ?? 0,
    pendingAccounts: (row.pending_accounts as number | null) ?? 0,
  };
}

/**
 * Record that the caller is here.
 *
 * Throttled inside the database (040): the update only fires when the stored
 * value is already two minutes old, so clicking through ten pages is one write
 * rather than ten. Returns nothing and swallows its own error — presence is the
 * least important thing on any page it is called from.
 */
export async function touchLastSeen(supabase: SupabaseClient): Promise<void> {
  const { error } = await supabase.rpc("touch_last_seen");
  if (error) safeMessage("touch-last-seen", error, "");
}
