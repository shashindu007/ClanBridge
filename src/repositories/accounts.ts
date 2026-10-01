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
  /** The clan the village is in right now, per the last sync (046). */
  clanId?: string | null;
  /** Set when the sync saw it leave all three clans (008). */
  leftAt?: string | null;
}

/**
 * The clans this account holds a role in but has no village in any more.
 *
 * PER CLAN, not "every clan at once". The first version flagged an account
 * only when it had left EVERY clan it held a role in, so a member with roles in
 * two of the family's clans who was kicked from one — or a co-leader demoted
 * and removed from one — kept that clan's war plans and leadership with nothing
 * anywhere saying so, because the other role still had a village behind it.
 *
 * Empty when the account has no villages: there is nothing to compare, and
 * "never verified" is a different conversation from "left".
 *
 * Deliberately NOT acted on automatically: the family moves players between its
 * clans for CWL, and R11 keeps the sync away from roles. A leader sees the flag
 * and decides.
 */
export function clansLeftInGame(
  account: Pick<AdminAccount, "memberships" | "players">,
): AccountMembership[] {
  if (!account.players.length) return [];
  const present = new Set(
    account.players.filter((p) => !p.leftAt && p.clanId != null).map((p) => p.clanId),
  );
  return account.memberships.filter((m) => !present.has(m.clanId));
}

/** Has this account left, in game, any clan it still holds a role in? */
export function leftClanInGame(account: Pick<AdminAccount, "memberships" | "players">): boolean {
  return clansLeftInGame(account).length > 0;
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

// The recipient's side of a direct message is NOT here any more.
//
// T12.3 folded it into the one notification feed: a message is a notification
// of kind 'direct_messages', read through repositories/notifications.ts like
// every other. Two inboxes with two unread counts was the fragmentation that
// phase existed to remove, and keeping a second set of readers here would have
// been the quiet way to grow it back.

/**
 * T12.9 — set one member's role in one clan, or take them out of it (`null`).
 *
 * set_clan_role() (044) decides who may: the platform admin, or a leader of
 * that clan; never on yourself; only the admin grants or removes leader. False
 * covers every refusal and the caller must not try to tell them apart.
 */
export async function setClanRole(
  supabase: SupabaseClient,
  userId: string,
  clanId: string,
  role: "member" | "elder" | "co-leader" | "leader" | null,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("set_clan_role", {
    p_user: userId,
    p_clan: clanId,
    p_role: role,
  });

  if (error) {
    safeMessage("set-clan-role", error, "");
    return false;
  }

  return data === true;
}
