// T3B.1 — what the dashboard reads.
//
// Distinct from lib/clans.ts, and the split is worth stating because the names
// are nearly identical. lib/clans.ts answers "may this user see this clan?" and
// is part of the authorisation path — visibleClans() and requireClanByTag() both
// derive from clan_roles. This file answers "what is in this clan?" and assumes
// that question has already been settled.
//
// So every function here takes a clanId that requireClanByTag() has already
// vetted. None of them re-checks membership, and none of them should: a second,
// differently-worded copy of the same rule is how the two drift apart.
//
// R3 — every query filters by clan regardless. RLS is the net, the filter is the
// mechanism.

import type { SupabaseClient } from "@supabase/supabase-js";

/** The columns migration 020 added, plus the ones the switcher already had. */
export interface ClanDetail {
  level: number | null;
  warLeague: string | null;
  memberCount: number | null;
  isWarLogPublic: boolean | null;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  authorId: string | null;
}

/**
 * The clan's synced detail, or null if it has never been synced.
 *
 * Null is a real state, not a failure: a leader adds a clan at /admin and the
 * row exists immediately, but every column here stays null until sync:clans next
 * runs. The dashboard says so rather than rendering four blanks.
 */
export async function clanDetail(
  supabase: SupabaseClient,
  clanId: string,
): Promise<ClanDetail | null> {
  const { data, error } = await supabase
    .from("clans")
    .select("level, war_league, member_count, is_war_log_public")
    .eq("id", clanId) // R3
    .is("deleted_at", null);

  if (error || !data) return null;

  const row = (data as Array<Record<string, unknown>>)[0];
  if (!row) return null;

  return {
    level: (row.level as number | null) ?? null,
    warLeague: (row.war_league as string | null) ?? null,
    memberCount: (row.member_count as number | null) ?? null,
    isWarLogPublic: (row.is_war_log_public as boolean | null) ?? null,
  };
}

/**
 * How many players we currently hold for this clan.
 *
 * Deliberately NOT the same number as ClanDetail.memberCount, and the dashboard
 * shows both when they disagree. memberCount is what the API said at the last
 * sync; this is how many rows we have. A gap means either the sync is behind, or
 * a player left and T3.9 has not set left_at yet — both worth seeing, and
 * invisible if the page picks one number and hides the other.
 */
export async function currentMemberCount(
  supabase: SupabaseClient,
  clanId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("players")
    .select("id")
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .is("left_at", null);

  if (error || !data) return 0;
  return (data as unknown[]).length;
}

/**
 * The most recent announcement, pinned ones first.
 *
 * Nothing writes to this table until T5.1, so null is the expected answer today.
 * It is read anyway because the row shape is settled (004_features.sql) and
 * wiring it now means T5.1 is a form, not a form plus a dashboard change.
 */
export async function latestAnnouncement(
  supabase: SupabaseClient,
  clanId: string,
): Promise<Announcement | null> {
  // Pinned wins over recent, which announcementsForClan() already applies.
  return (await announcementsForClan(supabase, clanId))[0] ?? null;
}

/**
 * T5.1 — every live announcement for one clan, pinned first then newest.
 *
 * Soft-deleted rows are filtered rather than absent (R4): a removed notice is
 * still in the table, and T9.6 can still say who removed it and when.
 *
 * The two-key ordering is done here rather than in the query. PostgREST can
 * express it, but the PGlite stand-in orders on one column, and this list is a
 * handful of rows — paying a round trip to avoid four lines of TypeScript would
 * be the wrong trade.
 */
export async function announcementsForClan(
  supabase: SupabaseClient,
  clanId: string,
): Promise<Announcement[]> {
  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, body, pinned, created_at, author_id")
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error || !data) return [];

  const rows = (data as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    body: row.body as string,
    pinned: row.pinned === true,
    createdAt: row.created_at as string,
    authorId: (row.author_id as string | null) ?? null,
  }));

  return rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
