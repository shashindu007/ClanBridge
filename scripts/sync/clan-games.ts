// T7.4 — Clan Games scoring. Daily, as a step of sync-raids.yml.
//
// R1/R2 — the only place this data is read from Supercell, and it runs on
// GitHub Actions, never in a page.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE API HAS NO CLAN GAMES ENDPOINT, NO SCORE, AND NO DATES
//
// There is nothing to fetch. The score is derived: each player's "Games
// Champion" achievement is a lifetime running total, so this month's points are
//
//     the value at the end of the period  minus  the value at the start
//
// which means this job is not really a sync at all. It is two snapshots taken
// six days apart, and the number only exists because both were taken.
//
// MISS THE START SNAPSHOT AND THE MONTH IS GONE. Not degraded — gone. There is
// no historical endpoint to backfill from, the achievement only ever goes up,
// and by the time anyone notices, the value has already moved. That is the same
// permanence that makes CWL this project's reason to exist, and it is why
// lib/coc-time.ts's window is deliberately a day early rather than risk a day
// late: snapshotting before anyone has scored costs nothing, and snapshotting
// after they have started costs the difference.
//
// WHY THIS IS EXPENSIVE, AND WHY THAT IS ACCEPTED
//
// One API call PER MEMBER — there is no bulk player endpoint. Fifty members
// across three clans at the client's 200 ms throttle is about thirty seconds of
// wall time. It runs twice a month for real (start and end), and the rest of the
// time exits immediately on the phase check before making a single call.
// ─────────────────────────────────────────────────────────────────────────────
//
// R5 — a settled season is never rewritten, and that guard is `clan_games.
// settled_at` (027) rather than a comment. Without it a run in April would write
// April's achievement total into March's end_value and silently turn a real
// score into a wrong one, with no error, because overwriting is exactly what
// this job does the rest of the time.
//
// R11 — writes clan_games and clan_games_scores only. Both are game facts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { playerEndpoint, request } from "@/integration/coc-client";
import { playerSchema } from "@/integration/coc-schemas";
import { CocNotFoundError } from "@/integration/errors";
import { mapPlayer } from "@/integration/mappers";
import { clanGamesPhase, clanGamesWindow } from "@/lib/coc-time";
import { activeClans, main, skip, type JobContext } from "./shared";

interface ClanRow {
  id: string;
  tag: string;
  name: string;
}

/** A member of one clan, as the players table holds them. */
interface PlayerRow {
  id: string;
  tag: string;
  name: string;
}

/**
 * The clan's current members, from the database rather than the API.
 *
 * sync:clans owns membership (T3.9) and has run within the hour; asking the API
 * again would be a second opinion that can disagree with the first. It also
 * means a member who left mid-period still has their row and their start_value,
 * so their partial score survives rather than vanishing.
 */
async function membersOf(
  supabase: SupabaseClient,
  clan: ClanRow,
): Promise<PlayerRow[]> {
  const { data, error } = await supabase
    .from("players")
    .select("id, tag, name")
    .eq("clan_id", clan.id) // R3
    .is("deleted_at", null)
    .is("left_at", null);

  if (error) throw new Error(`players read failed for ${clan.tag}: ${error.message}`);
  return (data ?? []) as PlayerRow[];
}

/**
 * The clan_games row for this season, created if absent — unless it is settled.
 *
 * Returns null for a settled season, which is the R5 guard. The dates are
 * written from the derived window (lib/coc-time.ts) and never from a person:
 * a leader-entered date in a game-fact table makes the table's provenance
 * unanswerable later, which is what R11 exists to prevent.
 */
