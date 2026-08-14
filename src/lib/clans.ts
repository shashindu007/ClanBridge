// The clans a signed-in user may see, with their role in each.
//
// R3 — this is the ONLY way the application should learn which clans a user has.
// It is derived from that user's clan_roles rows, never from a list of three clan
// tags written down somewhere. A hardcoded list is how a leader of clan A ends up
// holding a working link into clan B, which is exactly what T3.7 tests for.
//
// RLS enforces the same restriction underneath ("read own clans", 006), so a bug
// here fails closed. That is the safety net, not the mechanism.

import type { SupabaseClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { cache } from "react";
import { clanRoles, currentUserId } from "@/lib/auth";
import { decodeTag, InvalidTagError } from "@/lib/tags";
import type { ClanRole } from "@/types/domain";

export interface VisibleClan {
  id: string;
  tag: string;
  name: string;
  badgeUrl: string | null;
  role: ClanRole;
}

/**
 * Every clan the user belongs to, ordered by tag so the switcher is stable.
 *
 * T10.9 — cached per request, because this is the most duplicated pair of
 * queries in the product. (app)/layout.tsx calls it to build the clan switcher
 * on every navigation, and then the page being navigated to calls
 * requireClanByTag(), which calls it again for the same two queries and the same
 * answer. /report and /roster call it a third time in their own filters.
 */
export const visibleClans = cache(async function visibleClans(
  supabase: SupabaseClient,
  userId: string,
): Promise<VisibleClan[]> {
  const roles = await clanRoles(supabase, userId);
  if (roles.size === 0) return [];

  const { data, error } = await supabase
    .from("clans")
    .select("id, tag, name, badge_url")
    .in("id", [...roles.keys()])
    .is("deleted_at", null)
    .order("tag");

  if (error || !data) return [];

  return (data as Array<{ id: string; tag: string; name: string; badge_url: string | null }>)
    .map((c) => ({
      id: c.id,
      tag: c.tag,
      name: c.name,
      badgeUrl: c.badge_url,
      // Non-null by construction: the id came from the roles map's own keys.
      role: roles.get(c.id) as ClanRole,
    }));
});

/**
 * Resolve a `[clanTag]` route segment to a clan the signed-in user may actually see.
 *
 * Every page under /[clanTag] needs this and none of the existing helpers do it:
 * `requireRole` takes a clan UUID, not a tag, and the layout only builds nav
 * links. Without one shared resolver each page would hand-roll the same five
 * lines, and the first one written in a hurry is the hole T3.7 exists to find.
 *
 * It fails closed twice over. A tag that is not in `visibleClans()` is a 404 —
 * NOT a 403 — because the candidate list is already restricted to the caller's
 * own clans, so "you may not see this" and "there is no such clan" are the same
 * answer and the distinction would leak which tags are real. RLS enforces the
 * same restriction underneath, as the net rather than the mechanism.
 *
 * Callers get the clan's UUID and the caller's role in it, which is everything
 * a page needs to query by clan (R3) and to decide what to show leadership.
 */
export async function requireClanByTag(
  supabase: SupabaseClient,
  segment: string,
): Promise<VisibleClan> {
  const userId = await currentUserId(supabase);
  if (!userId) notFound();

  let tag: string;
  try {
    // Links are built with encodeURIComponent, so segments arrive as %232PP0JCCL.
    tag = decodeTag(segment);
  } catch (error) {
    // A malformed segment is a bad URL, not a server error.
    if (error instanceof InvalidTagError) notFound();
    throw error;
  }

  const clan = (await visibleClans(supabase, userId)).find((c) => c.tag === tag);
  if (!clan) notFound();
  return clan;
}
