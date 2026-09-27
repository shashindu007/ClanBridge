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
import { currentWarEndpoint, request, warLogEndpoint } from "@/integration/coc-client";
import { warLogSchema, warSchema } from "@/integration/coc-schemas";
import { CocNotFoundError, CocPrivateLogError } from "@/integration/errors";
import { mapWar } from "@/integration/mappers";
import { parseCocTimeOrNull } from "@/lib/coc-time";
import { normaliseTag } from "@/lib/tags";
import type { War, WarMember, WarSide } from "@/types/domain";
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
        opponent_badge_url: theirs.badgeUrl ?? null,
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
        // from stars then destruction, exactly as CWL's is — but only once the
        // war is OVER. Computed live it stored "tie" for every 0–0 preparation
        // day and "lose" for a war we were behind in at lunchtime, and a war
        // closed without its final score (closeStaleWars) kept that guess.
        result: war.state === "warEnded" ? warResult(ours, theirs) : null,
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

/**
 * Finish any war the hourly sync never saw end — and correct the ones it did
 * close, once the war log has their final score.
 *
 * THE GAP THIS CLOSES. `/currentwar` only ever describes the clan's CURRENT war.
 * A war ends, the clan starts searching (or is already in preparation for the
 * next one) before the next hourly run — and the `warEnded` response this job
 * needed was never observed. The row stayed `inWar` forever: the board kept
 * treating it as live, 024/025 kept its plan editable, and its result was
 * whatever the stars were an hour before the end.
 *
 * A row is stale when it is still preparation/inWar, its end_time has passed,
 * and it is not the war the API is describing right now. The war log supplies
 * the final totals.
 *
 * MATCHING THE LOG, AND THE BUG IT HAD. The log was matched on the end time to
 * the millisecond. The log's end time is not the one /currentwar reported: it
 * was 18:57:06 against a stored 18:57:05 for a 120–120 war, the match missed,
 * and the war was closed as the 106–114 loss it had been an hour before the
 * end. A war that finishes early (every attack used) ends hours before its
 * scheduled time in the log, too. So entries are matched on the OPPONENT'S TAG
 * with the end within a day, and only failing that on the nearest end time
 * within a few minutes (logs from before opponents carried tags).
 *
 * THE LOG IS THE GAME'S FINAL RECORD, so a war that ended in the last two days
 * is compared with it on every run and corrected where it differs — the score
 * a closed war was given from its last-known totals is replaced by the real
 * one. That is not rewriting history (R5): it is the history arriving. Only
 * the score and result change; the roster and attacks are untouched.
 *
 * What cannot be recovered: attacks landed in that last hour. The log carries
 * totals, not attacks, and Supercell keeps no other copy.
 *
 * Never throws for the API's sake: a private log, a fixture run with no warlog
 * file, or a timeout all fall back to closing the row on its last-known totals,
 * WITHOUT a result — a war that has ended is ended, but "lost" is a claim the
 * last-known totals cannot support.
 */
const RECONCILE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;
const EXACT_END_TOLERANCE_MS = 10 * 60 * 1000;
const SAME_WAR_END_WINDOW_MS = 26 * 60 * 60 * 1000;

interface StoredWarRow {
  id: string;
  state: string | null;
  opponent_tag: string | null;
  start_time: string;
  end_time: string | null;
  our_stars: number | null;
  their_stars: number | null;
  our_destruction: number | string | null;
  their_destruction: number | string | null;
  result: string | null;
}

type LogEntry = Awaited<ReturnType<typeof readWarLog>>[number];

/** Tag equality that never throws — a malformed tag simply does not match. */
function sameTag(a: string, b: string): boolean {
  const clean = (t: string) => `#${t.trim().toUpperCase().replace(/^#/, "")}`;
  return clean(a) === clean(b);
}

