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
// R11 — writes raid_seasons, raid_participants, and from 064 raid_opponents
// and raid_attacks. All four are game facts.
//
// ─────────────────────────────────────────────────────────────────────────────
// 064 — THE ATTACKS ARE ON THE LATEST WEEKEND ONLY
//
// The header above is right about the weekends and wrong about their detail.
// `attackLog` — who hit which district, and how far each attack took it —
// comes with the newest weekend alone; the nine behind it arrive with district
// totals and no attackers. So the raid rating's input has the opposite
// property to everything else here: it must be captured while the weekend is
// the latest, and a run missed then is not backfilled by the next one.
//
// Hence captureAttacks runs on every weekend the API sends detail for — the
// ongoing one, and a finished one whose attacks were never captured (stored
// before 064, or settled by a run that failed half way). A settled weekend's
// TOTALS are still never rewritten; its attacks are new rows, not edits.
//
// The enemy's capital league is not on the raid response. It is read from
// `/clans/{tag}` once per enemy clan, the first time the clan is seen raided —
// during the weekend, because leagues move when it closes.
// ─────────────────────────────────────────────────────────────────────────────
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
import { capitalRaidsEndpoint, clanEndpoint, request } from "@/integration/coc-client";
import { clanSchema, raidSeasonsSchema } from "@/integration/coc-schemas";
import { CocNotFoundError } from "@/integration/errors";
import { mapRaidSeasons } from "@/integration/mappers";
import { normaliseTag } from "@/lib/tags";
import type { RaidParticipant, RaidRaid, RaidSeason } from "@/types/domain";
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

/** A weekend already in raid_seasons, as the per-season decisions below need it. */
interface RecordedSeason {
  id: string;
  /** Recorded as finished — its totals are closed (R5). See isOngoing. */
  settled: boolean;
  /** 064 — its attacks have been captured. */
  captured: boolean;
}

/**
 * This clan's weekends already recorded, by start time.
 *
 * R5. war.ts checks one row because a clan is in at most one war at a time;
 * a raid response carries ten weekends at once, so this is one read per clan
 * rather than a query per season. See isOngoing for what counts as closed.
 */
