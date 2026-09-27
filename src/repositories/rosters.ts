// T4B.6-T4B.14 — the leader's CWL selection.
//
// R12 — THIS IS THE PLAN. cwl_war_members (019) is the OUTCOME: who the API said
// actually played. Both are kept and neither overwrites the other; the gap
// between them is the report at T4B.11, and it is the most useful thing this
// system produces.
//
// R11 — human decision data. No sync job may import this file.

import type { SupabaseClient } from "@supabase/supabase-js";

export type RosterStatus = "draft" | "published";

export interface Roster {
  id: string;
  season: string;
  clanId: string;
  status: RosterStatus;
  slotCount: number;
  createdBy: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface RosterMember {
  id: string;
  rosterId: string;
  playerId: string;
  position: number | null;
  addedAt: string;
  tag: string;
  name: string;
  thLevel: number | null;
}

const ROSTER_COLUMNS =
  "id, season, clan_id, status, slot_count, created_by, published_at, created_at";

function toRoster(r: Record<string, unknown>): Roster {
  return {
    id: r.id as string,
    season: r.season as string,
    clanId: r.clan_id as string,
    status: r.status as RosterStatus,
    slotCount: (r.slot_count as number) ?? 15,
    createdBy: r.created_by as string,
    publishedAt: (r.published_at as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

/** One clan's roster for a season, draft or published. Null if never started. */
export async function rosterFor(
  supabase: SupabaseClient,
  clanId: string,
  season: string,
): Promise<Roster | null> {
  const { data, error } = await supabase
    .from("cwl_rosters")
    .select(ROSTER_COLUMNS)
    .eq("clan_id", clanId) // R3
    .eq("season", season)
    .is("deleted_at", null);

  if (error || !data?.length) return null;
  return toRoster((data as unknown as Array<Record<string, unknown>>)[0]!);
}

/**
 * Every roster for a season, across all clans the caller may see.
 *
 * This is the cross-clan view T4B.8 needs: the leader is assigning players into
 * three clans at once and has to see all three panels together. RLS restricts it
 * to clans they actually lead, so "all" means "all of theirs".
 */
export async function rostersForSeason(
  supabase: SupabaseClient,
  season: string,
): Promise<Roster[]> {
  const { data, error } = await supabase
    .from("cwl_rosters")
    .select(ROSTER_COLUMNS)
    .eq("season", season)
    .is("deleted_at", null);

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map(toRoster);
}

/** Every season that has a roster, newest first — T4B.14's history index. */
export async function rosterSeasons(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("cwl_rosters")
    .select("season")
    .is("deleted_at", null)
    .order("season");

  if (error || !data) return [];
  const seasons = new Set(
    (data as unknown as Array<{ season: string }>).map((r) => r.season),
  );
  return [...seasons].reverse();
}

/** The selected players, with names attached. */
export async function membersOfRoster(
  supabase: SupabaseClient,
  rosterId: string,
): Promise<RosterMember[]> {
  const { data, error } = await supabase
    .from("cwl_roster_members")
    .select("id, roster_id, player_id, position, added_at")
    .eq("roster_id", rosterId)
    .is("deleted_at", null)
    .order("position");

  if (error || !data) return [];
  const rows = data as unknown as Array<Record<string, unknown>>;
  if (!rows.length) return [];

  const ids = rows.map((r) => r.player_id as string);
  const { data: players } = await supabase
    .from("players")
    .select("id, tag, name, th_level")
    .in("id", ids);

  const byId = new Map(
    ((players ?? []) as unknown as Array<Record<string, unknown>>).map((p) => [
      p.id as string,
      p,
    ]),
  );

  return rows.map((r) => {
    const p = byId.get(r.player_id as string);
    return {
      id: r.id as string,
      rosterId: r.roster_id as string,
      playerId: r.player_id as string,
      position: (r.position as number | null) ?? null,
      addedAt: r.added_at as string,
      tag: (p?.tag as string) ?? "",
      name: (p?.name as string) ?? "Unknown player",
      thLevel: (p?.th_level as number | null) ?? null,
    };
  });
}

/** Start a draft. Saved immediately so the leader can come back to it (T4B.8). */
export async function createRoster(
  supabase: SupabaseClient,
  clanId: string,
  season: string,
  slotCount: number,
  createdBy: string,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("cwl_rosters")
    .insert({
      clan_id: clanId,
      season,
      slot_count: slotCount,
      created_by: createdBy,
      status: "draft",
    })
    .select()
    .single();

  if (error || !data) return { error: error?.message ?? "could not start the roster" };
  return { id: (data as { id: string }).id };
}

/**
 * Add a player to a roster.
 *
 * The double-booking guard in 011 fires here as an exception, and its message
 * names the clan they are already in — so it is surfaced verbatim rather than
 * replaced with something generic. "Already in the Clan B roster" is actionable;
 * "constraint violation" sends the leader hunting through three rosters by hand.
 */
export async function addToRoster(
  supabase: SupabaseClient,
  rosterId: string,
  playerId: string,
  addedBy: string,
): Promise<{ error?: string }> {
  // Un-drop rather than insert a second row, so someone removed and re-added
  // keeps one row and one history (R4).
  const { data: existing } = await supabase
    .from("cwl_roster_members")
    .select("id")
    .eq("roster_id", rosterId)
    .eq("player_id", playerId);

  if ((existing as unknown as unknown[] | null)?.length) {
    const { error } = await supabase
      .from("cwl_roster_members")
      .update({ deleted_at: null })
      .eq("roster_id", rosterId)
      .eq("player_id", playerId);
    return error ? { error: error.message } : {};
  }

  const { error } = await supabase
    .from("cwl_roster_members")
    .insert({ roster_id: rosterId, player_id: playerId, added_by: addedBy });

  return error ? { error: error.message } : {};
}

/** Drop a player. Soft delete (R4) — members ask when they were dropped. */
export async function removeFromRoster(
  supabase: SupabaseClient,
  rosterId: string,
  playerId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("cwl_roster_members")
    .update({ deleted_at: new Date().toISOString() })
    .eq("roster_id", rosterId)
    .eq("player_id", playerId);

  return error ? { error: error.message } : {};
}

/** T4B.9 — draft becomes published, and members can finally see it. */
export async function publishRoster(
  supabase: SupabaseClient,
  rosterId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("cwl_rosters")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", rosterId);

  return error ? { error: error.message } : {};
}

/** Back to draft, so a published roster can be corrected before CWL starts. */
export async function unpublishRoster(
  supabase: SupabaseClient,
  rosterId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("cwl_rosters")
    .update({ status: "draft" })
    .eq("id", rosterId);

  return error ? { error: error.message } : {};
}

// Bonus medals are given by the clan leader IN GAME, and the game keeps the
// record. The site used to hold a second copy (bonusesForSeason / awardBonus /
// withdrawBonus over cwl_bonuses, 022); that was removed with the medals page
// redesign. The table and its functions stay in the database — nothing already
// recorded is lost — but nothing reads or writes them any more.
