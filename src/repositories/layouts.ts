// T8.3/T8.4/T8.5 — the layout library's reads and writes.
//
// R3 — every query filters by clan explicitly, even though 006's policy already
// does. The policy is the net; this is the plan. A layout id pasted into a URL
// from another clan resolves to nothing here rather than relying on RLS to
// notice, which is the same discipline every other repository in this project
// follows.
//
// R4 — nothing is deleted. Removing a layout sets deleted_at, which is an
// UPDATE, and 028's policy is written for exactly that.

import type { SupabaseClient } from "@supabase/supabase-js";

export type LayoutType = "war" | "farming" | "trophy";

export const LAYOUT_TYPES: LayoutType[] = ["war", "farming", "trophy"];

/** The Town Hall levels worth offering. Below 9 nobody shares a base. */
export const TH_LEVELS = [17, 16, 15, 14, 13, 12, 11, 10, 9] as const;

export interface LayoutRow {
  id: string;
  clanId: string;
  uploadedBy: string;
  uploaderName: string | null;
  thLevel: number;
  layoutType: LayoutType;
  copyLink: string;
  imageUrl: string | null;
  description: string | null;
  votes: number;
  createdAt: string;
  /** Whether the signed-in member has a live vote on this one. */
  votedByMe: boolean;
}

export interface LayoutFilter {
  thLevel?: number | null;
  layoutType?: LayoutType | null;
}

function toRow(r: Record<string, unknown>): Omit<LayoutRow, "uploaderName" | "votedByMe"> {
  return {
    id: r.id as string,
    clanId: r.clan_id as string,
    uploadedBy: r.uploaded_by as string,
    thLevel: r.th_level as number,
    layoutType: r.layout_type as LayoutType,
    copyLink: r.copy_link as string,
    imageUrl: (r.image_url as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    votes: (r.votes as number | null) ?? 0,
    createdAt: r.created_at as string,
  };
}

/**
 * The library for one clan, filtered and ranked.
 *
 * Ordered by votes then recency. `.limit()` precedes `.order()` because the
 * PGlite stand-in runs the query on `.order()` — legal in supabase-js too, and
 * the note in test/pglite-supabase.ts explains why it has to be this way round.
 *
 * The uploader's name and the caller's own votes are resolved in two extra
 * queries rather than an embedded select, because nothing else in this codebase
 * uses embedded selects and the test harness cannot run them.
 */
export async function layoutsForClan(
  supabase: SupabaseClient,
  clanId: string,
  userId: string,
  filter: LayoutFilter = {},
  limit = 200,
): Promise<LayoutRow[]> {
  const query = supabase
    .from("base_layouts")
    .select(
      "id, clan_id, uploaded_by, th_level, layout_type, copy_link, image_url, description, votes, created_at",
    )
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null);

  // Applied in the query rather than filtered afterwards, so a clan with two
  // hundred layouts does not read all of them to show nine.
  if (filter.thLevel) query.eq("th_level", filter.thLevel);
  if (filter.layoutType) query.eq("layout_type", filter.layoutType);

  const { data, error } = await query.limit(limit).order("votes", { ascending: false });
  if (error || !data) return [];

  const base = (data as Array<Record<string, unknown>>).map(toRow);
  if (base.length === 0) return [];

  const [names, mine] = await Promise.all([
    uploaderNames(supabase, base.map((b) => b.uploadedBy)),
    myVotes(supabase, base.map((b) => b.id), userId),
  ]);

  return base.map((b) => ({
    ...b,
    uploaderName: names.get(b.uploadedBy) ?? null,
    votedByMe: mine.has(b.id),
  }));
}

/**
 * Display names for uploaders, via their linked player.
 *
 * users has no name of its own — an account is an email address until it is
 * linked to a game account (T3.3) — so the name comes from players.user_id.
 * A member who has not verified yet shows as null and the page says "a member",
 * which is honest rather than printing an email address into a shared library.
 */
async function uploaderNames(
  supabase: SupabaseClient,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds)];
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from("players")
    .select("user_id, name")
    .in("user_id", unique)
    .is("deleted_at", null);

  if (error || !data) return new Map();

  const names = new Map<string, string>();
  for (const row of data as Array<{ user_id: string | null; name: string }>) {
    if (row.user_id && !names.has(row.user_id)) names.set(row.user_id, row.name);
  }
  return names;
}

/** Which of these layouts the caller has a live vote on. */
async function myVotes(
  supabase: SupabaseClient,
  layoutIds: readonly string[],
  userId: string,
): Promise<Set<string>> {
  if (layoutIds.length === 0) return new Set();

  const { data, error } = await supabase
    .from("base_layout_votes")
    .select("layout_id")
    .in("layout_id", [...layoutIds])
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error || !data) return new Set();
  return new Set((data as Array<{ layout_id: string }>).map((r) => r.layout_id));
}

export interface NewLayout {
  clanId: string;
  uploadedBy: string;
  thLevel: number;
  layoutType: LayoutType;
  copyLink: string;
  imageUrl: string | null;
  description: string | null;
}

/** Insert one layout. Returns its id, so the caller can name the image after it. */
export async function addLayout(
  supabase: SupabaseClient,
  layout: NewLayout,
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase
    .from("base_layouts")
    .insert({
      clan_id: layout.clanId,
      uploaded_by: layout.uploadedBy,
      th_level: layout.thLevel,
      layout_type: layout.layoutType,
      copy_link: layout.copyLink,
      image_url: layout.imageUrl,
      description: layout.description,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  return { id: (data as { id: string }).id };
}

/** Soft delete (R4). The policy allows the uploader or the clan's leadership. */
export async function removeLayout(
  supabase: SupabaseClient,
  clanId: string,
  layoutId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("base_layouts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", layoutId)
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null);

  return error ? { error: error.message } : {};
}

/**
 * Vote and unvote, through 028's definer functions.
 *
 * Never a direct write: the counter on base_layouts and the row in
 * base_layout_votes have to move together, and the functions are what guarantee
 * that. authenticated has no insert grant on the votes table precisely so this
 * is the only available path.
 */
export async function voteForLayout(
  supabase: SupabaseClient,
  layoutId: string,
): Promise<{ votes?: number; error?: string }> {
  const { data, error } = await supabase.rpc("vote_for_layout", { p_layout: layoutId });
  if (error) return { error: error.message };
  return { votes: data as number };
}

export async function unvoteLayout(
  supabase: SupabaseClient,
  layoutId: string,
): Promise<{ votes?: number; error?: string }> {
  const { data, error } = await supabase.rpc("unvote_layout", { p_layout: layoutId });
  if (error) return { error: error.message };
  return { votes: data as number };
}