async function openSeason(
  supabase: SupabaseClient,
  clan: ClanRow,
  season: string,
  window: { start: Date; end: Date },
): Promise<string | null> {
  const { data: existing, error: readError } = await supabase
    .from("clan_games")
    .select("id, settled_at")
    .eq("clan_id", clan.id) // R3
    .eq("season", season)
    .is("deleted_at", null);

  if (readError) throw new Error(`clan_games read failed for ${clan.tag}: ${readError.message}`);

  const row = (existing as Array<{ id: string; settled_at: string | null }> | null)?.[0];
  if (row?.settled_at) return null; // R5 — closed, and closed for good.
  if (row) return row.id;

  // upsert-and-reread rather than `.insert().select()`, matching war.ts's
  // upsertWar. `ignoreDuplicates` makes a concurrent run — or a retry after a
  // partial failure — a no-op rather than a unique-violation, and the reread
  // below then returns whichever row won.
  const { error } = await supabase.from("clan_games").upsert(
    [
      {
        clan_id: clan.id,
        season,
        start_time: window.start.toISOString(),
        end_time: window.end.toISOString(),
      },
    ],
    { onConflict: "clan_id,season", ignoreDuplicates: true },
  );

  if (error) throw new Error(`clan_games insert failed for ${clan.tag}: ${error.message}`);

  const { data, error: reread } = await supabase
    .from("clan_games")
    .select("id")
    .eq("clan_id", clan.id)
    .eq("season", season)
    .is("deleted_at", null);

  if (reread) throw new Error(`clan_games read failed for ${clan.tag}: ${reread.message}`);
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) throw new Error(`clan_games row vanished for ${clan.tag} ${season}`);
  return id;
}

/**
 * Each member's current Games Champion value.
 *
 * A tag the API has never heard of is skipped rather than failing the run: a
 * member who left the game between sync:clans and now must not cost the other
 * forty-nine their snapshot. `undefined` for a player with no Games Champion
 * achievement at all is likewise skipped — mapPlayer leaves it undefined rather
 * than defaulting to 0, and a 0 here would read as a real value and produce a
 * negative score at the end.
 */
async function snapshotValues(
  members: PlayerRow[],
  clan: ClanRow,
): Promise<Map<string, number>> {
  const values = new Map<string, number>();

  for (const member of members) {
    try {
      const player = mapPlayer(await request(playerEndpoint(member.tag), playerSchema));
      if (player.gamesChampionValue !== undefined) {
        values.set(member.id, player.gamesChampionValue);
      }
    } catch (error) {
      if (error instanceof CocNotFoundError) {
        console.warn(`  ${clan.tag}: ${member.tag} not found, skipped`);
        continue;
      }
      throw error;
    }
  }

  return values;
}

/**
 * Write the opening reading.
 *
 * `ignoreDuplicates` — this is the ONE write in the job that must never update.
 * A second run inside the start window (the window is a day wide on purpose,
 * see clanGamesPhase) would otherwise overwrite the opening value with one
 * taken hours later, after members had already scored, and every score for the
 * month would come out short by exactly the points earned in between. Nothing
 * would report it: both numbers are plausible.
 */
async function writeStart(
  supabase: SupabaseClient,
  gamesId: string,
  values: Map<string, number>,
): Promise<number> {
  const rows = [...values].map(([playerId, value]) => ({
    clan_games_id: gamesId,
    player_id: playerId,
    start_value: value,
  }));
  if (!rows.length) return 0;

  const { error } = await supabase
    .from("clan_games_scores")
    .upsert(rows, { onConflict: "clan_games_id,player_id", ignoreDuplicates: true });

  if (error) throw new Error(`clan_games_scores insert failed: ${error.message}`);
  return rows.length;
}

/**
 * Write the closing reading and the difference, then settle the season.
 *
 * Only for players who HAVE a start_value. Someone who joined mid-period has no
 * opening reading, so their difference is unknowable — and defaulting it to
 * their lifetime total would credit them with every point they have ever
 * scored, in one month. Left out entirely, which the page then reports as
 * "joined mid-period" rather than as a zero.
 */
