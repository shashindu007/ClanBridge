// T6.1 — Clan war sync. Runs hourly, as a step of sync-clans (see T6.2).
//
// R10 — handle each state explicitly, and treat none of them as a failure:
//   notInWar      the normal state most of the time
//   preparation   roster known, no attacks yet
//   inWar         attacks arriving
//   warEnded      final; capture it before it rolls off
//
// A 403 here means the war log is private (T0.1), not that the key is wrong.
//
// R11/R12 — this job writes wars, war_members and war_attacks only. It must NOT
// touch war_targets (who was told to attack) or war_lineup_members (who the
// leader picked). Those are human decisions; T6.10 compares them against what
// this job records, which is impossible if the job has already overwritten them.
// Migration 024 revokes the grants as well, so this is enforced rather than
// merely promised.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT MAKES THIS DIFFERENT FROM THE CWL SYNC, WHICH IT OTHERWISE MIRRORS
//
// 1. `/currentwar` CAN RETURN A CWL WAR. During league week some clans see their
//    league war on this endpoint rather than `notInWar`. It is recognisable by
//    carrying a `warTag`, and writing it into `wars` would double-count the same
//    war against cwl_wars — once in war history, once in the contribution
//    report, with no constraint anywhere to catch it. scripts/sync/cwl.ts owns
//    league wars; this job declines them.
//
// 2. THERE IS NO WAR TAG TO KEY ON. cwl_wars has `unique (war_tag)`; wars has
//    `unique (clan_id, start_time)` (003_war.sql:31), because the API gives a
//    regular war no identifier at all. A war with no startTime therefore cannot
//    be stored — and preparation already carries one, so in practice only
//    notInWar lacks it.
//
// 3. TWO ATTACKS PER MEMBER, NOT ONE. Recorded on war_members.attacks_allowed
//    from the API's own attacksPerMember rather than assumed, so a future game
//    change cannot silently rewrite what old wars meant.
//
// 4. THE ROSTER IS ONE CLAN'S, EVERY TIME. `/clans/{tag}/currentwar` is asked
//    about a specific clan, so chooseSides() cannot return null in practice the
//    way it constantly does for CWL. It is used anyway: reading `clan` as "ours"
//    is the trap that records every result backwards, and closing it costs one
//    function call.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { currentWarEndpoint, request } from "@/integration/coc-client";
import { warSchema } from "@/integration/coc-schemas";
import { CocNotFoundError, CocPrivateLogError } from "@/integration/errors";
import { mapWar } from "@/integration/mappers";
import { normaliseTag } from "@/lib/tags";
import type { War, WarMember } from "@/types/domain";
// chooseSides, warResult and storedState are the same three traps in both
// modules, and are tested directly in test/sync-cwl.test.ts. Imported rather
// than copied: a second copy is a second place for the "which side is us" logic
// to drift, and drift there is invisible — the data looks complete and is simply
// attributed to the wrong clan. Safe to import: cwl.ts's run-me guard tests argv
// for "cwl", which the path of this file does not contain.
import {
  chooseSides,
  resolvePlayers,
  storedState,
  warResult,
  type ClanRow,
  type Sides,
} from "./cwl";
import { activeClans, main, skip, type JobContext } from "./shared";

/**
 * A league war arriving on the regular war endpoint.
 *
 * Trap 1 above. Exported so the guard is tested for what it is, rather than
 * inferred from a row count at the end of an end-to-end test.
 */
export function isLeagueWar(war: War): boolean {
  return war.warTag !== undefined;
}

/**
 * The war row, or null when this war is already recorded as finished.
 *
 * R5 — a warEnded row is never written again. Unlike CWL there is no separate
 * settled-tags query to run first: a clan is in at most one regular war at a
 * time, so the check is a single read of the row this run is about to touch.
 */
