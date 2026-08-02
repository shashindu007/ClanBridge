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
import { clanRoles } from "@/lib/auth";
import type { ClanRole } from "@/types/domain";

export interface VisibleClan {
  id: string;
  tag: string;
  name: string;
  badgeUrl: string | null;
  role: ClanRole;
}

/** Every clan the user belongs to, ordered by tag so the switcher is stable. */
export async function visibleClans(
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
}
