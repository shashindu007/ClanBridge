// T7.1 — Capital raid weekend sync.
//
// R1/R2 — the only place raid data is read from Supercell, and it runs on
// GitHub Actions, never in a page.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS THE EASIEST SYNC IN THE PROJECT, AND THE REASON IS WORTH KNOWING
//
// `/capitalraidseasons?limit=N` returns the last N weekends, complete, every
// time. There is no live/settled distinction to get wrong the way `/currentwar`
// has, no per-round fan-out the way CWL has, and no window during which the
// data is only half there. A missed run costs nothing: the next one backfills
// everything inside the limit.
//
// That makes it the opposite of CWL, and it is why this file is short. Do not
// mistake the shortness for the pattern being different — it is the same
// activeClans -> per-clan -> map -> upsert skeleton as clans.ts and war.ts, with
// fewer traps in the middle.
//
// ONE THING IS STILL LOST FOREVER, AND IT IS NOT THE WEEKEND
//
// `limit` is the whole memory. A clan that goes unsynced for longer than N
// weekends loses the ones that rolled off, and no amount of later syncing brings
// them back. That is why WEEKENDS is 10 rather than 1: fetching one weekend is
// enough for a working page and turns a two-month outage into permanent loss.
// The cost of the larger limit is bytes on a response nobody pays for.
// ─────────────────────────────────────────────────────────────────────────────
//
// R5 — a finished weekend is never rewritten. See settledSeasons below: unlike
// war.ts, which reads one row for one war, a clan has many raid seasons on one
// response and the settled ones have to be filtered as a set.
//
// R11 — writes raid_seasons and raid_participants only. Both are game facts.
//
// ─────────────────────────────────────────────────────────────────────────────
// A 403 HERE IS NOT CAUGHT, AND THAT IS A DECISION, NOT AN OVERSIGHT
//
// war.ts catches CocPrivateLogError and carries past it, so one clan's in-game
// setting does not cost the other two their wars. This job cannot do the same,
// because the client never raises that error for this endpoint: WAR_ENDPOINT in
// coc-client.ts:86 matches `/currentwar` only, so a 403 on
// `/capitalraidseasons` becomes CocAuthError — "the key's registered IP does not
// match" — and propagates.
//
// That is left alone deliberately. Whether the game returns 403 here for a
// private war log or only for a bad key is NOT KNOWN: the fixtures are still
// synthetic (T2.1), so there is no observed 403 from this endpoint to reason
// from. Widening WAR_ENDPOINT on a guess would relabel a genuine key problem as
// "your war log is private" and send the operator to fix a setting that is
// already correct — an error message that lies is worse than one that is merely
// broad.
//
// So: a 403 fails the run, with the key message, which is the more common cause
// and the more actionable one. If T2.1's capture shows a private-log 403 from
// this endpoint, the fix is one line in coc-client.ts and a catch here.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { capitalRaidsEndpoint, request } from "@/integration/coc-client";
import { raidSeasonsSchema } from "@/integration/coc-schemas";
import { CocNotFoundError } from "@/integration/errors";
import { mapRaidSeasons } from "@/integration/mappers";
import { normaliseTag } from "@/lib/tags";
import type { RaidParticipant, RaidSeason } from "@/types/domain";
// resolvePlayers is cwl.ts's, for the same reason war.ts imports it: a raider
// who joined and left between two runs of sync:clans has no players row, and
// dropping their participation is the outcome this project exists to prevent.
// Safe to import — cwl.ts's run-me guard tests argv for "cwl", which this
// file's path does not contain.
import { resolvePlayers, type ClanRow } from "./cwl";
import { activeClans, main, skip, type JobContext } from "./shared";

/**
 * How many weekends to ask for.
 *
 * Ten is roughly two and a half months. See the header: this number is the only
 * thing standing between an outage and permanent data loss, and raising it costs
 * nothing but response size.
 */
const WEEKENDS = 10;