async function upsertWar(
  supabase: SupabaseClient,
  clan: ClanRow,
  war: War,
  sides: Sides,
  startTime: Date,
): Promise<string | null> {
  const { ours, theirs } = sides;
  const startIso = startTime.toISOString();

  const { data: existing, error: readError } = await supabase
    .from("wars")
    .select("id, state")
    .eq("clan_id", clan.id) // R3
    .eq("start_time", startIso)
    .is("deleted_at", null);

  if (readError) throw new Error(`wars read failed for ${clan.tag}: ${readError.message}`);

  const settled = (existing as Array<{ id: string; state: string | null }> | null)?.[0];
  if (settled?.state === "warEnded") return null;

  // Not ignoreDuplicates: a war moves preparation -> inWar -> warEnded and its
  // stars climb as attacks land. That is a live row being updated, not the
  // rewriting of history R5 forbids — the check above is what stops a finished
  // war ever being touched again.
  const { error } = await supabase.from("wars").upsert(
    [
      {
        clan_id: clan.id,
        opponent_tag: theirs.tag ?? null,
        opponent_name: theirs.name ?? null,
        team_size: war.teamSize ?? null,
        // 003_war.sql:19 has no 'notInWar' in its CHECK, and mapWar collapses
        // any unrecognised state to exactly that string. Passed straight through
        // it is a constraint violation.
        state: storedState(war.state),
        our_stars: ours.stars ?? null,
        their_stars: theirs.stars ?? null,
        our_destruction: ours.destruction ?? null,
        their_destruction: theirs.destruction ?? null,
        // The API reports no winner for a regular war either, so it is computed
        // from stars then destruction, exactly as CWL's is.
        result: warResult(ours, theirs),
        start_time: startIso,
        end_time: war.endTime?.toISOString() ?? null,
      },
    ],
    { onConflict: "clan_id,start_time", ignoreDuplicates: false },
  );

  if (error) throw new Error(`wars upsert failed for ${clan.tag}: ${error.message}`);

  if (settled?.id) return settled.id;

  const { data, error: reread } = await supabase
    .from("wars")
    .select("id")
    .eq("clan_id", clan.id)
    .eq("start_time", startIso)
    .is("deleted_at", null);

  if (reread) throw new Error(`wars read failed for ${clan.tag}: ${reread.message}`);
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) throw new Error(`wars row vanished for ${clan.tag} at ${startIso}`);
  return id;
}

/**
 * war_members — who the API says is in the war (024).
 *
 * The denominator for everything the war module reports. "Who did not attack" is
 * this minus war_attacks, and a player who never attacked has no war_attacks row
 * to be found by — so without this table that list cannot be produced at all.
 */
