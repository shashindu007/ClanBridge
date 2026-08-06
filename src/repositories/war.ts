// T6.3-T6.10 — clan war reads and writes.
//
// ─────────────────────────────────────────────────────────────────────────────
// FOUR TABLES, AND KEEPING THEM APART IS THE WHOLE MODULE (R11, R12)
//
//   war_lineup_members   who the LEADER PICKED       human decision
//   war_members          who the API SAYS PLAYED     game fact
//   war_targets          who was TOLD TO ATTACK what human decision
//   war_attacks          who ACTUALLY ATTACKED what  game fact
//
// Each pair is a plan beside an outcome, and the gap between them is the report
// (T6.5, T6.9, T6.10). Nothing in this file merges a pair to "avoid duplication"
// — that is the single change that would destroy the only thing the war module
// produces which a WhatsApp group could not.
//
// The two game-fact tables are written by scripts/sync/war.ts and never here.
// The two human ones are written here and never by a sync job; migration 024
// revokes the grants so the boundary is enforced rather than promised.
// ─────────────────────────────────────────────────────────────────────────────
//
// R3 — `wars` carries clan_id directly, so the filter is a plain
// .eq("clan_id", clanId) rather than the resolve-the-parent chain
// repositories/cwl.ts needs. Children (war_members, war_attacks, war_targets)
// have no clan_id at all: they are reached by a war id that has ALREADY been
// resolved under an explicit clan filter. Handing one of these functions a war
// id from another clan cannot happen through a page, because the page got its
// id from warById() or currentWar() — and RLS denies it regardless, as the net
// rather than the mechanism.

import type { SupabaseClient } from "@supabase/supabase-js";

export type WarStateRow = "preparation" | "inWar" | "warEnded";
export type LineupStatus = "draft" | "published";

export interface WarRow {
  id: string;
  clanId: string;
  opponentTag: string | null;
  opponentName: string | null;
  teamSize: number | null;
  state: WarStateRow | null;
  ourStars: number | null;
  theirStars: number | null;
  ourDestruction: number | null;
  theirDestruction: number | null;
  result: string | null;
  startTime: string;
  endTime: string | null;
}

export interface WarMemberRow {
  playerId: string;
  tag: string;
  name: string;
  mapPosition: number | null;
  thLevel: number | null;
  /** Two in a regular war, but read from the row — see 024's note on the column. */
  attacksAllowed: number;
}

export interface WarAttackRow {
  playerId: string;
  attackOrder: number;
  stars: number;
  destruction: number;
  defenderTag: string | null;
  defenderPosition: number | null;
}

export interface WarTargetRow {
  playerId: string;
  targetPosition: number;
  note: string | null;
  assignedBy: string | null;
  assignedAt: string;
}

export interface Lineup {
  id: string;
  clanId: string;
  plannedFor: string;
  size: number;
  status: LineupStatus;
  warId: string | null;
  createdBy: string;
  publishedAt: string | null;
  createdAt: string;
}

export interface LineupMember {
  lineupId: string;
  playerId: string;
  position: number | null;
  addedAt: string;
  tag: string;
  name: string;
  thLevel: number | null;
}

const WAR_COLUMNS =
  "id, clan_id, opponent_tag, opponent_name, team_size, state, our_stars, " +
  "their_stars, our_destruction, their_destruction, result, start_time, end_time";

const LINEUP_COLUMNS =
  "id, clan_id, planned_for, size, status, war_id, created_by, published_at, created_at";

function toWar(r: Record<string, unknown>): WarRow {
  return {
    id: r.id as string,
    clanId: r.clan_id as string,
    opponentTag: (r.opponent_tag as string | null) ?? null,
    opponentName: (r.opponent_name as string | null) ?? null,
    teamSize: (r.team_size as number | null) ?? null,
    state: (r.state as WarStateRow | null) ?? null,
    ourStars: (r.our_stars as number | null) ?? null,
    theirStars: (r.their_stars as number | null) ?? null,
    // numeric(5,2) arrives as a string from node-postgres, so every consumer
    // would otherwise be comparing "87.40" to a number and quietly failing.
    ourDestruction: r.our_destruction === null ? null : Number(r.our_destruction),
    theirDestruction: r.their_destruction === null ? null : Number(r.their_destruction),
    result: (r.result as string | null) ?? null,
    startTime: String(r.start_time),
    endTime: r.end_time === null || r.end_time === undefined ? null : String(r.end_time),
  };
}

