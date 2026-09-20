// R4 / T9.6 — the audit trail.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS FILE DOES NOT WRITE audit_log, AND THAT IS THE DESIGN.
//
// repositories/README.md says "writes go through lib/audit.ts". That was the
// original intent and it is the wrong shape, so it is being corrected here
// rather than implemented.
//
// The problem with an application-side recorder is that it is optional. Two
// statements — the write, then the audit row — with no transaction between
// them, appended by the same client that could simply not append. Worse, it
// needs an INSERT policy on audit_log, at which point any signed-in member can
// write entries attributing actions to anyone.
//
// R4 says every write is recorded. A record the writer can skip or forge is not
// one. So audited writes run inside SECURITY DEFINER functions that write the
// row and its audit entry or neither: approve_account() and reject_account()
// (015/017), link_verified_player() (016), and post/edit/remove_announcement()
// (021). audit_log has no insert policy and must never get one.
//
// What lives here instead: the vocabulary both sides share, and the READ side
// that T9.6's viewer needs. Writing is SQL's job; reading is the app's.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The `action` values the definer functions write.
 *
 * Not a database CHECK constraint: audit_log.action is deliberately open text so
 * a future migration can record something this list has not imagined without an
 * ALTER on an append-only table. This is the closed view of it that the UI knows
 * how to label — anything else falls through to the raw string.
 */
export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "publish"
  | "approve"
  | "reject"
  | "verify"
  // T12.2 — administering an account after approval (039). "remove" is distinct
  // from "delete": R4 keeps the row, and "restore" is the act that undoes it.
  | "message"
  | "remove"
  | "restore";

export const ACTION_LABELS: Record<string, string> = {
  create: "created",
  update: "edited",
  delete: "removed",
  publish: "published",
  approve: "approved",
  reject: "rejected",
  verify: "verified",
  message: "messaged",
  // "removed access from", not "deleted". The account still exists.
  remove: "removed access from",
  restore: "restored",
};

export interface AuditEntry {
  id: string;
  userId: string | null;
  clanId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * T9.6 — the audit log for one clan, newest first.
 *
 * LEADER ONLY, and enforced by the policy rather than by this function. 006's
 * "leaders read own clan audit log" uses auth_leader_clan_ids(), so a co-leader
 * calling this gets an empty list, not an error. That is deliberate: the log
 * contains entries about the people who can read it, and co-leaders are
 * subjects of it.
 *
 * Note what is NOT here: no way to filter deleted_at, because nothing sets it.
 * The column exists for consistency with section 4 and 005 says outright that
 * nothing should ever set it — an audit log you can quietly remove entries from
 * is not an audit log.
 */
export async function auditEntriesForClan(
  supabase: SupabaseClient,
  clanId: string,
  options: { entity?: string; limit?: number } = {},
): Promise<AuditEntry[]> {
  const query = supabase
    .from("audit_log")
    .select("id, user_id, clan_id, action, entity, entity_id, before, after, created_at")
    .eq("clan_id", clanId); // R3

  if (options.entity) query.eq("entity", options.entity);

  const { data, error } = await query
    .limit(options.limit ?? 200)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    userId: (r.user_id as string | null) ?? null,
    clanId: (r.clan_id as string | null) ?? null,
    action: r.action as string,
    entity: r.entity as string,
    entityId: (r.entity_id as string | null) ?? null,
    before: (r.before as Record<string, unknown> | null) ?? null,
    after: (r.after as Record<string, unknown> | null) ?? null,
    createdAt: r.created_at as string,
  }));
}

/**
 * user_id -> email, for turning an audit row into a sentence.
 *
 * Email rather than display name because display_name is nullable and an audit
 * entry that says "somebody edited this" is worth very little. RLS on `users`
 * decides which of these resolve; an id that does not is rendered as "a user"
 * rather than a bare uuid.
 */
export async function auditActorEmails(
  supabase: SupabaseClient,
  userIds: Array<string | null>,
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();

  const { data, error } = await supabase.from("users").select("id, email").in("id", ids);
  if (error || !data) return new Map();

  return new Map(
    (data as Array<{ id: string; email: string }>).map((u) => [u.id, u.email]),
  );
}

/** "created an announcement" — the shape T9.6 renders per row. */
export function describeAudit(entry: AuditEntry): string {
  const verb = ACTION_LABELS[entry.action] ?? entry.action;
  const subject = entry.entity.replace(/_/g, " ").replace(/s$/, "");
  const title = (entry.after?.title ?? entry.before?.title) as string | undefined;
  return title ? `${verb} the ${subject} “${title}”` : `${verb} a ${subject}`;
}
