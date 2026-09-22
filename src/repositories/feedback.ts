// T12.5 — member feedback, and the two reads the public landing page makes.
//
// Every write here is an RPC into 042; nothing inserts into `feedback`
// directly, because a member able to write that table could approve their own
// quote. publicStats() and publicFeedback() are the only functions in the
// product an ANONYMOUS caller reaches — see 042's header before widening them.

import type { SupabaseClient } from "@supabase/supabase-js";
import { safeMessage } from "@/lib/errors";

export type FeedbackStatus = "pending" | "approved" | "hidden";

export interface PublicStats {
  clans: number;
  members: number;
  cwlSeasons: number;
  wars: number;
}

/**
 * The landing page's four totals, or null when the call failed.
 *
 * Null rather than zeros, deliberately: "0 members" on a public page is a false
 * statement about the platform, and the page hides the strip instead.
 */
export async function publicStats(supabase: SupabaseClient): Promise<PublicStats | null> {
  const { data, error } = await supabase.rpc("public_stats");
  if (error) {
    safeMessage("public-stats", error, "");
    return null;
  }
  const row = (data as Array<Record<string, unknown>> | null)?.[0];
  if (!row) return null;
  return {
    clans: (row.clans as number | null) ?? 0,
    members: (row.members as number | null) ?? 0,
    cwlSeasons: (row.cwl_seasons as number | null) ?? 0,
    wars: (row.wars as number | null) ?? 0,
  };
}

export interface PublicQuote {
  body: string;
  rating: number;
  author: string;
  clan: string | null;
  createdAt: string;
}

/** Approved quotes, newest first. Empty on failure — the section then hides. */
export async function publicFeedback(
  supabase: SupabaseClient,
  limit = 6,
): Promise<PublicQuote[]> {
  const { data, error } = await supabase.rpc("public_feedback", { p_limit: limit });
  if (error) {
    safeMessage("public-feedback", error, "");
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    body: row.body as string,
    rating: row.rating as number,
    author: row.author as string,
    clan: (row.clan as string | null) ?? null,
    createdAt: row.created_at as string,
  }));
}

export interface FeedbackItem {
  id: string;
  userId: string;
  rating: number;
  body: string;
  status: FeedbackStatus;
  createdAt: string;
  reviewedAt: string | null;
}

const COLUMNS = "id, user_id, rating, body, status, created_at, reviewed_at";

function toItem(row: Record<string, unknown>): FeedbackItem {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    rating: row.rating as number,
    body: row.body as string,
    status: row.status as FeedbackStatus,
    createdAt: row.created_at as string,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
  };
}

/**
 * The caller's own submissions.
 *
 * The user_id filter is stated even though "read own feedback" already scopes
 * it: the platform admin's second policy reads ALL rows, and without the filter
 * the admin's /feedback page would list everybody's.
 */
export async function myFeedback(
  supabase: SupabaseClient,
  userId: string,
): Promise<FeedbackItem[]> {
  const { data, error } = await supabase
    .from("feedback")
    .select(COLUMNS)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    safeMessage("my-feedback", error, "");
    return [];
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map(toItem);
}

/** Every submission, pending first. RLS returns rows only to the platform admin. */
export async function allFeedback(supabase: SupabaseClient): Promise<FeedbackItem[]> {
  const { data, error } = await supabase
    .from("feedback")
    .select(COLUMNS)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) {
    safeMessage("all-feedback", error, "");
    return [];
  }
  const order: Record<FeedbackStatus, number> = { pending: 0, approved: 1, hidden: 2 };
  return ((data ?? []) as Array<Record<string, unknown>>)
    .map(toItem)
    .sort((a, b) => order[a.status] - order[b.status]);
}

/** Submit or replace the caller's pending feedback. Null when refused. */
export async function submitFeedback(
  supabase: SupabaseClient,
  rating: number,
  body: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("submit_feedback", {
    p_rating: rating,
    p_body: body,
  });
  if (error) {
    safeMessage("submit-feedback", error, "");
    return null;
  }
  return (data as string | null) ?? null;
}

/** Approve or hide. False when refused (not the platform admin, or no such row). */
export async function reviewFeedback(
  supabase: SupabaseClient,
  id: string,
  status: "approved" | "hidden",
): Promise<boolean> {
  const { data, error } = await supabase.rpc("review_feedback", {
    p_id: id,
    p_status: status,
  });
  if (error) {
    safeMessage("review-feedback", error, "");
    return false;
  }
  return data === true;
}