function toLineup(r: Record<string, unknown>): Lineup {
  return {
    id: r.id as string,
    clanId: r.clan_id as string,
    plannedFor: String(r.planned_for),
    size: r.size as number,
    status: r.status as LineupStatus,
    warId: (r.war_id as string | null) ?? null,
    createdBy: r.created_by as string,
    publishedAt:
      r.published_at === null || r.published_at === undefined ? null : String(r.published_at),
    createdAt: String(r.created_at),
  };
}

// ---------------------------------------------------------------------------
// Wars
// ---------------------------------------------------------------------------

/**
 * This clan's wars, newest first. T6.6's history, and the source of "current".
 *
 * `limit` before `order` — supabase-js accepts either, and the PGlite stand-in
 * runs the query on `.order()`, so anything chained after it is silently lost.
 */
export async function warsForClan(
  supabase: SupabaseClient,
  clanId: string,
  limit = 50,
): Promise<WarRow[]> {
  const { data, error } = await supabase
    .from("wars")
    .select(WAR_COLUMNS)
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .limit(limit)
    .order("start_time", { ascending: false });

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map(toWar);
}

/**
 * The war to show on the board when nobody asked for a particular one.
 *
 * The most recent by start time, whatever its state — NOT "the one that is not
 * warEnded". A war stays interesting for a day or two after it ends: the missed
 * attacks are chased afterwards, and that is the conversation the board exists
 * to support. Preferring a live war over a finished one is handled by ordering,
 * because a live war is always the most recent.
 */
export async function currentWar(
  supabase: SupabaseClient,
  clanId: string,
): Promise<WarRow | null> {
  return (await warsForClan(supabase, clanId, 1))[0] ?? null;
}

/**
 * One war, resolved under an explicit clan filter.
 *
 * The filter is the point: every child read below takes a bare war id, and this
 * is where that id is proven to belong to the caller's clan. A war id typed into
 * the URL from another clan returns null here and never reaches them.
 */
export async function warById(
  supabase: SupabaseClient,
  clanId: string,
  warId: string,
): Promise<WarRow | null> {
  const { data, error } = await supabase
    .from("wars")
    .select(WAR_COLUMNS)
    .eq("clan_id", clanId) // R3
    .eq("id", warId)
    .is("deleted_at", null);

  if (error || !data) return null;
  const rows = data as unknown as Array<Record<string, unknown>>;
  return rows.length ? toWar(rows[0]!) : null;
}

/**
 * id -> {tag, name, thLevel}. Two queries rather than a PostgREST embed, for the
 * reason repositories/cwl.ts gives: the stand-in the tests run against cannot
 * parse embeds, and a war roster is at most 50 rows.
 */
async function playerDetails(
  supabase: SupabaseClient,
  playerIds: string[],
): Promise<Map<string, { tag: string; name: string; thLevel: number | null }>> {
  if (!playerIds.length) return new Map();

  const { data, error } = await supabase
    .from("players")
    .select("id, tag, name, th_level")
    .in("id", [...new Set(playerIds)]);

  if (error || !data) return new Map();
  return new Map(
    (data as unknown as Array<Record<string, unknown>>).map((p) => [
      p.id as string,
      {
        tag: (p.tag as string) ?? "",
        name: (p.name as string) ?? "Unknown player",
        thLevel: (p.th_level as number | null) ?? null,
      },
    ]),
  );
}

/** The API's roster — the denominator every "who did not attack" answer needs. */
export async function membersOfWar(
  supabase: SupabaseClient,
  warId: string,
): Promise<WarMemberRow[]> {
  const { data, error } = await supabase
    .from("war_members")
    .select("player_id, map_position, th_level, attacks_allowed")
    .eq("war_id", warId)
    .is("deleted_at", null)
    .order("map_position");

  if (error || !data) return [];
  const rows = data as unknown as Array<Record<string, unknown>>;
  if (!rows.length) return [];

  const details = await playerDetails(
    supabase,
    rows.map((r) => r.player_id as string),
  );

  return rows.map((r) => {
    const p = details.get(r.player_id as string);
    return {
      playerId: r.player_id as string,
      tag: p?.tag ?? "",
      name: p?.name ?? "Unknown player",
      mapPosition: (r.map_position as number | null) ?? null,
      // th_level on the war row, not the player row: it is what they were at the
      // time of THIS war, which is the number the report should show.
      thLevel: (r.th_level as number | null) ?? p?.thLevel ?? null,
      attacksAllowed: (r.attacks_allowed as number | null) ?? 2,
    };
  });
}

