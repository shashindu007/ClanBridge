// T5.6, the outstanding half — "CWL day ending with unused attacks".
//
// THE ONLY NOTIFICATION IN THIS SYSTEM THAT CHANGES AN OUTCOME.
//
// Everything else here reports something that already happened: a notice was
// posted, a roster was published, a sync job died. This one is sent while the
// thing it is about can still be prevented. A CWL attack not used before the
// war ends is gone — Supercell deletes the season's data afterwards and it
// cannot be re-fetched from anywhere, which is the loss this entire project
// was built around. A member who gets this and opens the game keeps a star the
// clan would otherwise never have had.
//
// ─────────────────────────────────────────────────────────────────────────────
// R12 — THE ROSTER READ HERE IS THE API'S, NEVER THE LEADER'S
//
// `cwl_war_members` (019) is who Supercell says is in this war.
// `cwl_roster_members` (011) is who the leader PICKED for the season.
//
// They differ constantly: a co-leader adds someone in game who was never on the
// plan, or someone the leader picked is left out of a day. Reminding from the
// plan would nag people who are not in today's war — the fastest way to teach a
// clan that these notifications are noise — and would stay silent for exactly
// the people who ARE in it and have not attacked.
//
// missedAttacks() (T4.3) is reused rather than re-derived, because the rule
// "missed = on the roster with no attack row" is stated once in
// 002_cwl.sql:76-78 and must not acquire a second implementation that can drift.
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY THIS IS NOT PREFERENCE-EXEMPT, WHERE T5.8 IS
//
// alerts.ts deliberately bypasses push_targets() and T5.9's toggles: an
// operational alert goes to the two people who can fix it whether they like it
// or not. This is the opposite case. It goes to ordinary members about their own
// play, it is exactly the kind of thing someone may reasonably not want, and
// T5.9 lists `cwl_reminders` as switchable for that reason. So it routes through
// notifyUsers() and honours the toggle — a member who muted it stays muted.

import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyUsers } from "@/lib/push";
import { missedAttacks } from "@/services/cwl";
import { attacksForWar, rosterForWar } from "@/repositories/cwl";
import type { ClanRow } from "./cwl";

/**
 * How close to the end a war has to be before anyone is nagged.
 *
 * Four hours, against a job that runs every two, means a member gets at most
 * two reminders for one war — and the second is only sent if they still have
 * not attacked, because the missed list is recomputed each time.
 *
 * Not wider: a reminder eight hours out is easy to acknowledge and forget, and
 * it competes with the one that arrives when it actually matters. Not narrower:
 * a two-hour window against a two-hour schedule can be missed entirely if a
 * run is late, and GitHub delays scheduled runs by up to twenty minutes
 * (T4.2). This is sized so a single skipped run still leaves one reminder.
 */
export const REMINDER_WINDOW_MS = 4 * 60 * 60 * 1000;

export interface WarNeedingReminder {
  warId: string;
  clanId: string;
  season: string;
  dayNumber: number | null;
  endTime: Date;
}

/**
 * A war with its season already attached.
 *
 * Flattened by the caller from two queries rather than one embedded select.
 * PostgREST can express the join, but nothing else in this codebase does — and
 * `test/pglite-supabase.ts` is explicitly a stand-in "with no embedded selects",
 * so a query written that way is a query no test can reach.
 */
export interface CandidateWar {
  id: string;
  clanId: string;
  season: string;
  dayNumber: number | null;
  endTime: string | null;
  state: string | null;
}

/**
 * Wars close enough to the end to be worth a reminder.
 *
 * Split out and exported so the window rule is testable without a database.
 * The bound that matters is the lower one: `endTime > now`. A war that has
 * already ended must never produce a reminder, because the attack it would ask
 * for can no longer be made, and a notification telling someone to do something
 * impossible is worse than none — it is how people learn to ignore the channel.
 */
export function warsNeedingReminder(
  rows: readonly CandidateWar[],
  now: Date,
): WarNeedingReminder[] {
  const cutoff = now.getTime() + REMINDER_WINDOW_MS;

  return rows.flatMap((row) => {
    if (row.state !== "inWar") return [];
    if (!row.endTime) return [];

    const endTime = new Date(row.endTime);
    const at = endTime.getTime();
    if (Number.isNaN(at)) return [];
    if (at <= now.getTime() || at > cutoff) return [];

    return [
      {
        warId: row.id,
        clanId: row.clanId,
        season: row.season,
        dayNumber: row.dayNumber,
        endTime,
      },
    ];
  });
}

/** "in about 3 hours" — vague on purpose; see the call site. */
export function describeRemaining(endTime: Date, now: Date): string {
  const minutes = Math.round((endTime.getTime() - now.getTime()) / 60_000);
  if (minutes < 90) return `in about ${Math.max(minutes, 1)} minutes`;
  return `in about ${Math.round(minutes / 60)} hours`;
}

/**
 * Accounts to notify for a set of players.
 *
 * A player with no `user_id` has never linked their game account (T3.3), so
 * there is nobody to notify — the commonest case in a fresh install and not a
 * failure. Counted by the caller so "reminded 0" can be told apart from
 * "nobody has an account yet", which look identical from the outside.
 */