async function writeEnd(
  supabase: SupabaseClient,
  gamesId: string,
  values: Map<string, number>,
): Promise<number> {
  const { data, error: readError } = await supabase
    .from("clan_games_scores")
    .select("player_id, start_value")
    .eq("clan_games_id", gamesId)
    .is("deleted_at", null);

  if (readError) throw new Error(`clan_games_scores read failed: ${readError.message}`);

  const started = new Map(
    ((data ?? []) as Array<{ player_id: string; start_value: number | null }>)
      .filter((r) => r.start_value !== null)
      .map((r) => [r.player_id, r.start_value!]),
  );

  const rows: Array<Record<string, unknown>> = [];
  for (const [playerId, endValue] of values) {
    const startValue = started.get(playerId);
    if (startValue === undefined) continue;

    rows.push({
      clan_games_id: gamesId,
      player_id: playerId,
      start_value: startValue,
      end_value: endValue,
      // Clamped. The achievement is a lifetime total and cannot fall, so a
      // negative here means one of the two readings is wrong — and a negative
      // score on a leaderboard sends the reader hunting for a scoring rule
      // that does not exist, rather than for the bad reading that caused it.
      points: Math.max(0, endValue - startValue),
    });
  }

  if (rows.length) {
    const { error } = await supabase
      .from("clan_games_scores")
      .upsert(rows, { onConflict: "clan_games_id,player_id", ignoreDuplicates: false });

    if (error) throw new Error(`clan_games_scores update failed: ${error.message}`);
  }

  // Settle it LAST, after the scores are safely written. Settling first would
  // close the season against a write that then failed, and R5 means the row
  // could never be corrected.
  const { error: settleError } = await supabase
    .from("clan_games")
    .update({ settled_at: new Date().toISOString() })
    .eq("id", gamesId);

  if (settleError) throw new Error(`clan_games settle failed: ${settleError.message}`);
  return rows.length;
}

export async function syncClanGames(ctx: JobContext, now = new Date()): Promise<void> {
  const { supabase } = ctx;

  // Checked BEFORE activeClans, and long before any API call. Three weeks in
  // four this is the whole job — R10, and it costs one function call rather
  // than 150 player requests.
  const phase = clanGamesPhase(now);
  if (!phase) {
    const { start } = clanGamesWindow(now);
    skip("notClanGames", `outside the games period — next opens ${start.toISOString()}`);
  }

  const clans = await activeClans(supabase);
  const window = clanGamesWindow(now);
  let touched = 0;

  for (const clan of clans) {
    const gamesId = await openSeason(supabase, clan, window.season, window);
    if (!gamesId) {
      console.log(`  ${clan.tag}: ${window.season} already settled, left untouched (R5)`);
      continue;
    }

    const members = await membersOf(supabase, clan);
    if (!members.length) {
      console.log(`  ${clan.tag}: no members held — has sync:clans run?`);
      continue;
    }

    const values = await snapshotValues(members, clan);
    const written =
      phase === "start"
        ? await writeStart(supabase, gamesId, values)
        : await writeEnd(supabase, gamesId, values);

    ctx.recorded(written);
    touched += written;

    console.log(
      `  ${clan.tag} ${clan.name}: ${phase} snapshot, ${values.size} of ` +
        `${members.length} member(s) read, ${written} row(s) written`,
    );
  }

  // In the period, but nothing to record — every clan settled already, or no
  // members held. A success with zero rows, not a failure.
  if (touched === 0) {
    skip("nothingToSnapshot", `${phase} phase, but no clan had anything to record`);
  }
}

// "clan-games" does not appear in the path of clans.ts, cwl.ts, war.ts or
// raids.ts. Note it must be tested BEFORE any substring of it would match —
// "clans" is not a substring of "clan-games", so the two cannot collide.
// war.ts:56 documents the hazard.
if (process.argv[1]?.includes("clan-games")) {
  void main("clan-games", (ctx) => syncClanGames(ctx));
}