/** The war-log entry for one stored war, or undefined. Exported for tests. */
export function matchLogEntry(
  row: { opponent_tag: string | null; end_time: string | null },
  log: LogEntry[],
): LogEntry | undefined {
  if (!row.end_time) return undefined;
  const endMs = new Date(row.end_time).getTime();
  const distance = (entry: LogEntry) => Math.abs(entry.endMs - endMs);

  const byOpponent = row.opponent_tag
    ? log
        .filter((e) => e.theirs.tag && sameTag(e.theirs.tag, row.opponent_tag!))
        .filter((e) => distance(e) <= SAME_WAR_END_WINDOW_MS)
        .sort((a, b) => distance(a) - distance(b))[0]
    : undefined;
  if (byOpponent) return byOpponent;

  return log
    .filter((e) => distance(e) <= EXACT_END_TOLERANCE_MS)
    .sort((a, b) => distance(a) - distance(b))[0];
}

function finalPatch(entry: LogEntry): Record<string, unknown> {
  return {
    our_stars: entry.ours.stars ?? null,
    their_stars: entry.theirs.stars ?? null,
    our_destruction: entry.ours.destruction ?? null,
    their_destruction: entry.theirs.destruction ?? null,
    result: warResult(entry.ours, entry.theirs),
  };
}

/**
 * Whether the stored score disagrees with the log's. Destruction within a
 * hundredth counts as equal: the log says 99.975 where the column (numeric
 * 5,2) holds 99.98, and an exact compare would "correct" the war every hour.
 */
function differs(row: StoredWarRow, patch: Record<string, unknown>): boolean {
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const apart = (a: unknown, b: unknown, tolerance: number) => {
    const x = num(a);
    const y = num(b);
    if (x === null || y === null) return x !== y;
    return Math.abs(x - y) > tolerance;
  };
  return (
    apart(row.our_stars, patch.our_stars, 0) ||
    apart(row.their_stars, patch.their_stars, 0) ||
    apart(row.our_destruction, patch.our_destruction, 0.011) ||
    apart(row.their_destruction, patch.their_destruction, 0.011) ||
    row.result !== patch.result
  );
}

export async function closeStaleWars(
  supabase: SupabaseClient,
  clan: ClanRow,
  currentStart: Date | undefined,
  now: Date = new Date(),
): Promise<number> {
  const columns =
    "id, state, opponent_tag, start_time, end_time, our_stars, their_stars, " +
    "our_destruction, their_destruction, result";
  // Two small reads: every war still open (however old — one the sync missed
  // must still be closed), and the wars that ended recently enough to check
  // against the log.
  const [open, ended] = await Promise.all([
    supabase
      .from("wars")
      .select(columns)
      .eq("clan_id", clan.id) // R3
      .is("deleted_at", null)
      .in("state", ["preparation", "inWar"]),
    supabase
      .from("wars")
      .select(columns)
      .eq("clan_id", clan.id) // R3
      .is("deleted_at", null)
      .eq("state", "warEnded")
      .gte("end_time", new Date(now.getTime() - RECONCILE_WINDOW_MS).toISOString()),
  ]);

  if (open.error || ended.error) {
    throw new Error(`wars read failed for ${clan.tag}: ${(open.error ?? ended.error)!.message}`);
  }
  const rows = [...(open.data ?? []), ...(ended.data ?? [])] as unknown as StoredWarRow[];

  const isCurrent = (row: StoredWarRow) => new Date(row.start_time).getTime() === currentStart?.getTime();
  const stale = rows.filter(
    (row) =>
      (row.state === "preparation" || row.state === "inWar") &&
      row.end_time !== null &&
      new Date(row.end_time).getTime() < now.getTime() &&
      !isCurrent(row),
  );
  const recent = rows.filter(
    (row) =>
      row.state === "warEnded" &&
      row.end_time !== null &&
      now.getTime() - new Date(row.end_time).getTime() < RECONCILE_WINDOW_MS,
  );
  if (!stale.length && !recent.length) return 0;

  let log: LogEntry[] = [];
  try {
    log = await readWarLog(clan.tag);
  } catch (error) {
    // Only worth saying when a war is being closed blind; the reconcile pass
    // simply has nothing to compare against.
    if (stale.length) {
      console.warn(
        `  ${clan.tag}: war log unreadable (${error instanceof Error ? error.message : error}); ` +
          "closing on last-known totals",
      );
    }
  }

  let written = 0;
  const update = async (row: StoredWarRow, patch: Record<string, unknown>) => {
    const { error: updateError } = await supabase
      .from("wars")
      .update(patch)
      .eq("id", row.id)
      .eq("clan_id", clan.id);
    if (updateError) {
      throw new Error(`wars close failed for ${clan.tag}: ${updateError.message}`);
    }
    written += 1;
  };

  for (const row of stale) {
    const entry = matchLogEntry(row, log);
    // No log entry: the war is over, but its result is not known — the stars
    // are an hour old, and calling it won or lost on those is a guess.
    await update(row, { state: "warEnded", ...(entry ? finalPatch(entry) : { result: null }) });
    console.log(
      `  ${clan.tag}: closed a war that ended unseen at ${row.end_time}` +
        (entry ? " (final score from the war log)" : " (last-known score, result unknown)"),
    );
  }

  for (const row of recent) {
    const entry = matchLogEntry(row, log);
    if (!entry) continue;
    const patch = finalPatch(entry);
    if (!differs(row, patch)) continue;
    await update(row, patch);
    console.log(
      `  ${clan.tag}: corrected the war that ended ${row.end_time} to the war log's final score ` +
        `${String(patch.our_stars)}–${String(patch.their_stars)}`,
    );
  }

  return written;
}

