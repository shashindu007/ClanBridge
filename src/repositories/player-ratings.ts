// The stored Player rating, as /rating shows it. Thin wrappers over 073's two
// definer functions, in the shape repositories/family.ts uses for 038.
//
// R3 — THESE CROSS A CLAN BOUNDARY BY DESIGN, like family.ts. The widening is the
// function, not a policy: player_ratings keeps a clan-scoped SELECT policy, and
// what comes back here is the whole permission. Zero rows, not an error, is how
// a caller with no clan role is refused.

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRead } from "@/lib/errors";
import type { RatingKind } from "@/lib/rating";

export interface RatedPlayer {
  playerId: string;
  clanId: string;
  clanTag: string;
  clanName: string;
  tag: string;
  name: string;
  thLevel: number | null;
  marks: Record<RatingKind, number>;
  shares: Record<RatingKind, number>;
  rating: number;
  computedAt: string;
}

/** Every month with a stored ranking, newest first. */
export async function ratingMonths(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.rpc("family_rating_months");
  assertRead(error, "family_rating_months");
  return ((data ?? []) as Array<{ month: string }>).map((r) => r.month);
}

/** One month's ranking from the newest run, best first. */
export async function familyRatings(
  supabase: SupabaseClient,
  month: string,
): Promise<RatedPlayer[]> {
  const { data, error } = await supabase.rpc("family_player_ratings", { p_month: month });
  assertRead(error, "family_player_ratings");

  // numeric columns: PostgREST sends numbers, but a driver may send strings.
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    playerId: r.player_id as string,
    clanId: r.clan_id as string,
    clanTag: r.clan_tag as string,
    clanName: r.clan_name as string,
    tag: r.tag as string,
    name: r.name as string,
    thLevel: (r.th_level as number | null) ?? null,
    marks: {
      donations: Number(r.donation_marks),
      war: Number(r.war_marks),
      cwl: Number(r.cwl_marks),
      games: Number(r.games_marks),
      raids: Number(r.raid_marks),
    },
    shares: {
      donations: Number(r.donation_share),
      war: Number(r.war_share),
      cwl: Number(r.cwl_share),
      games: Number(r.games_share),
      raids: Number(r.raid_share),
    },
    rating: Number(r.rating),
    computedAt: r.computed_at as string,
  }));
}
