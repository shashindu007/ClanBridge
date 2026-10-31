// The war and raid reminders Settings has always offered.
//
// `war_reminders` and `raid_reminders` were switches with nothing behind them:
// the toggles saved, the guide described them, and no job ever sent either. A
// member who left them on trusted a reminder that was never coming.
//
// Built the way T5.6 built the CWL one, and for the same reasons (cwl-reminders.ts
// has them in full): the roster is the API's, a muted member stays muted because
// this goes through notifyUsers(), a war that has ended reminds nobody, and the
// payload never names who did not attack.
//
// ONE DIFFERENCE, ON PURPOSE. CWL recomputes and can send twice, because it runs
// every two hours and the push tag collapses them. A war sync runs every 30
// minutes, and each send also adds a row to the member's feed, so this sends once
// per war and once per weekend, stamped in reminded_at (068).
//
// NEVER THROWS. Both run after the capture, which is the half that cannot be
// repeated. An unreachable push service must not fail a sync that did its job.

import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyUsers } from "@/lib/push";
import { participantsOfSeason } from "@/repositories/raids";
import { attacksForWar, membersOfWar } from "@/repositories/war";
import { attacksOwed } from "@/services/raids";
import { outstandingAttacks, warRecord } from "@/services/war";
import { accountsForPlayers, describeRemaining, REMINDER_WINDOW_MS } from "./cwl-reminders";

interface ClanRef {
  id: string;
  tag: string;
  name: string;
}

/**
 * How long before a raid weekend closes to ask.
 *
 * A day, not four hours, because of how often the raid job runs: once a day from
 * Friday to Monday, plus one run half an hour before the close. Sunday's run lands
 * inside this and leaves a member time to act. Monday's is the backup if it failed.
 */
export const RAID_REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * The end time, if it falls inside the window. Pure, for the test.
 *
 * The bound that matters is the lower one: something already over must never
 * remind anyone, because the attack it asks for can no longer be made.
 */
export function endsWithin(endTime: string | Date | null, windowMs: number, now: Date): Date | null {
  if (!endTime) return null;
  const end = new Date(endTime);
  const at = end.getTime();
  if (Number.isNaN(at) || at <= now.getTime() || at > now.getTime() + windowMs) return null;
  return end;
}

async function stamp(
  supabase: SupabaseClient,
  table: "wars" | "raid_seasons",
  id: string,
  now: Date,
): Promise<void> {
  const { error } = await supabase.from(table).update({ reminded_at: now.toISOString() }).eq("id", id);
  if (error) console.error(`  ${table} reminder not stamped: ${error.message}`);
}

/** Everyone in a war ending soon who still has an attack. */
export async function remindWarAttacks(
  supabase: SupabaseClient,
  clans: readonly ClanRef[],
  now: Date = new Date(),
): Promise<void> {
  if (clans.length === 0) return;
  const byId = new Map(clans.map((c) => [c.id, c]));

  try {
    const { data, error } = await supabase
      .from("wars")
      .select("id, clan_id, end_time")
      .in("clan_id", [...byId.keys()]) // R3
      .eq("state", "inWar")
      .is("reminded_at", null)
      .is("deleted_at", null);

    if (error) {
      console.error(`  war reminder: could not read wars — ${error.message}`);
      return;
    }

    for (const war of (data ?? []) as Array<{ id: string; clan_id: string; end_time: string | null }>) {
      const end = endsWithin(war.end_time, REMINDER_WINDOW_MS, now);
      const clan = byId.get(war.clan_id);
      if (!end || !clan) continue;

      const [members, attacks] = await Promise.all([
        membersOfWar(supabase, war.id),
        attacksForWar(supabase, war.id),
      ]);
      const owing = outstandingAttacks(warRecord(members, attacks));
      const userIds = await accountsForPlayers(supabase, owing.map((m) => m.playerId));

      if (userIds.length) {
        const result = await notifyUsers(supabase, clan.id, "war_reminders", userIds, {
          title: `${clan.name} — the war ends soon`,
          body: `You still have an attack to use. The war ends ${describeRemaining(end, now)}.`,
          url: `/${encodeURIComponent(clan.tag)}/war`,
          tag: `war-reminder:${war.id}`,
        });
        console.log(`  ${clan.tag}: reminded ${result.sent} of ${owing.length} player(s) owing a war attack`);
      }
      await stamp(supabase, "wars", war.id, now);
    }
  } catch (error) {
    console.error(`  war reminder: skipped — ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Everyone in the clan with raid attacks left on a weekend closing soon.
 *
 * From the clan's players, not the weekend's participants: the API lists only who
 * has already raided, and the member who has not started is the one to remind. Who
 * has raided is checked against what they were offered, and an unknown offer is
 * left alone: attacksOwed() will not invent a denominator, and neither does this.
 */
export async function remindRaidAttacks(
  supabase: SupabaseClient,
  clans: readonly ClanRef[],
  now: Date = new Date(),
): Promise<void> {
  if (clans.length === 0) return;
  const byId = new Map(clans.map((c) => [c.id, c]));

  try {
    const { data, error } = await supabase
      .from("raid_seasons")
      .select("id, clan_id, end_time")
      .in("clan_id", [...byId.keys()]) // R3
      .eq("state", "ongoing")
      .is("reminded_at", null)
      .is("deleted_at", null);

    if (error) {
      console.error(`  raid reminder: could not read weekends — ${error.message}`);
      return;
    }

    for (const season of (data ?? []) as Array<{ id: string; clan_id: string; end_time: string | null }>) {
      const end = endsWithin(season.end_time, RAID_REMINDER_WINDOW_MS, now);
      const clan = byId.get(season.clan_id);
      if (!end || !clan) continue;

      const { data: players, error: playersError } = await supabase
        .from("players")
        .select("id")
        .eq("clan_id", clan.id) // R3
        .is("left_at", null)
        .is("deleted_at", null);

      if (playersError) {
        console.error(`  raid reminder: could not read players — ${playersError.message}`);
        continue;
      }

      const raided = new Map(
        (await participantsOfSeason(supabase, season.id)).map((p) => [p.playerId, p]),
      );
      const owing = ((players ?? []) as Array<{ id: string }>)
        .map((p) => p.id)
        .filter((id) => {
          const participant = raided.get(id);
          return participant ? (attacksOwed(participant) ?? 0) > 0 : true;
        });

      const userIds = await accountsForPlayers(supabase, owing);
      if (userIds.length) {
        const result = await notifyUsers(supabase, clan.id, "raid_reminders", userIds, {
          title: `${clan.name} — the raid weekend ends soon`,
          body: `You still have raid attacks to use. The weekend ends ${describeRemaining(end, now)}.`,
          url: `/${encodeURIComponent(clan.tag)}/raids`,
          tag: `raid-reminder:${season.id}`,
        });
        console.log(`  ${clan.tag}: reminded ${result.sent} of ${owing.length} player(s) owing raid attacks`);
      }
      await stamp(supabase, "raid_seasons", season.id, now);
    }
  } catch (error) {
    console.error(`  raid reminder: skipped — ${error instanceof Error ? error.message : String(error)}`);
  }
}