async function upsertWarMembers(
  supabase: SupabaseClient,
  warId: string,
  members: WarMember[],
  playerIds: Map<string, string>,
  attacksAllowed: number,
): Promise<number> {
  const rows = members
    .map((m) => {
      const playerId = playerIds.get(m.tag);
      if (!playerId) return null;
      return {
        war_id: warId,
        player_id: playerId,
        map_position: m.mapPosition ?? null,
        th_level: m.thLevel ?? null,
        attacks_allowed: attacksAllowed,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (!rows.length) return 0;

  const { error } = await supabase
    .from("war_members")
    .upsert(rows, { onConflict: "war_id,player_id", ignoreDuplicates: true });

  if (error) throw new Error(`war_members upsert failed: ${error.message}`);
  return rows.length;
}

/**
 * war_opponent_members — the other side (026).
 *
 * Fetched on the same response as our own roster and, until 026, discarded. It
 * is what turns "assign your TH16 to base 7" into a decision: T6.4 is target
 * assignment, and a leader who cannot see what base 7 is assigns by position and
 * hope.
 *
 * Not in `players` and not FK'd to it, deliberately — see 026's header. These
 * are strangers, and `players` is the member directory.
 */
async function upsertOpponents(
  supabase: SupabaseClient,
  warId: string,
  members: WarMember[],
): Promise<number> {
  const rows = members.map((m) => ({
    war_id: warId,
    tag: m.tag,
    name: m.name,
    map_position: m.mapPosition ?? null,
    th_level: m.thLevel ?? null,
  }));

  if (!rows.length) return 0;

  const { error } = await supabase
    .from("war_opponent_members")
    .upsert(rows, { onConflict: "war_id,tag", ignoreDuplicates: true });

  if (error) throw new Error(`war_opponent_members upsert failed: ${error.message}`);
  return rows.length;
}

/**
 * The attacks.
 *
 * `defender_position` IS LOAD-BEARING, and it is the one field here with no
 * obvious consequence if dropped. T6.9 answers "did they hit what they were told
 * to hit" by comparing war_targets.target_position against this column. Left
 * null, that whole report reads "unknown" forever with nothing to indicate a
 * bug. It is not on the attack — the API gives a defender tag — so it is
 * resolved from the opponent roster's map positions by the caller.
 */
async function upsertWarAttacks(
  supabase: SupabaseClient,
  warId: string,
  members: WarMember[],
  playerIds: Map<string, string>,
  defenderPositions: Map<string, number>,
): Promise<number> {
  const rows = members.flatMap((m) => {
    const playerId = playerIds.get(m.tag);
    if (!playerId) return [];
    // A player who did not attack simply has no entries — never a placeholder
    // row. A stored miss is indistinguishable from a genuine zero-star attack.
    return m.attacks.map((attack, index) => ({
      war_id: warId,
      player_id: playerId,
      // Per-player ordinal (1, 2), not the API's global war order, so it stays
      // stable across runs and means "their second attack" rather than "the
      // fourteenth attack of the war".
      attack_order: index + 1,
      stars: attack.stars,
      destruction: attack.destruction,
      defender_tag: attack.defenderTag,
      defender_position: defenderPositions.get(attack.defenderTag) ?? null,
      // The API carries no per-attack timestamp. Left null rather than guessed:
      // a fabricated time is worse than a missing one.
      attacked_at: null,
    }));
  });

  if (!rows.length) return 0;

  const { error } = await supabase
    .from("war_attacks")
    .upsert(rows, { onConflict: "war_id,player_id,attack_order", ignoreDuplicates: true });

  if (error) throw new Error(`war_attacks upsert failed: ${error.message}`);
  return rows.length;
}

export async function syncWar(ctx: JobContext): Promise<void> {
  const { supabase } = ctx;
  const clans = await activeClans(supabase);

  let clansInWar = 0;
  const problems: string[] = [];

  for (const clan of clans) {
    const clanTag = normaliseTag(clan.tag);

    let war: War;
    try {
      war = mapWar(await request(currentWarEndpoint(clan.tag), warSchema));
    } catch (error) {
      // R10 — a clan the API has no current war for at all. Not a failure.
      if (error instanceof CocNotFoundError) {
        console.log(`  ${clan.tag}: no current war`);
        continue;
      }
      // A private war log is a real misconfiguration (T0.1). Recorded and
      // carried past so the other clans are still captured, then thrown at the
      // end — losing two clans' wars to one clan's setting is the worse outcome.
      if (error instanceof CocPrivateLogError) {
        problems.push(`${clan.tag}: war log is private (T0.1), war unreadable`);
        continue;
      }
      throw error;
    }

    // R10. Most of the time this is every clan, and it is a success.
    if (war.state === "notInWar") {
      console.log(`  ${clan.tag}: not in war`);
      continue;
    }

    // Trap 1 — a league war on the regular endpoint. cwl.ts owns it.
    if (isLeagueWar(war)) {
      console.log(`  ${clan.tag}: in a CWL war (${war.warTag}) — left to sync:cwl`);
      continue;
    }

    const sides = chooseSides(war, clanTag);
    if (!sides) {
      // Only reachable if the API answered about a clan we did not ask about, or
      // sent a half-war. Recorded rather than guessed at: attributing a war to
      // the wrong side is silent and permanent.
      problems.push(`${clan.tag}: neither side of the current war is this clan`);
      continue;
    }

    // Trap 2 — no start time, no natural key, no row.
    if (!war.startTime) {
      problems.push(`${clan.tag}: war in state ${war.state} has no startTime`);
      continue;
    }

    clansInWar += 1;

    const warId = await upsertWar(supabase, clan, war, sides, war.startTime);
    if (!warId) {
      console.log(`  ${clan.tag}: war already recorded as ended, left untouched (R5)`);
      continue;
    }

    const playerIds = await resolvePlayers(supabase, clan, sides.ours.members, "war");

    const defenderPositions = new Map<string, number>();
    for (const m of sides.theirs.members) {
      if (m.mapPosition !== undefined) defenderPositions.set(m.tag, m.mapPosition);
    }

    ctx.recorded(
      await upsertWarMembers(
        supabase,
        warId,
        sides.ours.members,
        playerIds,
        war.attacksPerMember ?? 2,
      ),
    );
    ctx.recorded(await upsertOpponents(supabase, warId, sides.theirs.members));
    ctx.recorded(
      await upsertWarAttacks(supabase, warId, sides.ours.members, playerIds, defenderPositions),
    );

    console.log(
      `  ${clan.tag} ${clan.name}: ${war.state} vs ${sides.theirs.name ?? "unknown"}, ` +
        `${sides.ours.members.length} in the lineup`,
    );
  }

  if (problems.length) throw new Error(problems.join("; "));

  // Only a clean skip when NO clan is in a war. One clan at war and two idle is
  // a success — that clan's war was captured.
  if (clansInWar === 0) {
    skip("notInWar", `none of the ${clans.length} clan(s) are in a war`);
  }
}

if (process.argv[1]?.includes("war")) {
  void main("war", syncWar);
}
