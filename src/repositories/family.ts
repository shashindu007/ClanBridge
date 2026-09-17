// The family directory — every platform clan's overview and roster.
//
// Thin wrappers over 038's two definer functions, in the shape
// repositories/cwl.ts uses for family_cwl_history(): an RPC call, a camelCase
// mapping, and cache() so a page and the layout that wraps it pay once.
//
// R3 — THESE ARE THE ONLY TWO READS IN THE APPLICATION THAT CROSS A CLAN
// BOUNDARY BY DESIGN, alongside familyCwlHistory() and clanMovement(). Every
// other query in this codebase carries an explicit clan filter with RLS as the
// net. Here the widening IS the function: `clans` and `players` keep their own
// clan-scoped policies untouched, so a direct select still returns one clan's
// rows and nothing here can be reached by joining up from somewhere else.
//
// WHAT THEY RETURN IS THE WHOLE PERMISSION. There is no role check in this file
// and there must never be one — 038 answers a caller holding a role in any
// platform clan, and refuses everybody else with zero rows. The tier a viewer
// gets INSIDE a clan is decided by src/lib/visibility.ts over what comes back.

import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import type { ClanRole } from "@/types/domain";

/** One platform clan, as the directory and a visitor's overview show it. */
export interface FamilyClanRow {
  id: string;
  tag: string;
  name: string;
  badgeUrl: string | null;
  level: number | null;
  warLeague: string | null;
  /** What the game reports, which may lead what we hold. See currentMemberCount(). */
  memberCount: number | null;
}

/** One village on a roster. Deliberately six columns — see 038's header. */
export interface FamilyRosterRow {
  clanId: string;
  playerId: string;
  tag: string;
  name: string;
  thLevel: number | null;
  clanRole: ClanRole | null;
  leftAt: string | null;
}

/**
 * Every clan on the platform, ordered by tag.
 *
 * Returns [] rather than throwing when the caller holds no clan role anywhere —
 * which is what 038 does, and what every read in this schema does to say no. A
 * page rendering an empty family is the correct outcome for an account that has
 * not been approved into one.
 *
 * cache()d per request for the reason visibleClans() is: the shell needs it to
 * decide which tabs to draw, and the page being navigated to resolves its own
 * tag through it.
 */
export const familyClans = cache(async function familyClans(
  supabase: SupabaseClient,
): Promise<FamilyClanRow[]> {
  const { data, error } = await supabase.rpc("family_clans");
  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((c) => ({
    id: c.id as string,
    tag: c.tag as string,
    name: c.name as string,
    badgeUrl: (c.badge_url as string | null) ?? null,
    level: (c.level as number | null) ?? null,
    warLeague: (c.war_league as string | null) ?? null,
    memberCount: (c.member_count as number | null) ?? null,
  }));
});

/**
 * The rosters of the named clans, optionally filtered.
 *
 * `clanIds` MUST come from familyClans(), never from tags written down — the
 * same rule visibleClans() carries, for the same reason (T3.7). The function
 * itself has no "every clan" spelling, so a caller that forgets gets nothing
 * rather than everything.
 *
 * `term` matches a name by substring or a tag EXACTLY; 038 refuses a partial tag
 * so the search cannot be walked to enumerate the family's tags. Passing null
 * returns the whole roster, which is what the member directory wants.
 *
 * Not cache()d: the term and the departed flag are part of the question, and a
 * memo keyed on three arguments where two are usually distinct buys nothing.
 */
export async function familyClanRoster(
  supabase: SupabaseClient,
  clanIds: readonly string[],
  term: string | null = null,
  includeDeparted = false,
): Promise<FamilyRosterRow[]> {
  const ids = [...new Set(clanIds)];
  if (!ids.length) return [];

  const { data, error } = await supabase.rpc("family_clan_roster", {
    p_clan_ids: ids,
    p_term: term && term.trim() ? term.trim() : null,
    p_include_departed: includeDeparted,
  });
  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((r) => ({
    clanId: r.clan_id as string,
    playerId: r.player_id as string,
    tag: r.tag as string,
    name: r.name as string,
    thLevel: (r.th_level as number | null) ?? null,
    clanRole: (r.clan_role as ClanRole | null) ?? null,
    leftAt: (r.left_at as string | null) ?? null,
  }));
}
