// T11.6 — the reads and writes behind "my bases".
//
// ─────────────────────────────────────────────────────────────────────────────
// R3, AND WHY THE FILTER HERE IS NOT A CLAN
//
// Every other repository in this directory filters by clan, and the README says
// to. This one filters by OWNER — `.eq("user_id", userId)` — and that is
// deliberate. Do not "fix" it.
//
// The subject of these queries is "the villages this member proved they own",
// which is not a clan-shaped question. A member may own villages in more than one
// clan (Architecture.md §7.1), and the whole point of Phase 11 is that the one
// sitting in a clan they hold no role in is still theirs and must still be
// listed. Migration 031 adds the matching SELECT policy and its header carries
// the full R3 argument; the short version is that the replacement filter is
// strictly narrower than a clan filter, not wider, and no row about another
// person becomes visible.
//
// members.ts's clanMovement() is the existing precedent and says the same thing
// in its own words — "NOT filtered to one clan, that is the point".
//
// The explicit .eq() is still the mechanism and the policy is still the net, in
// exactly the relation 006's header describes. Neither is redundant.
// ─────────────────────────────────────────────────────────────────────────────
//
// R11 — `players` is a game fact and is only READ here. The one column this file
// writes is in player_nicknames, a human-decision table with its own owner
// policies (033). Nothing in this file can write a player's name, clan or town
// hall level, and a session holds no privilege to.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClanRole } from "@/types/domain";

/**
 * One village a member owns.
 *
 * `clanId` is nullable and `nickname` is optional, and both nulls carry meaning
 * the page has to render differently:
 *
 *   clanId null      the village is in no clan on this platform at all — it was
 *                    synced once and has since left everything (T3.9 keeps the
 *                    row for its history).
 *   nickname null    the member has not labelled it, so the UI shows `name`.
 *                    baseLabel() in lib/nickname.ts is that fallback, stated once.
 */
export interface OwnedBase {
  playerId: string;
  tag: string;
  /** The in-game name, from the clan sync. Never editable here (R11). */
  name: string;
  thLevel: number | null;
  clanRole: ClanRole | null;
  verified: boolean;
  /** Set when the village is in none of the platform's clans (T3.9). */
  leftAt: string | null;
  /** The clan the village currently plays in, or null. NOT the clan's name. */
  clanId: string | null;
  /** The member's own label for it (033), or null. */
  nickname: string | null;
}

/**
 * Every village this member owns, labels included.
 *
 * TWO FLAT QUERIES IN PARALLEL, not a PostgREST embedded select. README.md says
 * repository code avoids embeds because the PGlite shim does not implement them,
 * and the flat pair costs nothing here: the two reads are INDEPENDENT, so they go
 * out together and the wall-clock cost is one round trip.
 *
 * The nicknames read needs no filter of its own, which is the part worth
 * noticing. 033's SELECT policy is `player_id in (select
 * auth_owned_player_ids())`, so an unfiltered read of player_nicknames returns
 * exactly this member's labels and nothing else — there is no clan or user column
 * to filter on and none is wanted. `.is("deleted_at", null)` is the only
 * predicate, and that is R4 rather than authorisation: a cleared label is a
 * tombstone, not an absent row.
 *
 * Sorted by tag, not by clan or by nickname. Tag is the only one of the three
 * that is stable: a nickname changes whenever the member edits it, and a clan
 * changes when they move, so either would reorder the list under them mid-edit.
 */
export async function basesForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<OwnedBase[]> {
  const [players, labels] = await Promise.all([
    supabase
      .from("players")
      .select("id, tag, name, th_level, clan_role, verified, left_at, clan_id")
      .eq("user_id", userId) // the mechanism; 031's policy is the net
      .is("deleted_at", null)
      .order("tag"),
    supabase
      .from("player_nicknames")
      .select("player_id, nickname")
      .is("deleted_at", null),
  ]);

  if (players.error || !players.data) return [];

  const byPlayer = new Map<string, string>();
  for (const row of (labels.data ?? []) as Array<{ player_id: string; nickname: string }>) {
    byPlayer.set(row.player_id, row.nickname);
  }

  return (
    players.data as Array<{
      id: string;
      tag: string;
      name: string;
      th_level: number | null;
      clan_role: ClanRole | null;
      verified: boolean | null;
      left_at: string | null;
      clan_id: string | null;
    }>
  ).map((row) => ({
    playerId: row.id,
    tag: row.tag,
    name: row.name,
    thLevel: row.th_level ?? null,
    clanRole: row.clan_role ?? null,
    verified: row.verified === true,
    leftAt: row.left_at ?? null,
    clanId: row.clan_id ?? null,
    nickname: byPlayer.get(row.id) ?? null,
  }));
}

/**
 * Set or change the label on one of the member's own bases.
 *
 * ONE STATEMENT, and 033's header explains why the unique index it conflicts on
 * is full rather than partial: ON CONFLICT cannot infer a partial index, so the
 * alternative is two statements from a Server Action, which is a race the index
 * then rejects when a member presses Save twice. `deleted_at: null` in the
 * payload is what makes this also the revival path for a cleared label (R4 keeps
 * the row).
 *
 * `set_by` is written explicitly and 033's WITH CHECK requires it to be the
 * caller, so a member cannot attribute a label to a clanmate. It is authorship,
 * not ownership — ownership lives on players.user_id and is not copied here.
 *
 * NO CLAN FILTER AND NO OWNERSHIP CHECK IN THIS FUNCTION, on purpose: 033's
 * policies do both, and duplicating them here would be a second expression that
 * has to agree with the first. A caller passing a playerId they do not own gets
 * a row-level security error, which the Server Action turns into a sentence.
 */
export async function setNickname(
  supabase: SupabaseClient,
  playerId: string,
  userId: string,
  nickname: string,
): Promise<{ error?: string }> {
  const { error } = await supabase.from("player_nicknames").upsert(
    {
      player_id: playerId,
      nickname,
      set_by: userId,
      deleted_at: null,
    },
    { onConflict: "player_id" },
  );

  return error ? { error: error.message } : {};
}

/**
 * Clear the label, so the base shows its in-game name again.
 *
 * A soft delete (R4), never a DELETE — `authenticated` holds no delete privilege
 * on this table and 033 defines no delete policy, so a hard delete would fail
 * anyway. The tombstone is also what setNickname() revives.
 *
 * `.is("deleted_at", null)` so clearing twice is a no-op rather than a write that
 * moves the timestamp and makes the second act look like the first.
 */
export async function clearNickname(
  supabase: SupabaseClient,
  playerId: string,
): Promise<{ error?: string }> {
  const { error } = await supabase
    .from("player_nicknames")
    .update({ deleted_at: new Date().toISOString() })
    .eq("player_id", playerId)
    .is("deleted_at", null);

  return error ? { error: error.message } : {};
}
