// T4B.2-T4B.4 — poll reads and writes.
//
// R11 — HUMAN DECISION DATA. Everything here is written by people through the
// application. No sync job may import this file.
//
// The clan filter is unusual in this one, and deliberately so: a poll is either
// scoped to one clan or to the whole family, and a family poll has clan_id NULL
// by constraint. So "filter by clan" here means "this clan's polls plus the
// family ones", which is what the RLS policy in 010 says too. Filtering on
// clan_id alone would silently hide every CWL availability poll — the ones that
// matter most.

import type { SupabaseClient } from "@supabase/supabase-js";

export type PollScope = "clan" | "family";
export type PollType = "cwl_availability" | "war_availability" | "general";
export type PollStatus = "draft" | "open" | "closed";

export interface Poll {
  id: string;
  scope: PollScope;
  clanId: string | null;
  season: string | null;
  pollType: PollType;
  title: string;
  question: string | null;
  opensAt: string | null;
  closesAt: string | null;
  status: PollStatus;
  createdBy: string;
  createdAt: string;
}

export interface PollOption {
  id: string;
  pollId: string;
  label: string;
  sortOrder: number;
}

export interface PollResponse {
  id: string;
  pollId: string;
  playerId: string;
  optionId: string;
  note: string | null;
  respondedAt: string;
  updatedAt: string | null;
}

/** Option counts, from the definer function every member may call (T4B.4). */
export interface PollCount {
  optionId: string;
  label: string;
  sortOrder: number;
  votes: number;
}

function toPoll(r: Record<string, unknown>): Poll {
  return {
    id: r.id as string,
    scope: r.scope as PollScope,
    clanId: (r.clan_id as string | null) ?? null,
    season: (r.season as string | null) ?? null,
    pollType: r.poll_type as PollType,
    title: r.title as string,
    question: (r.question as string | null) ?? null,
    opensAt: (r.opens_at as string | null) ?? null,
    closesAt: (r.closes_at as string | null) ?? null,
    status: r.status as PollStatus,
    createdBy: r.created_by as string,
    createdAt: r.created_at as string,
  };
}

const POLL_COLUMNS =
  "id, scope, clan_id, season, poll_type, title, question, opens_at, closes_at, " +
  "status, created_by, created_at";

/**
 * Polls this clan can see: its own, plus every family poll.
 *
 * RLS returns exactly this set already; the filter here is the mechanism and the
 * policy is the net (R3). Done in TypeScript because it is an OR across two
 * columns and PostgREST's .or() is unsupported by the PGlite stand-in.
 */
export async function pollsForClan(
  supabase: SupabaseClient,
  clanId: string,
): Promise<Poll[]> {
  const { data, error } = await supabase
    .from("polls")
    .select(POLL_COLUMNS)
    .is("deleted_at", null)
    .order("created_at");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>)
    .filter((r) => r.scope === "family" || r.clan_id === clanId)
    .map(toPoll)
    .reverse(); // newest first; .order() in the stand-in is ascending only
}

export async function pollById(
  supabase: SupabaseClient,
  pollId: string,
): Promise<Poll | null> {
  const { data, error } = await supabase
    .from("polls")
    .select(POLL_COLUMNS)
    .eq("id", pollId)
    .is("deleted_at", null);

  if (error || !data?.length) return null;
  return toPoll((data as unknown as Array<Record<string, unknown>>)[0]!);
}

export async function optionsForPoll(
  supabase: SupabaseClient,
  pollId: string,
): Promise<PollOption[]> {
  const { data, error } = await supabase
    .from("poll_options")
    .select("id, poll_id, label, sort_order")
    .eq("poll_id", pollId)
    .is("deleted_at", null)
    .order("sort_order");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    pollId: r.poll_id as string,
    label: r.label as string,
    sortOrder: (r.sort_order as number) ?? 0,
  }));
}

/**
 * Every response the caller is allowed to see.
 *
 * For leadership that is all of them; for anyone else it is their own. That
 * asymmetry is the policy's doing, not this function's — which is the point.
 * A page must therefore never infer "nobody answered" from an empty result; use
 * {@link countsForPoll} for totals.
 */