/** What happened. A player who did not attack has no row here, by design. */
export async function attacksForWar(
  supabase: SupabaseClient,
  warId: string,
): Promise<WarAttackRow[]> {
  const { data, error } = await supabase
    .from("war_attacks")
    .select("player_id, attack_order, stars, destruction, defender_tag, defender_position")
    .eq("war_id", warId)
    .is("deleted_at", null)
    .order("attack_order");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    playerId: r.player_id as string,
    attackOrder: r.attack_order as number,
    stars: r.stars as number,
    destruction: Number(r.destruction),
    defenderTag: (r.defender_tag as string | null) ?? null,
    defenderPosition: (r.defender_position as number | null) ?? null,
  }));
}

/** The plan. Never merged into the attacks above (R12). */
export async function targetsForWar(
  supabase: SupabaseClient,
  warId: string,
): Promise<WarTargetRow[]> {
  const { data, error } = await supabase
    .from("war_targets")
    .select("player_id, target_position, note, assigned_by, assigned_at")
    .eq("war_id", warId)
    .is("deleted_at", null)
    .order("target_position");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    playerId: r.player_id as string,
    targetPosition: r.target_position as number,
    note: (r.note as string | null) ?? null,
    assignedBy: (r.assigned_by as string | null) ?? null,
    assignedAt: String(r.assigned_at),
  }));
}

// ---------------------------------------------------------------------------
// T6.4 — target writes, all four through definer functions.
//
// Same shape as awardBonus/withdrawBonus in ./rosters.ts, INCLUDING the
// `data === false` check. These functions return false rather than raising when
// they decline, so a caller that only inspects `error` reports success on a
// write that did not happen.
// ---------------------------------------------------------------------------

async function callRpc(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<{ error?: string }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: error.message };
  if (data === false) return { error: "not permitted" };
  return {};
}

/** Leadership assigns. The function's own message is surfaced verbatim. */
export function assignTarget(
  supabase: SupabaseClient,
  warId: string,
  playerId: string,
  position: number,
  note: string | null,
): Promise<{ error?: string }> {
  return callRpc(supabase, "assign_war_target", {
    p_war: warId,
    p_player: playerId,
    p_position: position,
    p_note: note,
  });
}

/** Leadership withdraws. Soft delete inside the function (R4). */
export function clearTarget(
  supabase: SupabaseClient,
  warId: string,
  playerId: string,
): Promise<{ error?: string }> {
  return callRpc(supabase, "clear_war_target", { p_war: warId, p_player: playerId });
}

/**
 * A member claims a free base for themselves (025).
 *
 * No playerId argument, and that is not an omission: the function resolves the
 * player from auth.uid(), so there is no parameter through which to claim on
 * somebody else's behalf.
 */
export function claimTarget(
  supabase: SupabaseClient,
  warId: string,
  position: number,
  note: string | null = null,
): Promise<{ error?: string }> {
  return callRpc(supabase, "claim_war_target", {
    p_war: warId,
    p_position: position,
    p_note: note,
  });
}

/** A member gives back a base they claimed. Not one leadership assigned them. */
export function releaseTarget(
  supabase: SupabaseClient,
  warId: string,
): Promise<{ error?: string }> {
  return callRpc(supabase, "release_war_target", { p_war: warId });
}

// ---------------------------------------------------------------------------
// T6.8 — lineups. The one thing the API can never tell you.
// ---------------------------------------------------------------------------

/**
 * This clan's lineups, newest first.
 *
 * A member sees only published ones and a leader sees drafts too — enforced by
 * the policy in 024, not by a filter here. Worth stating because the absence of
 * a `status` filter below looks like an oversight and is the opposite: adding
 * one would hide drafts from the leader who is building them.
 */
export async function lineupsForClan(
  supabase: SupabaseClient,
  clanId: string,
  limit = 20,
): Promise<Lineup[]> {
  const { data, error } = await supabase
    .from("war_lineups")
    .select(LINEUP_COLUMNS)
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .limit(limit)
    .order("planned_for", { ascending: false });

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map(toLineup);
}

/** One lineup, resolved under an explicit clan filter for the same reason warById is. */
export async function lineupById(
  supabase: SupabaseClient,
  clanId: string,
  lineupId: string,
): Promise<Lineup | null> {
  const { data, error } = await supabase
    .from("war_lineups")
    .select(LINEUP_COLUMNS)
    .eq("clan_id", clanId) // R3
    .eq("id", lineupId)
    .is("deleted_at", null);

  if (error || !data) return null;
  const rows = data as unknown as Array<Record<string, unknown>>;
  return rows.length ? toLineup(rows[0]!) : null;
}