/**
 * Is a weekend still being played, judged only by the API's own word?
 *
 * The single place that rule lives, because getting it wrong in either
 * direction is expensive and the two directions are not symmetric:
 *
 *   a finished weekend read as ongoing  -> it stays writable, and the next run
 *                                          writes the same numbers again. Free.
 *   an ongoing weekend read as finished -> the R5 guard freezes it, and every
 *                                          attack after the last sync is lost
 *                                          permanently.
 *
 * So anything the API has NOT explicitly labelled 'ongoing' is treated as
 * finished — which sounds like the aggressive reading and is the safe one,
 * because the cost lands on the recoverable side. Note the state is read back
 * out of the database, never inferred from end_time: a weekend whose end_time
 * has passed but which the API still calls ongoing is still accruing, and
 * freezing it on a clock rather than on the API's word loses those hours.
 */
export function isOngoing(state: string | null | undefined): boolean {
  return state === "ongoing";
}

/**
 * The start times of this clan's weekends that are already recorded as finished.
 *
 * R5. war.ts checks one row because a clan is in at most one war at a time;
 * a raid response carries ten weekends at once, so this is a set read once per
 * clan rather than a query per season. See isOngoing for what counts as closed.
 */
async function settledSeasons(
  supabase: SupabaseClient,
  clan: ClanRow,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("raid_seasons")
    .select("start_time, state")
    .eq("clan_id", clan.id) // R3
    .is("deleted_at", null);

  if (error) throw new Error(`raid_seasons read failed for ${clan.tag}: ${error.message}`);

  const settled = new Set<string>();
  for (const row of (data ?? []) as Array<{ start_time: string; state: string | null }>) {
    // A row with no state at all has never been labelled by the API and is left
    // writable — it is the one case where "not ongoing" should not mean "done".
    if (row.state && !isOngoing(row.state)) {
      settled.add(new Date(row.start_time).toISOString());
    }
  }
  return settled;
}

/** The season row, returning its id. Upsert on the natural key (clan_id, start_time). */
async function upsertSeason(
  supabase: SupabaseClient,
  clan: ClanRow,
  season: RaidSeason,
): Promise<string> {
  const startIso = season.startTime.toISOString();

  // NOT ignoreDuplicates. An ongoing weekend's loot, attacks and rewards climb
  // between runs — that is a live row being updated, not the rewriting of
  // history R5 forbids. settledSeasons() is what stops a finished one being
  // reached at all.
  const { error } = await supabase.from("raid_seasons").upsert(
    [
      {
        clan_id: clan.id,
        start_time: startIso,
        end_time: season.endTime.toISOString(),
        total_loot: season.totalLoot ?? null,
        // 027. Every one of these was on the response and was being discarded.
        state: season.state ?? null,
        raids_completed: season.raidsCompleted ?? null,
        total_attacks: season.totalAttacks ?? null,
        offensive_reward: season.offensiveReward ?? null,
        defensive_reward: season.defensiveReward ?? null,
      },
    ],
    { onConflict: "clan_id,start_time", ignoreDuplicates: false },
  );

  if (error) throw new Error(`raid_seasons upsert failed for ${clan.tag}: ${error.message}`);

  const { data, error: reread } = await supabase
    .from("raid_seasons")
    .select("id")
    .eq("clan_id", clan.id)
    .eq("start_time", startIso)
    .is("deleted_at", null);

  if (reread) throw new Error(`raid_seasons read failed for ${clan.tag}: ${reread.message}`);
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) throw new Error(`raid_seasons row vanished for ${clan.tag} at ${startIso}`);
  return id;
}

/**
 * raid_participants — who raided, and out of how many attacks.
 *
 * attack_limit and bonus_attack_limit are 027's, and they are the point. A
 * member who used 5 attacks did everything asked if the limit was 5 and left
 * one unspent if it was 6, and the limit varies per member, so the numerator
 * alone answers nothing. Same lesson as T6.9's — the unit has to carry its own
 * denominator.
 */