async function recordedSeasons(
  supabase: SupabaseClient,
  clan: ClanRow,
): Promise<Map<string, RecordedSeason>> {
  const { data, error } = await supabase
    .from("raid_seasons")
    .select("id, start_time, state, attacks_captured_at")
    .eq("clan_id", clan.id) // R3
    .is("deleted_at", null);

  if (error) throw new Error(`raid_seasons read failed for ${clan.tag}: ${error.message}`);

  const recorded = new Map<string, RecordedSeason>();
  for (const row of (data ?? []) as Array<{
    id: string;
    start_time: string;
    state: string | null;
    attacks_captured_at: string | null;
  }>) {
    recorded.set(new Date(row.start_time).toISOString(), {
      id: row.id,
      // A row with no state at all has never been labelled by the API and is
      // left writable — the one case where "not ongoing" should not mean "done".
      settled: Boolean(row.state) && !isOngoing(row.state),
      captured: row.attacks_captured_at !== null && row.attacks_captured_at !== undefined,
    });
  }
  return recorded;
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

/**
 * An enemy clan's capital league, or nulls when the clan cannot be read.
 *
 * A failure here costs that raid its league marks and nothing else: the
 * attacks are the irreplaceable part, and they must not wait on a lookup of a
 * clan that may have been disbanded since. A row left with a null league is
 * looked up again on the next run that sees the weekend.
 */
async function capitalLeagueOf(
  clan: ClanRow,
  defenderTag: string,
): Promise<{ id: number | null; name: string | null }> {
  try {
    const enemy = await request(clanEndpoint(defenderTag), clanSchema);
    return { id: enemy.capitalLeague?.id ?? null, name: enemy.capitalLeague?.name ?? null };
  } catch (error) {
    console.warn(
      `  ${clan.tag}: capital league of ${defenderTag} not read — ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return { id: null, name: null };
  }
}

/**
 * raid_opponents and raid_attacks for one weekend, then attacks_captured_at.
 * `seasonId` must be this clan's — it came from upsertSeason or recordedSeasons.
 *
 * Both writes are idempotent. An attack never changes once made, so its row is
 * written once and every later run's copy is ignored (R5). An opponent is
 * written once too, except that one still without a league is looked up again.
 */
async function captureAttacks(
  supabase: SupabaseClient,
  clan: ClanRow,
  seasonId: string,
  raids: RaidRaid[],
  playerIds: Map<string, string>,
): Promise<number> {
  const { data: known, error: readError } = await supabase
    .from("raid_opponents")
    .select("raid_number, capital_league_id")
    .eq("raid_season_id", seasonId)
    .is("deleted_at", null);
  if (readError) throw new Error(`raid_opponents read failed for ${clan.tag}: ${readError.message}`);

  const leagueKnown = new Set(
    ((known ?? []) as Array<{ raid_number: number; capital_league_id: number | null }>)
      .filter((r) => r.capital_league_id !== null)
      .map((r) => Number(r.raid_number)),
  );

  const opponents = [];
  for (const raid of raids) {
    if (leagueKnown.has(raid.raidNumber)) continue;
    const league = await capitalLeagueOf(clan, raid.defenderTag);
    opponents.push({
      raid_season_id: seasonId,
      raid_number: raid.raidNumber,
      defender_tag: raid.defenderTag,
      defender_name: raid.defenderName ?? null,
      capital_league_id: league.id,
      capital_league: league.name,
    });
  }

  if (opponents.length) {
    const { error } = await supabase
      .from("raid_opponents")
      .upsert(opponents, { onConflict: "raid_season_id,raid_number", ignoreDuplicates: false });
    if (error) throw new Error(`raid_opponents upsert failed for ${clan.tag}: ${error.message}`);
  }

  const attacks = raids.flatMap((raid) =>
    raid.attacks
      .map((a) => {
        const playerId = playerIds.get(a.playerTag);
        // Same rule as upsertParticipants: dropped rather than guessed at.
        if (!playerId) return null;
        return {
          raid_season_id: seasonId,
          raid_number: raid.raidNumber,
          district_id: a.districtId,
          district_name: a.districtName ?? null,
          district_hall_level: a.districtHallLevel ?? null,
          attack_number: a.attackNumber,
          player_id: playerId,
          destruction: Math.round(a.destruction),
          stars: a.stars,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null),
  );

  if (attacks.length) {
    const { error } = await supabase.from("raid_attacks").upsert(attacks, {
      onConflict: "raid_season_id,raid_number,district_id,attack_number",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`raid_attacks upsert failed for ${clan.tag}: ${error.message}`);
  }

  const { error: stampError } = await supabase
    .from("raid_seasons")
    .update({ attacks_captured_at: new Date().toISOString() })
    .eq("clan_id", clan.id) // R3
    .eq("id", seasonId);
  if (stampError) throw new Error(`raid_seasons update failed for ${clan.tag}: ${stampError.message}`);

  return opponents.length + attacks.length;
}

/**
 * Everyone a weekend names — its participants and every attacker — as the
 * players rows their participation and attacks are written under.
 *
 * resolvePlayers speaks WarMember. A raider is the same two fields it needs —
 * the raid endpoint reports no Town Hall level, so thLevel is genuinely absent
 * rather than dropped here.
 */
async function raidPlayers(
  supabase: SupabaseClient,
  clan: ClanRow,
  season: RaidSeason,
): Promise<Map<string, string>> {
  const named = new Map<string, string>();
  for (const p of season.participants) named.set(p.playerTag, p.name);
  for (const raid of season.raids ?? []) {
    for (const a of raid.attacks) if (!named.has(a.playerTag)) named.set(a.playerTag, a.name ?? a.playerTag);
  }
  if (!named.size) return new Map();
  return resolvePlayers(
    supabase,
    clan,
    [...named].map(([tag, name]) => ({ tag, name, attacks: [] })),
    "raid",
  );
}

export async function syncRaids(ctx: JobContext): Promise<void> {
  const { supabase } = ctx;
  const clans = await activeClans(supabase);

  let seasonsWritten = 0;
  const problems: string[] = [];

  for (const clan of clans) {
    // One clan's bad hour must not cost the others theirs: a 5xx or a timeout
    // used to throw out of this loop and every clan later in tag order got
    // nothing that run. Recorded and thrown at the end instead.
    try {
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

      const recorded = await recordedSeasons(supabase, clan);
      let wrote = 0;

      for (const season of seasons) {
        const known = recorded.get(season.startTime.toISOString());

        // R5. A finished weekend recorded once is never touched again, even
        // though the API will keep sending it on every run for weeks — except
        // to add the attacks 064 captures, once, if they are still missing.
        if (known?.settled) {
          if (known.captured || season.raids === null) continue;
          const playerIds = await raidPlayers(supabase, clan, season);
          ctx.recorded(await captureAttacks(supabase, clan, known.id, season.raids, playerIds));
          seasonsWritten += 1;
          wrote += 1;
          continue;
        }

        const seasonId = await upsertSeason(supabase, clan, season);
        seasonsWritten += 1;
        wrote += 1;
        ctx.recorded(1);

        const playerIds = await raidPlayers(supabase, clan, season);
        if (season.participants.length) {
          ctx.recorded(
            await upsertParticipants(supabase, seasonId, season.participants, playerIds),
          );
        }
        if (season.raids !== null) {
          ctx.recorded(await captureAttacks(supabase, clan, seasonId, season.raids, playerIds));
        }
      }

      console.log(
        `  ${clan.tag} ${clan.name}: ${seasons.length} weekend(s) returned, ` +
          `${wrote} written, ${seasons.length - wrote} already settled`,
      );
    } catch (error) {
      problems.push(`${clan.tag}: ${error instanceof Error ? error.message : String(error)}`);
    }
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
