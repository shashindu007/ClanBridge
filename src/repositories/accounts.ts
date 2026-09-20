// T12.2 — the accounts an admin or leader may administer, and the four acts.
//
// Everything here is an RPC into 039. None of it is a table query, and that is
// the design rather than a preference: `users` carries email, username and
// is_platform_admin, and no RLS policy in this system lets one member read
// another's row. The functions answer with eleven columns and the authority
// check attached, so a bug in this file cannot widen what comes back — it can
// only fail to ask.
//
// R3 — there is no clanId parameter anywhere below, which for once is correct
// rather than the mistake repositories/README.md warns about. An account is not
// clan data: it belongs to a person who may hold roles in several clans or none
// at all, and 039's auth_may_administer_account() resolves the clan scope from
// the CALLER's leadership rather than from an argument a route could get wrong.

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeMessage } from "@/lib/errors";

/** One clan an account holds a role in. */
export interface AccountMembership {
  clanId: string;
  clan: string;
  tag: string;
  role: string;
}

/** One village the account has verified. */
export interface AccountPlayer {
  tag: string;
  name: string;
  thLevel: number | null;
}

export interface AdminAccount {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  /** T3.8 — 'pending' | 'approved' | 'rejected'. */
  status: string;
  isPlatformAdmin: boolean;
  createdAt: string;
  approvedAt: string | null;
  /**
   * When access was taken away, or null. Named for what it means rather than
   * after the column (R4 — the row itself is never gone).
   */
  removedAt: string | null;
  /** The clan a pending applicant verified into, if they have. */
  requestedClan: string | null;
  memberships: AccountMembership[];
  players: AccountPlayer[];
  unreadMessages: number;
}

function toAccount(row: Record<string, unknown>): AdminAccount {
  return {
    id: row.id as string,
    email: (row.email as string | null) ?? "",
    username: (row.username as string | null) ?? null,
    displayName: (row.display_name as string | null) ?? null,
    status: row.status as string,
    isPlatformAdmin: row.is_platform_admin === true,
    createdAt: row.created_at as string,
    approvedAt: (row.approved_at as string | null) ?? null,
    removedAt: (row.removed_at as string | null) ?? null,
    requestedClan: (row.requested_clan as string | null) ?? null,
    memberships: (row.memberships as AccountMembership[] | null) ?? [],
    players: (row.players as AccountPlayer[] | null) ?? [],
    unreadMessages: (row.unread_messages as number | null) ?? 0,
  };
}

/**
 * Every account the caller may administer, pending first and removed last.
 *
 * Returns an empty list for a caller with no authority — the function answers
 * with zero rows rather than an error, which is how every read in this schema
 * says no, and a page that renders "no accounts" is a better answer than one
 * that renders a stack trace.
 */
export async function adminAccounts(
  supabase: SupabaseClient,
  search?: string | null,
): Promise<AdminAccount[]> {
  const { data, error } = await supabase.rpc("admin_accounts", {
    p_search: search?.trim() || null,
  });

  if (error) {
    safeMessage("admin-accounts", error, "");
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map(toAccount);
}

/**
 * One account, or null.
 *
 * Deliberately built on the same function as the list rather than a second one
 * that reads the row directly. A detail view with its own query is a detail
 * view with its own authority check, and the two drift the first time either
 * changes — the account page would keep working for somebody the directory had
 * already stopped showing them.
 */
export async function adminAccount(
  supabase: SupabaseClient,
  userId: string,
): Promise<AdminAccount | null> {
  const all = await adminAccounts(supabase);
  return all.find((account) => account.id === userId) ?? null;
}

/**
 * Send one message. Returns the new id, or null when the database refused.
 *
 * Null covers both "you have no authority over that account" and "there is no
 * such account", and the caller must not try to tell them apart — that
 * difference is exactly what a prober is trying to learn.
 */
export async function sendAccountMessage(
  supabase: SupabaseClient,
  userId: string,
  subject: string,
  body: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("send_account_message", {
    p_target: userId,
    p_subject: subject,
    p_body: body,
  });

  if (error) {
    safeMessage("send-account-message", error, "");
    return null;
  }

  return (data as string | null) ?? null;
}

/** Take access away. False when the database refused. */
export async function removeAccount(
  supabase: SupabaseClient,
  userId: string,
  reason: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("remove_account", {
    p_target: userId,
    p_reason: reason.trim() || null,
  });

  if (error) {
    // Includes "the platform admin account cannot be removed", which 039 raises
    // by name. The page turns a false into its own sentence rather than showing
    // Postgres text (T10.8d).
    safeMessage("remove-account", error, "");
    return false;
  }

  return data === true;
}

/** Put a removed account back in the approval queue. False when refused. */
export async function restoreAccount(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("restore_account", {
    p_target: userId,
  });

  if (error) {
    safeMessage("restore-account", error, "");
    return false;
  }

  return data === true;
}

// ---------------------------------------------------------------------------
// The recipient's side.
// ---------------------------------------------------------------------------

export interface InboxMessage {
  id: string;
  subject: string;
  body: string;
  createdAt: string;
  readAt: string | null;
}

/**
 * The signed-in member's messages, newest first.
 *
 * A plain table read, not an RPC, because 039's "read own account messages"
 * policy already scopes it to the two ends of the conversation — there is no
 * authority to check that RLS has not checked. The `recipient_id` filter is
 * still stated: without it this returns the caller's SENT messages too, which
 * is correct for the policy and wrong for an inbox.
 */
export async function inboxMessages(
  supabase: SupabaseClient,
  userId: string,
): Promise<InboxMessage[]> {
  const { data, error } = await supabase
    .from("account_messages")
    .select("id, subject, body, created_at, read_at")
    .eq("recipient_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    safeMessage("inbox-messages", error, "");
    return [];
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    subject: row.subject as string,
    body: row.body as string,
    createdAt: row.created_at as string,
    readAt: (row.read_at as string | null) ?? null,
  }));
}

/**
 * How many the member has not opened.
 *
 * `head: true` with an exact count, so this is a count on the server and no row
 * data crosses the wire. It runs in the app shell on every navigation, which is
 * the one place in this product where an extra round trip was a visible bug
 * (T10.9) — see (app)/layout.tsx for why it is affordable there and would not
 * be if it were awaited in sequence.
 */
export async function unreadMessageCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from("account_messages")
    .select("id", { count: "exact", head: true })
    .eq("recipient_id", userId)
    .is("read_at", null)
    .is("deleted_at", null);

  if (error) {
    // Never fatal. A badge that cannot be counted must not take down the shell
    // that every page in the product renders inside.
    safeMessage("unread-message-count", error, "");
    return 0;
  }

  return count ?? 0;
}

/** Mark one message read. Silently does nothing if it is not the caller's. */
export async function markMessageRead(
  supabase: SupabaseClient,
  messageId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("mark_message_read", {
    p_message: messageId,
  });

  if (error) {
    safeMessage("mark-message-read", error, "");
    return false;
  }

  return data === true;
}