async function upsertParticipants(
  supabase: SupabaseClient,
  seasonId: string,
  participants: RaidParticipant[],
  playerIds: Map<string, string>,
): Promise<number> {
  const rows = participants
    .map((p) => {
      const playerId = playerIds.get(p.playerTag);
      // resolvePlayers creates anyone missing, so this is only reachable if the
      // insert was refused. Dropped rather than guessed at — a participation row
      // pointed at the wrong player is worse than an absent one.
      if (!playerId) return null;
      return {
        raid_season_id: seasonId,
        player_id: playerId,
        attacks_used: p.attacksUsed ?? null,
        attack_limit: p.attackLimit ?? null,
        bonus_attack_limit: p.bonusAttackLimit ?? null,
        loot: p.loot ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (!rows.length) return 0;

  // Same reasoning as the season row: an ongoing weekend's attack counts and
  // loot climb, so this updates rather than ignores.
  const { error } = await supabase
    .from("raid_participants")
    .upsert(rows, { onConflict: "raid_season_id,player_id", ignoreDuplicates: false });

  if (error) throw new Error(`raid_participants upsert failed: ${error.message}`);
  return rows.length;
}

export async function syncRaids(ctx: JobContext): Promise<void> {
  const { supabase } = ctx;
  const clans = await activeClans(supabase);

  let seasonsWritten = 0;
  const problems: string[] = [];

  for (const clan of clans) {
    const clanTag = normaliseTag(clan.tag);

    let seasons: RaidSeason[];
    try {
      seasons = mapRaidSeasons(
        await request(capitalRaidsEndpoint(clanTag, WEEKENDS), raidSeasonsSchema),
      );
    } catch (error) {
      // R10 — a clan the API has no raid history for. New clans, and clans that
      // have never opened their Capital. Ordinary, not a failure.
      if (error instanceof CocNotFoundError) {
        console.log(`  ${clan.tag}: no raid history`);
        continue;
      }
      // Everything else, including 403, propagates. See the header: a 403 on
      // this endpoint arrives as CocAuthError and its cause is genuinely
      // ambiguous until T2.1 captures a real one.
      throw error;
    }

    if (!seasons.length) {
      console.log(`  ${clan.tag}: no raid seasons returned`);
      continue;
    }

    const settled = await settledSeasons(supabase, clan);
    let wrote = 0;

    for (const season of seasons) {
      const startIso = season.startTime.toISOString();

      // R5. A finished weekend recorded once is never touched again, even
      // though the API will keep sending it on every run for weeks.
      if (settled.has(startIso)) continue;

      const seasonId = await upsertSeason(supabase, clan, season);
      seasonsWritten += 1;
      wrote += 1;
      ctx.recorded(1);

      if (!season.participants.length) continue;

      // resolvePlayers speaks WarMember. A raider is the same two fields it
      // needs — the raid endpoint reports no Town Hall level, so thLevel is
      // genuinely absent rather than dropped here.
      const playerIds = await resolvePlayers(
        supabase,
        clan,
        season.participants.map((p) => ({
          tag: p.playerTag,
          name: p.name,
          attacks: [],
        })),
        "raid",
      );

      ctx.recorded(
        await upsertParticipants(supabase, seasonId, season.participants, playerIds),
      );
    }

    console.log(
      `  ${clan.tag} ${clan.name}: ${seasons.length} weekend(s) returned, ` +
        `${wrote} written, ${seasons.length - wrote} already settled`,
    );
  }

  if (problems.length) throw new Error(problems.join("; "));

  // A clean skip only when NOTHING was writable across every clan — which is the
  // ordinary midweek state, since the last weekend settled days ago and the next
  // has not started. One clan with a live weekend is a success (R10).
  if (seasonsWritten === 0) {
    skip("noNewRaids", `nothing new across ${clans.length} clan(s) — every weekend is settled`);
  }
}

// "raids" does not appear in the path of clans.ts, cwl.ts or war.ts, so this
// guard cannot fire from another job's run. war.ts:56 documents the hazard.
if (process.argv[1]?.includes("raids")) {
  void main("raids", syncRaids);
}