export async function membersOfLineup(
  supabase: SupabaseClient,
  lineupId: string,
): Promise<LineupMember[]> {
  const { data, error } = await supabase
    .from("war_lineup_members")
    .select("lineup_id, player_id, position, added_at")
    .eq("lineup_id", lineupId)
    .is("deleted_at", null)
    .order("position");

  if (error || !data) return [];
  const rows = data as unknown as Array<Record<string, unknown>>;
  if (!rows.length) return [];

  const details = await playerDetails(
    supabase,
    rows.map((r) => r.player_id as string),
  );

  return rows.map((r) => {
    const p = details.get(r.player_id as string);
    return {
      lineupId: r.lineup_id as string,
      playerId: r.player_id as string,
      position: (r.position as number | null) ?? null,
      addedAt: String(r.added_at),
      tag: p?.tag ?? "",
      name: p?.name ?? "Unknown player",
      thLevel: p?.thLevel ?? null,
    };
  });
}

/** Start a draft. Saved immediately, so the leader can come back to it. */
export async function createLineup(
  supabase: SupabaseClient,
  clanId: string,
  size: number,
  createdBy: string,
  plannedFor?: string,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await supabase
    .from("war_lineups")
    .insert({
      clan_id: clanId,
      size,
      created_by: createdBy,
      status: "draft",
      ...(plannedFor ? { planned_for: plannedFor } : {}),
    })
    .select()
    .single();

  if (error || !data) return { error: error?.message ?? "could not start the lineup" };
  return { id: (data as { id: string }).id };
}

/**
 * Add a player to a lineup.
 *
 * Un-drop rather than insert a second row, exactly as addToRoster does: someone
 * cut and then restored keeps one row and one history (R4), and the unique
 * (lineup_id, player_id) would reject the second insert anyway.
 */
export async function addToLineup(
  supabase: SupabaseClient,
  lineupId: string,
  playerId: string,
  addedBy: string,
): Promise<{ error?: string }> {
  const { data: existing } = await supabase
    .from("war_lineup_members")
    .select("id")
    .eq("lineup_id", lineupId)
    .eq("player_id", playerId);

  if ((existing as unknown as unknown[] | null)?.length) {
    const { error } = await supabase
      .from("war_lineup_members")
      .update({ deleted_at: null })
      .eq("lineup_id", lineupId)
      .eq("player_id", playerId);
    return error ? { error: error.message } : {};
  }

  const { error } = await supabase
    .from("war_lineup_members")
    .insert({ lineup_id: lineupId, player_id: playerId, added_by: addedBy });

  return error ? { error: error.message } : {};
}

/** Drop a player. Soft delete (R4) — members ask when they were cut. */
export async function removeFromLineup(
  supabase: SupabaseClient,
  lineupId: string,
  playerId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("war_lineup_members")
    .update({ deleted_at: new Date().toISOString() })
    .eq("lineup_id", lineupId)
    .eq("player_id", playerId);

  return error ? { error: error.message } : {};
}

/** Draft becomes published, and members can finally see it. */
export async function publishLineup(
  supabase: SupabaseClient,
  lineupId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("war_lineups")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", lineupId);

  return error ? { error: error.message } : {};
}

/** Back to draft, so a published lineup can be corrected before war is declared. */
export async function unpublishLineup(
  supabase: SupabaseClient,
  lineupId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("war_lineups")
    .update({ status: "draft" })
    .eq("id", lineupId);

  return error ? { error: error.message } : {};
}

/**
 * Point a lineup at the war that eventually appeared. THIS IS WHAT MAKES T6.10
 * POSSIBLE.
 *
 * A lineup is decided before the war exists — that is the entire reason 024
 * hangs it off (clan_id, planned_for) rather than a war id. Until someone says
 * "this plan was for that war", the plan and the outcome are two unrelated
 * lists, and "picked but did not play" cannot be computed from them.
 */
export async function attachLineupToWar(
  supabase: SupabaseClient,
  lineupId: string,
  warId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("war_lineups")
    .update({ war_id: warId })
    .eq("id", lineupId);

  return error ? { error: error.message } : {};
}

/** The lineup a war was fought with, if anyone linked one. T6.10's left-hand side. */
export async function lineupForWar(
  supabase: SupabaseClient,
  clanId: string,
  warId: string,
): Promise<Lineup | null> {
  const { data, error } = await supabase
    .from("war_lineups")
    .select(LINEUP_COLUMNS)
    .eq("clan_id", clanId) // R3
    .eq("war_id", warId)
    .is("deleted_at", null);

  if (error || !data) return null;
  const rows = data as unknown as Array<Record<string, unknown>>;
  return rows.length ? toLineup(rows[0]!) : null;
}