/** The war log's regular wars, as sides already oriented to "us". */
async function readWarLog(tag: string) {
  const api = await request(warLogEndpoint(tag, 10), warLogSchema);
  const ours = normaliseTag(tag);
  return api.items.flatMap((item) => {
    const end = parseCocTimeOrNull(item.endTime);
    if (!end || !item.clan || !item.opponent) return [];
    // The log is always from the asking clan's point of view, but orienting it
    // by tag costs nothing and is the same trap chooseSides() closes elsewhere.
    const [us, them] =
      item.clan.tag && normaliseTag(item.clan.tag) !== ours
        ? [item.opponent, item.clan]
        : [item.clan, item.opponent];
    const side = (s: typeof us): WarSide => ({
      tag: s.tag,
      stars: s.stars,
      destruction: s.destructionPercentage,
      members: [],
    });
    return [{ endMs: end.getTime(), ours: side(us), theirs: side(them) }];
  });
}

export async function syncWar(ctx: JobContext): Promise<void> {
  const { supabase } = ctx;
  const clans = await activeClans(supabase);

  let clansInWar = 0;
  const problems: string[] = [];

  for (const clan of clans) {
    // One clan's bad hour must not cost the others theirs: a 5xx or a timeout
    // used to throw out of this loop and every clan later in tag order lost
    // its war for the run. Recorded and thrown at the end instead, exactly as
    // a private war log already was.
    try {
      const clanTag = normaliseTag(clan.tag);

      let war: War;
      try {
        war = mapWar(await request(currentWarEndpoint(clan.tag), warSchema));
      } catch (error) {
        // R10 — a clan the API has no current war for at all. Not a failure.
        if (error instanceof CocNotFoundError) {
          console.log(`  ${clan.tag}: no current war`);
          ctx.recorded(await closeStaleWars(supabase, clan, undefined));
          continue;
        }
        // A private war log is a real misconfiguration (T0.1). Recorded and
        // carried past so the other clans are still captured, then thrown at the
        // end — losing two clans' wars to one clan's setting is the worse outcome.
        if (error instanceof CocPrivateLogError) {
          problems.push(`${clan.tag}: war log is private (T0.1), war unreadable`);
          continue;
        }
        throw error; // recorded against this clan by the catch below
      }

      // Before anything else can `continue`: a war that ended between two runs
      // is finished whatever the API is describing now — notInWar, a league
      // war, or the next war's preparation.
      ctx.recorded(await closeStaleWars(supabase, clan, war.startTime));

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
    } catch (error) {
      problems.push(`${clan.tag}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