export async function responsesForPoll(
  supabase: SupabaseClient,
  pollId: string,
): Promise<PollResponse[]> {
  const { data, error } = await supabase
    .from("poll_responses")
    .select("id, poll_id, player_id, option_id, note, responded_at, updated_at")
    .eq("poll_id", pollId)
    .is("deleted_at", null);

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    pollId: r.poll_id as string,
    playerId: r.player_id as string,
    optionId: r.option_id as string,
    note: (r.note as string | null) ?? null,
    respondedAt: r.responded_at as string,
    updatedAt: (r.updated_at as string | null) ?? null,
  }));
}

/** Totals every member may see, aggregated inside a definer function (T4B.4). */
export async function countsForPoll(
  supabase: SupabaseClient,
  pollId: string,
): Promise<PollCount[]> {
  const { data, error } = await supabase.rpc("poll_option_counts", { p_poll: pollId });

  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    optionId: r.option_id as string,
    label: r.label as string,
    sortOrder: (r.sort_order as number) ?? 0,
    votes: Number(r.votes ?? 0),
  }));
}

/** The players this user may answer for — usually one, sometimes several. */
export async function myPlayers(
  supabase: SupabaseClient,
  userId: string,
): Promise<Array<{ id: string; tag: string; name: string; clanId: string | null }>> {
  const { data, error } = await supabase
    .from("players")
    .select("id, tag, name, clan_id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("tag");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    tag: r.tag as string,
    name: r.name as string,
    clanId: (r.clan_id as string | null) ?? null,
  }));
}

export interface NewPoll {
  scope: PollScope;
  clanId: string | null;
  season: string | null;
  pollType: PollType;
  title: string;
  question: string | null;
  closesAt: string | null;
  createdBy: string;
}

/** Create a poll and its options together. Leadership only, enforced by policy. */
export async function createPoll(
  supabase: SupabaseClient,
  poll: NewPoll,
  optionLabels: string[],
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("polls")
    .insert({
      scope: poll.scope,
      clan_id: poll.clanId,
      season: poll.season,
      poll_type: poll.pollType,
      title: poll.title,
      question: poll.question,
      closes_at: poll.closesAt,
      created_by: poll.createdBy,
      status: "open",
    })
    .select()
    .single();

  if (error || !data) return { error: error?.message ?? "could not create the poll" };
  const id = (data as { id: string }).id;

  const { error: optionError } = await supabase.from("poll_options").insert(
    optionLabels.map((label, index) => ({
      poll_id: id,
      label,
      sort_order: index + 1,
    })),
  );

  // A poll with no options cannot be answered, so a half-created one is worse
  // than none. There is no transaction across two PostgREST calls, so the poll
  // is closed rather than left inviting answers nobody can give.
  if (optionError) {
    await supabase.from("polls").update({ status: "closed" }).eq("id", id);
    return { error: `options failed: ${optionError.message}` };
  }

  return { id };
}

/**
 * Record or change one player's answer.
 *
 * Upsert on (poll_id, player_id) — the unique constraint from 010 — because
 * "editable until the poll closes" (T4B.3) means a second submission is the
 * normal case, not an error. The closes_at check lives in the policy, so a late
 * edit is refused by the database rather than by the form.
 */
export async function answerPoll(
  supabase: SupabaseClient,
  pollId: string,
  playerId: string,
  optionId: string,
  note: string | null,
): Promise<{ error?: string }> {
  const { error } = await supabase.from("poll_responses").upsert(
    { poll_id: pollId, player_id: playerId, option_id: optionId, note },
    { onConflict: "poll_id,player_id", ignoreDuplicates: false },
  );

  return error ? { error: error.message } : {};
}

/** Close a poll early. Leadership only, enforced by policy. */
export async function closePoll(
  supabase: SupabaseClient,
  pollId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("polls")
    .update({ status: "closed", closes_at: new Date().toISOString() })
    .eq("id", pollId);

  return error ? { error: error.message } : {};
}
