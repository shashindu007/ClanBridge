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
  /** Null for wars that ended before migration 045. */
  opponentBadgeUrl: string | null;
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

/**
 * A base on the other side (026).
 *
 * No playerId, because there is no player: the opposition are not members of any
 * of the three clans and are deliberately kept out of `players` — see 026's
 * header for what putting them there would do to the member directory.
 */
export interface WarOpponentRow {
  tag: string;
  name: string | null;
  mapPosition: number | null;
  thLevel: number | null;
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
  "id, clan_id, opponent_tag, opponent_name, opponent_badge_url, team_size, state, our_stars, " +
  "their_stars, our_destruction, their_destruction, result, start_time, end_time";

const LINEUP_COLUMNS =
  "id, clan_id, planned_for, size, status, war_id, created_by, published_at, created_at";

function toWar(r: Record<string, unknown>): WarRow {
  return {
    id: r.id as string,
    clanId: r.clan_id as string,
    opponentTag: (r.opponent_tag as string | null) ?? null,
    opponentName: (r.opponent_name as string | null) ?? null,
    opponentBadgeUrl: (r.opponent_badge_url as string | null) ?? null,
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

/** The other side's lineup — what a base number actually means (T6.3, T6.4). */
export async function opponentsOfWar(
  supabase: SupabaseClient,
  warId: string,
): Promise<WarOpponentRow[]> {
  const { data, error } = await supabase
    .from("war_opponent_members")
    .select("tag, name, map_position, th_level")
    .eq("war_id", warId)
    .is("deleted_at", null)
    .order("map_position");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    tag: r.tag as string,
    name: (r.name as string | null) ?? null,
    mapPosition: (r.map_position as number | null) ?? null,
    thLevel: (r.th_level as number | null) ?? null,
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
// Many wars at once.
//
// THE N+1 THIS REPLACES, AND WHY IT HID SO WELL. Three call sites — the player
// profile, /war/report, and the same report on a member's own base — each wanted
// the roster, the attacks and the targets for the last WAR_WINDOW wars. Each
// looped the wars and called the three singular functions above, wrapped in
// Promise.all so the round trips overlapped.
//
// That overlapping is exactly what made it look solved. The comment at the
// /war/report call site said so in as many words: "three waves regardless of N".
// It was three waves of LATENCY and 4N QUERIES — because membersOfWar() ends in
// its own playerDetails() lookup, so each war cost four, not three. At
// WAR_WINDOW = 10 that is forty queries to render one player's profile, every
// one of them a separate statement against a free-tier pooler with a small
// connection limit. Concurrency does not make forty queries into four; it makes
// them arrive together and queue.
//
// This is the same bug T3B.5 found in the member directory, where fifty members
// were fifteen hundred queries "concurrent rather than few, all fetching
// identical rows". Same shape, one layer down, and the fix is the same: filter
// by `in (…)` once per table and group in memory.
//
// FOUR QUERIES, WHATEVER N IS. Three `in (war_id)` reads plus one playerDetails
// for every player across every war — which also de-duplicates the roster
// lookup, since the same people appear in war after war and were previously
// fetched once per war.
// ---------------------------------------------------------------------------

/** One war's three row sets, as the report services want them. */
export interface WarRosterRows {
  members: WarMemberRow[];
  attacks: WarAttackRow[];
  targets: WarTargetRow[];
}

/** Group rows by their `war_id`, preserving the order the query returned. */
function byWar<T>(
  rows: Array<Record<string, unknown>>,
  map: (row: Record<string, unknown>) => T,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const warId = row.war_id as string;
    const list = out.get(warId);
    if (list) list.push(map(row));
    else out.set(warId, [map(row)]);
  }
  return out;
}

/**
 * The roster, attacks and targets for several wars, in four queries.
 *
 * Returns a Map keyed by war id. A war with no rows is ABSENT rather than
 * present-and-empty, so callers read through `?? []` — which is also what keeps
 * a war that has been synced but not populated from looking like a war whose
 * members all failed to attack.
 *
 * Ordering within each war matches the singular functions: members by map
 * position, attacks by attack order, targets by target position. The sort is
 * done per group after grouping, because one `order()` across the whole result
 * does not survive being split by war.
 */
export async function warRostersFor(
  supabase: SupabaseClient,
  warIds: string[],
): Promise<Map<string, WarRosterRows>> {
  const ids = [...new Set(warIds)];
  if (!ids.length) return new Map();

  const [memberRes, attackRes, targetRes] = await Promise.all([
    supabase
      .from("war_members")
      .select("war_id, player_id, map_position, th_level, attacks_allowed")
      .in("war_id", ids)
      .is("deleted_at", null),
    supabase
      .from("war_attacks")
      .select(
        "war_id, player_id, attack_order, stars, destruction, defender_tag, defender_position",
      )
      .in("war_id", ids)
      .is("deleted_at", null),
    supabase
      .from("war_targets")
      .select("war_id, player_id, target_position, note, assigned_by, assigned_at")
      .in("war_id", ids)
      .is("deleted_at", null),
  ]);

  const memberRows = (memberRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const attackRows = (attackRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const targetRows = (targetRes.data ?? []) as unknown as Array<Record<string, unknown>>;

  // ONE lookup for every player in every war. The per-war version fetched the
  // same roster again for each war they appeared in.
  const details = await playerDetails(
    supabase,
    memberRows.map((r) => r.player_id as string),
  );

  const membersByWar = byWar(memberRows, (r) => {
    const p = details.get(r.player_id as string);
    return {
      playerId: r.player_id as string,
      tag: p?.tag ?? "",
      name: p?.name ?? "Unknown player",
      mapPosition: (r.map_position as number | null) ?? null,
      thLevel: (r.th_level as number | null) ?? p?.thLevel ?? null,
      attacksAllowed: (r.attacks_allowed as number | null) ?? 2,
    } satisfies WarMemberRow;
  });

  const attacksByWar = byWar(attackRows, (r) => ({
    playerId: r.player_id as string,
    attackOrder: r.attack_order as number,
    stars: r.stars as number,
    destruction: Number(r.destruction),
    defenderTag: (r.defender_tag as string | null) ?? null,
    defenderPosition: (r.defender_position as number | null) ?? null,
  }));

  const targetsByWar = byWar(targetRows, (r) => ({
    playerId: r.player_id as string,
    targetPosition: r.target_position as number,
    note: (r.note as string | null) ?? null,
    assignedBy: (r.assigned_by as string | null) ?? null,
    assignedAt: String(r.assigned_at),
  }));

  const out = new Map<string, WarRosterRows>();
  for (const id of ids) {
    const members = (membersByWar.get(id) ?? []).sort(
      (a, b) => (a.mapPosition ?? 99) - (b.mapPosition ?? 99),
    );
    const attacks = (attacksByWar.get(id) ?? []).sort(
      (a, b) => a.attackOrder - b.attackOrder,
    );
    const targets = (targetsByWar.get(id) ?? []).sort(
      (a, b) => a.targetPosition - b.targetPosition,
    );
    if (members.length || attacks.length || targets.length) {
      out.set(id, { members, attacks, targets });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// T6.4 — target writes, all four through definer functions.
//
// Every one checks `data === false` as well as `error`. These functions return false rather than raising when
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

/**
 * Leadership assigns a base (050: one of up to "attacks left" per member).
 * `replace` moves the member off that base onto `position` in one step. The
 * function's own message is surfaced verbatim.
 */
export function assignTarget(
  supabase: SupabaseClient,
  warId: string,
  playerId: string,
  position: number,
  note: string | null,
  replace: number | null = null,
): Promise<{ error?: string }> {
  return callRpc(supabase, "assign_war_target", {
    p_war: warId,
    p_player: playerId,
    p_position: position,
    p_note: note,
    p_replace: replace,
  });
}

/** Leadership withdraws one base, or all of a member's when `position` is null. Soft delete (R4). */
export function clearTarget(
  supabase: SupabaseClient,
  warId: string,
  playerId: string,
  position: number | null = null,
): Promise<{ error?: string }> {
  return callRpc(supabase, "clear_war_target", {
    p_war: warId,
    p_player: playerId,
    p_position: position,
  });
}

/**
 * A member claims a free base for one of their own villages (025, 046).
 *
 * `playerId` says WHICH of the caller's villages — it cannot name anyone
 * else's: 046's function only accepts a village owned by auth.uid() that is in
 * this war. Null lets the function pick the caller's village in this war.
 */
export function claimTarget(
  supabase: SupabaseClient,
  warId: string,
  position: number,
  note: string | null = null,
  playerId: string | null = null,
): Promise<{ error?: string }> {
  return callRpc(supabase, "claim_war_target", {
    p_war: warId,
    p_position: position,
    p_note: note,
    p_player: playerId,
  });
}

/** A member gives back a base they claimed (all of them when `position` is null). Not one leadership assigned them. */
export function releaseTarget(
  supabase: SupabaseClient,
  warId: string,
  playerId: string | null = null,
  position: number | null = null,
): Promise<{ error?: string }> {
  return callRpc(supabase, "release_war_target", {
    p_war: warId,
    p_player: playerId,
    p_position: position,
  });
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

// ---------------------------------------------------------------------------
// The war rating (063) — services/war-rating.ts
//
// Its own reads, with every column asked for as "*", rather than more columns on
// the reads above. Those are behind the war board, the dashboard and the home
// page; naming war_order or opponent_attacks_captured_at there would fail every
// one of them on a database 063 has not reached. Here, before 063, the new
// columns are simply absent and the rating falls back to attack-only.
// ---------------------------------------------------------------------------

/** A war with what the rating needs to know about it beyond WarRow. */
export interface WarRatingWar extends WarRow {
  /** Set once the sync has looked for the enemy's attacks. Null before 063. */
  opponentAttacksCapturedAt: string | null;
}

/** One of our attacks, with its order in the war (063). */
export interface WarRatingAttackRow extends WarAttackRow {
  /** The API's order within the war, both sides counted. Null before 063. */
  warOrder: number | null;
  /**
   * When the sync first saw this attack — the row is written once and never
   * again. Not the time of the attack, but an order of its own: of two attacks
   * seen an hour apart, the earlier one came first. What a war from before 063
   * has in place of warOrder.
   */
  seenAt: string | null;
}

/** One of the enemy's attacks (063). */
export interface WarOpponentAttackRow {
  attackerTag: string;
  attackOrder: number;
  defenderTag: string | null;
  stars: number;
  destruction: number;
  warOrder: number | null;
}

/**
 * This clan's wars that STARTED in one calendar month (UTC), oldest first.
 * `month` is 'YYYY-MM'.
 */
export async function warsInMonth(
  supabase: SupabaseClient,
  clanId: string,
  month: string,
): Promise<WarRatingWar[]> {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return [];
  const from = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
  const to = new Date(Date.UTC(Number(match[1]), Number(match[2]), 1));

  const { data, error } = await supabase
    .from("wars")
    .select("*")
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .gte("start_time", from.toISOString())
    .lt("start_time", to.toISOString())
    .order("start_time");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => {
    const captured = r.opponent_attacks_captured_at;
    return {
      ...toWar(r),
      // PostgREST sends an ISO string; the PGlite stand-in a Date.
      startTime: new Date(r.start_time as string | Date).toISOString(),
      opponentAttacksCapturedAt:
        captured === null || captured === undefined ? null : new Date(captured as string | Date).toISOString(),
    };
  });
}

/** The months ('YYYY-MM', UTC) this clan has a war in, newest first. */
export async function warMonthsForClan(supabase: SupabaseClient, clanId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("wars")
    .select("start_time")
    .eq("clan_id", clanId) // R3
    .is("deleted_at", null)
    .limit(1000)
    .order("start_time", { ascending: false });

  if (error || !data) return [];
  const months = (data as unknown as Array<{ start_time: string | Date }>).map((r) =>
    new Date(r.start_time).toISOString().slice(0, 7),
  );
  return [...new Set(months)];
}

/** Our attacks in one war, each with its order in the war. `warId` must already be clan-checked. */
export async function ratingAttacksForWar(
  supabase: SupabaseClient,
  warId: string,
): Promise<WarRatingAttackRow[]> {
  const { data, error } = await supabase
    .from("war_attacks")
    .select("*")
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
    warOrder: r.war_order === null || r.war_order === undefined ? null : Number(r.war_order),
    // PostgREST sends an ISO string; the PGlite stand-in a Date.
    seenAt:
      r.created_at === null || r.created_at === undefined
        ? null
        : new Date(r.created_at as string | Date).toISOString(),
  }));
}

/**
 * The enemy's attacks in one war. [] before 063, or for a war from before it —
 * WarRatingWar.opponentAttacksCapturedAt is what says which.
 */
export async function opponentAttacksOfWar(
  supabase: SupabaseClient,
  warId: string,
): Promise<WarOpponentAttackRow[]> {
  const { data, error } = await supabase
    .from("war_opponent_attacks")
    .select("attacker_tag, attack_order, defender_tag, stars, destruction, war_order")
    .eq("war_id", warId)
    .is("deleted_at", null)
    .order("attack_order");

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map((r) => ({
    attackerTag: r.attacker_tag as string,
    attackOrder: r.attack_order as number,
    defenderTag: (r.defender_tag as string | null) ?? null,
    stars: r.stars as number,
    destruction: Number(r.destruction),
    warOrder: r.war_order === null || r.war_order === undefined ? null : Number(r.war_order),
  }));
}