async function accountsForPlayers(
  supabase: SupabaseClient,
  playerIds: readonly string[],
): Promise<string[]> {
  if (playerIds.length === 0) return [];

  // Nulls are dropped below rather than in the query. A `.not("user_id", "is",
  // null)` filter would be tidier SQL and would also be the only call in this
  // codebase using `.not()`, which test/pglite-supabase.ts does not implement —
  // so the query would be untestable for the sake of skipping a handful of rows
  // out of a war roster of at most fifty.
  const { data, error } = await supabase
    .from("players")
    .select("user_id")
    .in("id", [...playerIds])
    .is("deleted_at", null);

  if (error) {
    console.error(`  cwl reminder: could not resolve accounts — ${error.message}`);
    return [];
  }

  const ids = new Set<string>();
  for (const row of (data ?? []) as Array<{ user_id: string | null }>) {
    if (row.user_id) ids.add(row.user_id);
  }
  return [...ids];
}

export interface ReminderOutcome {
  /** Wars that were inside the window and had at least one player still owing an attack. */
  warsReminded: number;
  /** Push messages actually accepted by a push service. */
  sent: number;
  /** Players who had not attacked, whether or not they had an account to notify. */
  playersOwing: number;
}

/**
 * Find wars ending soon, work out who still owes an attack, and tell them.
 *
 * NEVER THROWS. This runs at the tail of syncCwl, after the season data is
 * already written and durable. A push service being unreachable must not turn a
 * successful capture into a failed job — the capture is the part that cannot be
 * repeated, and failing here would also fire T5.8's alert about a sync that in
 * fact did its job perfectly.
 */
export async function remindUnusedAttacks(
  supabase: SupabaseClient,
  clans: readonly ClanRow[],
  now: Date = new Date(),
): Promise<ReminderOutcome> {
  const outcome: ReminderOutcome = { warsReminded: 0, sent: 0, playersOwing: 0 };
  if (clans.length === 0) return outcome;

  const byClanId = new Map(clans.map((c) => [c.id, c]));

  try {
    // Seasons first, filtered to this run's clans (R3). cwl_wars carries only a
    // season_id, so clan_id and the season string — both of which the payload
    // needs — have to come from here.
    const { data: seasonData, error: seasonError } = await supabase
      .from("cwl_seasons")
      .select("id, clan_id, season")
      .in("clan_id", [...byClanId.keys()])
      .is("deleted_at", null);

    if (seasonError) {
      console.error(`  cwl reminder: could not read seasons — ${seasonError.message}`);
      return outcome;
    }

    const seasons = new Map(
      ((seasonData ?? []) as Array<{ id: string; clan_id: string; season: string }>).map(
        (s) => [s.id, s],
      ),
    );
    if (seasons.size === 0) return outcome;

    const { data: warData, error: warError } = await supabase
      .from("cwl_wars")
      .select("id, season_id, day_number, end_time, state")
      .in("season_id", [...seasons.keys()])
      .eq("state", "inWar")
      .is("deleted_at", null);

    if (warError) {
      console.error(`  cwl reminder: could not read wars — ${warError.message}`);
      return outcome;
    }

    const candidates: CandidateWar[] = (
      (warData ?? []) as Array<{
        id: string;
        season_id: string;
        day_number: number | null;
        end_time: string | null;
        state: string | null;
      }>
    ).flatMap((w) => {
      const season = seasons.get(w.season_id);
      if (!season) return [];
      return [
        {
          id: w.id,
          clanId: season.clan_id,
          season: season.season,
          dayNumber: w.day_number,
          endTime: w.end_time,
          state: w.state,
        },
      ];
    });

    const due = warsNeedingReminder(candidates, now);

    for (const war of due) {
      const clan = byClanId.get(war.clanId);
      if (!clan) continue;

      const [roster, attacks] = await Promise.all([
        rosterForWar(supabase, war.warId),
        attacksForWar(supabase, war.warId),
      ]);

      // R12 again, at the point it is actually used: `roster` is 019's table.
      const owing = missedAttacks(roster, attacks);
      if (owing.length === 0) continue;
      outcome.playersOwing += owing.length;

      const userIds = await accountsForPlayers(
        supabase,
        owing.map((m) => m.playerId),
      );
      if (userIds.length === 0) {
        console.log(
          `  ${clan.tag}: ${owing.length} player(s) owe a CWL attack, none with a linked account`,
        );
        continue;
      }

      const day = war.dayNumber ? `day ${war.dayNumber}` : "today";
      const result = await notifyUsers(supabase, war.clanId, "cwl_reminders", userIds, {
        title: `${clan.name} — CWL ${day} ends soon`,
        // Deliberately does not name the player or their target. A push payload
        // is decrypted on a device this system does not control and can sit on a
        // lock screen; it says what to do and where, never who did not do it.
        body: `You have not used your CWL attack. The war ends ${describeRemaining(war.endTime, now)}.`,
        url: `/${encodeURIComponent(clan.tag)}/cwl/${encodeURIComponent(war.season)}`,
        // One collapse key per war, so a second reminder REPLACES the first on
        // the lock screen rather than stacking beside it.
        tag: `cwl-reminder:${war.warId}`,
      });

      outcome.warsReminded += 1;
      outcome.sent += result.sent;

      console.log(
        `  ${clan.tag}: reminded ${result.sent} of ${owing.length} player(s) owing a CWL attack (${day})`,
      );
    }
  } catch (error) {
    // See the doc comment: the capture already succeeded and must stand.
    console.error(
      `  cwl reminder: skipped — ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return outcome;
}
