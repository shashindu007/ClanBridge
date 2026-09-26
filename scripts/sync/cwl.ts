// T4.1 — Clan War League sync. Every 2 hours. THE URGENT ONE.
//
// Fetch the league group, then each war tag, then insert seasons, wars, rosters
// and attacks with ON CONFLICT DO NOTHING against
// cwl_attacks(war_id, player_id, attack_order).
//
// R10 — a missing CWL group is a clean exit, not an error. There is no CWL for
// three weeks of every month. A job that reports failure three weeks out of four
// trains you to ignore the alerts that matter.
//
// R5 — never UPDATE or DELETE a historical row because the API returned something
// unexpected. This data is deleted from Supercell's side when the season ends and
// cannot ever be recovered.
//
// R11/R12 — this job writes cwl_seasons, cwl_wars, cwl_war_members and
// cwl_attacks. It must NOT touch cwl_rosters or cwl_roster_members: those are the
// leader's selection, and the API roster is a separate fact. Writing the API
// roster into the leader's table destroys the plan-vs-reality comparison
// (T4B.11) permanently.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE THREE THINGS THAT SILENTLY CORRUPT A SEASON
//
// 1. A CWL round holds EVERY clan's wars, not yours. An 8-clan group is 7 rounds
//    of 4 wars = 28 war tags, of which 7 involve you. Writing all 28 fills
//    cwl_wars with other people's wars. chooseSides() returning null is the
//    filter, and it is why that function is exported and tested directly.
//
// 2. mapWar().clan is NOT necessarily your clan. Fetched by war tag, the two
//    sides come back in whatever order the API felt like. Reading `clan` as
//    "ours" silently records every result backwards — you win the wars you lost.
//
// 3. cwl_wars.state forbids 'notInWar' (002_cwl.sql:42) but mapWar collapses any
//    unrecognised state to exactly that string. Passed straight through it is a
//    constraint violation mid-season.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { cwlGroupEndpoint, cwlWarEndpoint, request } from "@/integration/coc-client";
import { cwlGroupSchema, warSchema, type ApiCwlGroup } from "@/integration/coc-schemas";
import { CocNotFoundError, CocPrivateLogError } from "@/integration/errors";
import { mapCwlGroup, mapWar } from "@/integration/mappers";
import { normaliseTag } from "@/lib/tags";
import type { War, WarMember, WarResult, WarSide } from "@/types/domain";
import { activeClans, main, skip, type JobContext } from "./shared";
import { remindUnusedAttacks } from "./cwl-reminders";

/** One row of `activeClans()`. Exported alongside resolvePlayers, which takes it. */
export interface ClanRow {
  id: string;
  tag: string;
  name: string;
}

export interface Sides {
  ours: WarSide;
  theirs: WarSide;
}

/**
 * Work out which side of this war is us — trap 1 and trap 2 in one function.
 *
 * Returns null when neither side is this clan, which is the ordinary case: the
 * league group lists every war in every round, and only one war per round is
 * ours. The caller skips on null rather than treating it as an error.
 *
 * Exported and unit tested because getting this wrong is undetectable by
 * inspection — the data looks complete, it is simply attributed to the wrong
 * clan, and by the time anyone notices the season cannot be re-fetched.
 */
export function chooseSides(war: War, clanTag: string): Sides | null {
  const { clan, opponent } = war;
  if (clan?.tag === clanTag && opponent) return { ours: clan, theirs: opponent };
  if (opponent?.tag === clanTag && clan) return { ours: opponent, theirs: clan };
  return null;
}

/**
 * win / lose / tie, by stars then destruction.
 *
 * The API reports neither a result nor a winner for a CWL war, so it has to be
 * computed. Returns null while a war is still in preparation and has no stars.
 */
export function warResult(ours: WarSide, theirs: WarSide): WarResult | null {
  const ourStars = ours.stars;
  const theirStars = theirs.stars;
  if (ourStars === undefined || theirStars === undefined) return null;
  if (ourStars !== theirStars) return ourStars > theirStars ? "win" : "lose";

  const ourDestruction = ours.destruction ?? 0;
  const theirDestruction = theirs.destruction ?? 0;
  if (ourDestruction !== theirDestruction) {
    return ourDestruction > theirDestruction ? "win" : "lose";
  }
  return "tie";
}

/** Trap 3 — the column's CHECK has no 'notInWar', which is what mapWar emits for it. */
export function storedState(state: War["state"]): string | null {
  return state === "notInWar" ? null : state;
}

/**
 * war tag -> day number, read from the group's rounds.
 *
 * mapCwlGroup flattens rounds into a single warTags array, which is the right
 * shape for fetching but throws away the round index — and the round index IS
 * the day number. Nothing else in the response carries it, so it is read here
 * from the raw group rather than adding a field to the mapper that only this
 * job would use.
 */
export function dayNumbers(group: ApiCwlGroup): Map<string, number> {
  const days = new Map<string, number>();
  group.rounds.forEach((round, index) => {
    for (const raw of round.warTags) {
      if (!raw || raw === "#0") continue;
      days.set(normaliseTag(raw), index + 1);
    }
  });
  return days;
}

/** The season row, created once per clan per season. */
async function upsertSeason(
  supabase: SupabaseClient,
  clan: ClanRow,
  season: string,
): Promise<string> {
  const { error } = await supabase
    .from("cwl_seasons")
    .upsert([{ clan_id: clan.id, season }], {
      onConflict: "clan_id,season",
      ignoreDuplicates: true,
    });

  if (error) {
    throw new Error(`cwl_seasons upsert failed for ${clan.tag}: ${error.message}`);
  }

  // Read back rather than using .select() on the upsert: the season may already
  // have existed, in which case an ignoreDuplicates upsert returns nothing.
  // R3 — filtered by clan_id, not by season alone.
  const { data, error: readError } = await supabase
    .from("cwl_seasons")
    .select("id")
    .eq("clan_id", clan.id)
    .eq("season", season)
    .is("deleted_at", null);

  if (readError) {
    throw new Error(`cwl_seasons read failed for ${clan.tag}: ${readError.message}`);
  }
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) throw new Error(`cwl_seasons row vanished for ${clan.tag} ${season}`);
  return id;
}

/** What this season already holds about one of OUR wars. */
export interface StoredWar {
  state: string | null;
  day: number | null;
}

/**
 * Our wars already recorded this season, by war tag.
 *
 * Two uses. A warEnded war never changes again, so re-fetching it every two
 * hours for the rest of the season is a wasted API call against a rate-limited
 * key — and skipping it means a settled result can never be rewritten by a late
 * or malformed response (R5). And the day number tells tagsToFetch() which of a
 * round's four wars is ours, so the other three are not asked for again.
 */
async function storedWars(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<Map<string, StoredWar>> {
  const { data, error } = await supabase
    .from("cwl_wars")
    .select("war_tag, state, day_number")
    .eq("season_id", seasonId)
    .is("deleted_at", null);

  if (error) throw new Error(`cwl_wars read failed: ${error.message}`);

  const wars = new Map<string, StoredWar>();
  for (const row of (data ?? []) as Array<{
    war_tag: string;
    state: string | null;
    day_number: number | null;
  }>) {
    wars.set(row.war_tag, { state: row.state, day: row.day_number });
  }
  return wars;
}

/**
 * The war tags worth asking the API about this run, one round at a time.
 *
 * THE BUG THIS REPLACED. A CWL group has seven rounds of four wars, and only one
 * war per round is ours. The old loop skipped our settled wars and fetched every
 * other tag in the group, every run, just to discover it belonged to two other
 * clans and throw it away — 21 wasted calls per clan per run, all season,
 * contradicting the comment that said later runs were cheap.
 *
 * Now: a round whose war we have already stored is represented by that one tag
 * alone (or by nothing, once it has ended). Only a round we have never seen is
 * searched, and the caller stops at the first war that turns out to be ours.
 * Steady state is the group call plus one call per unfinished round.
 *
 * Exported so the call budget is tested directly rather than inferred from a
 * mock's call count.
 */
export function tagsToFetch(
  group: ApiCwlGroup,
  stored: ReadonlyMap<string, StoredWar>,
): string[][] {
  const oursByDay = new Map<number, string>();
  for (const [tag, war] of stored) {
    if (war.day !== null) oursByDay.set(war.day, tag);
  }

  const rounds: string[][] = [];
  group.rounds.forEach((round, index) => {
    const day = index + 1;
    const known = oursByDay.get(day);
    if (known !== undefined) {
      if (stored.get(known)?.state !== "warEnded") rounds.push([known]);
      return;
    }
    const tags = round.warTags
      .filter((raw) => raw && raw !== "#0")
      .map((raw) => normaliseTag(raw))
      // A settled war stored before day numbers were recorded (019) is still
      // ours and still finished — never worth another call.
      .filter((tag) => stored.get(tag)?.state !== "warEnded");
    if (tags.length) rounds.push(tags);
  });
  return rounds;
}

/** Insert or refresh the war row, and return its id. */
async function upsertWar(
  supabase: SupabaseClient,
  seasonId: string,
  warTag: string,
  war: War,
  sides: Sides,
  dayNumber: number | undefined,
): Promise<string> {
  const { ours, theirs } = sides;

  // Not ignoreDuplicates: a war legitimately moves preparation -> inWar ->
  // warEnded and its stars climb as attacks land. That is a live row being
  // updated, not the rewriting of history R5 forbids — and settledWarTags()
  // above is what stops a finished war ever being touched again.
  const { error } = await supabase.from("cwl_wars").upsert(
    [
      {
        season_id: seasonId,
        war_tag: warTag,
        day_number: dayNumber ?? null,
        opponent_tag: theirs.tag ?? null,
        opponent_name: theirs.name ?? null,
        opponent_badge_url: theirs.badgeUrl ?? null,
        team_size: war.teamSize ?? null,
        state: storedState(war.state),
        our_stars: ours.stars ?? null,
        their_stars: theirs.stars ?? null,
        our_destruction: ours.destruction ?? null,
        their_destruction: theirs.destruction ?? null,
        result: warResult(ours, theirs),
        start_time: war.startTime?.toISOString() ?? null,
        end_time: war.endTime?.toISOString() ?? null,
      },
    ],
    { onConflict: "war_tag", ignoreDuplicates: false },
  );

  if (error) throw new Error(`cwl_wars upsert failed for ${warTag}: ${error.message}`);

  const { data, error: readError } = await supabase
    .from("cwl_wars")
    .select("id")
    .eq("war_tag", warTag)
    .is("deleted_at", null);

  if (readError) throw new Error(`cwl_wars read failed for ${warTag}: ${readError.message}`);
  const id = (data as Array<{ id: string }> | null)?.[0]?.id;
  if (!id) throw new Error(`cwl_wars row vanished for ${warTag}`);
  return id;
}

/**
 * tag -> players.id for everyone on our side of this war, creating any that are
 * missing.
 *
 * A CWL attacker with no players row happens when someone joined and left
 * between two runs of sync:clans. The alternative to creating them is dropping
 * their attacks, and a dropped CWL attack cannot be re-fetched from anywhere —
 * which is the one thing this entire project exists to prevent. players is on
 * this job's R11 allow-list, so writing it here is legitimate.
 *
 * Looked up by tag ALONE, deliberately, despite R3. players.tag is globally
 * unique, and a player who has since moved to another of the three clans must
 * still resolve — filtering by clan_id would miss them, and the insert that
 * followed would collide on the unique tag and drag them back to their old clan.
 *
 * Exported for scripts/sync/war.ts (T6.1), which needs exactly this and for
 * exactly this reason: a war attack is as unrecoverable as a CWL one once the
 * war rolls off `/currentwar`. `context` only names the caller in the warning,
 * so an operator reading the log knows which job invented the row.
 */
export async function resolvePlayers(
  supabase: SupabaseClient,
  clan: ClanRow,
  members: WarMember[],
  context = "CWL",
): Promise<Map<string, string>> {
  if (!members.length) return new Map();

  const tags = members.map((m) => m.tag);
  const read = async (): Promise<Map<string, string>> => {
    const { data, error } = await supabase.from("players").select("id, tag").in("tag", tags);
    if (error) throw new Error(`players read failed for ${clan.tag}: ${error.message}`);
    return new Map(
      ((data ?? []) as Array<{ id: string; tag: string }>).map((r) => [r.tag, r.id]),
    );
  };

  const known = await read();
  const missing = members.filter((m) => !known.has(m.tag));
  if (!missing.length) return known;

  console.warn(
    `  ${clan.tag}: ${missing.length} ${context} participant(s) absent from players — ` +
      `creating so their attacks are not lost: ${missing.map((m) => m.tag).join(", ")}`,
  );

  // ignoreDuplicates so a player who exists under another clan is never
  // reassigned by this job — sync:clans owns clan membership (T3.9).
  const { error } = await supabase.from("players").upsert(
    missing.map((m) => ({
      clan_id: clan.id,
      tag: m.tag,
      name: m.name,
      th_level: m.thLevel ?? null,
    })),
    { onConflict: "tag", ignoreDuplicates: true },
  );

  if (error) throw new Error(`players upsert failed for ${clan.tag}: ${error.message}`);
  return read();
}

/** The roster the API reported — what missed attacks are derived from (T4.5). */
async function upsertRoster(
  supabase: SupabaseClient,
  warId: string,
  members: WarMember[],
  playerIds: Map<string, string>,
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
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (!rows.length) return 0;

  const { error } = await supabase
    .from("cwl_war_members")
    .upsert(rows, { onConflict: "war_id,player_id", ignoreDuplicates: true });

  if (error) throw new Error(`cwl_war_members upsert failed: ${error.message}`);
  return rows.length;
}

/**
 * The attacks. This is the data the project exists to keep.
 *
 * ignoreDuplicates against (war_id, player_id, attack_order) is R5 in one line:
 * run the job five times, the first one writes, the rest change nothing.
 */
async function upsertAttacks(
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
    // row (002_cwl.sql:76-78). The missed list is roster minus this.
    return m.attacks.map((attack, index) => ({
      war_id: warId,
      player_id: playerId,
      // Per-player ordinal, not the API's global war order, so it means what
      // 002_cwl.sql:72 says it means and stays stable across runs.
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
    .from("cwl_attacks")
    .upsert(rows, { onConflict: "war_id,player_id,attack_order", ignoreDuplicates: true });

  if (error) throw new Error(`cwl_attacks upsert failed: ${error.message}`);
  return rows.length;
}

export async function syncCwl(ctx: JobContext): Promise<void> {
  const { supabase } = ctx;
  const clans = await activeClans(supabase);

  let clansInCwl = 0;
  const problems: string[] = [];

  for (const clan of clans) {
    // One clan's bad hour must not cost the others theirs. A 5xx, a timeout or
    // one war tag the API cannot find used to throw straight out of this loop,
    // and every clan later in tag order got nothing that run — during league
    // week, data Supercell deletes when the season ends. Recorded here and
    // thrown at the end instead, exactly as a private war log already was.
    try {
      const clanTag = normaliseTag(clan.tag);

      let group: ApiCwlGroup;
      try {
        group = await request(cwlGroupEndpoint(clan.tag), cwlGroupSchema);
      } catch (error) {
        // R10 — no group is the normal state for three weeks of every month.
        if (error instanceof CocNotFoundError) {
          console.log(`  ${clan.tag}: not in CWL`);
          continue;
        }
        // A private war log is a real misconfiguration (T0.1), not a normal state.
        // Recorded and carried past so the other clans are still captured, then
        // thrown at the end — losing two clans' seasons to one clan's setting
        // would be a worse outcome than a noisy failure.
        if (error instanceof CocPrivateLogError) {
          problems.push(`${clan.tag}: war log is private (T0.1), CWL unreadable`);
          continue;
        }
        throw error; // recorded against this clan by the catch below
      }

      clansInCwl += 1;
      const mapped = mapCwlGroup(group);
      const days = dayNumbers(group);
      const seasonId = await upsertSeason(supabase, clan, mapped.season);
      const stored = await storedWars(supabase, seasonId);
      const settled = new Set(
        [...stored].filter(([, war]) => war.state === "warEnded").map(([tag]) => tag),
      );

      let ourWars = 0;
      for (const round of tagsToFetch(group, stored)) {
        for (const requestedTag of round) {
          if (settled.has(requestedTag)) continue;

          const war = mapWar(await request(cwlWarEndpoint(requestedTag), warSchema));
          const sides = chooseSides(war, clanTag);
          if (!sides) continue; // another clan's war in the same round — try the next

          // The war's OWN identity, not the tag we happened to ask for. They are the
          // same in production, and keying on the response means one war can only
          // ever occupy one row if they ever diverge — the alternative writes the
          // same war twice under two tags, which no constraint would catch.
          const warTag = war.warTag ?? requestedTag;
          if (settled.has(warTag)) break;

          ourWars += 1;
          const warId = await upsertWar(
            supabase,
            seasonId,
            warTag,
            war,
            sides,
            days.get(requestedTag) ?? days.get(warTag),
          );
          // Settled within this run too, so a later round listing the same war
          // cannot rewrite a result already recorded a moment ago.
          if (storedState(war.state) === "warEnded") settled.add(warTag);

          const playerIds = await resolvePlayers(supabase, clan, sides.ours.members);

          const defenderPositions = new Map<string, number>();
          for (const m of sides.theirs.members) {
            if (m.mapPosition !== undefined) defenderPositions.set(m.tag, m.mapPosition);
          }

          ctx.recorded(await upsertRoster(supabase, warId, sides.ours.members, playerIds));
          ctx.recorded(
            await upsertAttacks(supabase, warId, sides.ours.members, playerIds, defenderPositions),
          );

          // One war per round is ours. Found it — the rest of the round is other
          // clans' business and not worth a call.
          break;
        }
      }

      console.log(
        `  ${clan.tag} ${clan.name}: season ${mapped.season}, ` +
          `${ourWars} of our wars from ${mapped.warTags.length} in the group`,
      );
    } catch (error) {
      problems.push(`${clan.tag}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (problems.length) throw new Error(problems.join("; "));

  // Only a clean skip when NO clan is in CWL. One clan in CWL and two out is a
  // success, not a skip — the season data was captured.
  if (clansInCwl === 0) {
    skip("noCwlGroup", `none of the ${clans.length} clan(s) are in CWL`);
  }

  // T5.6 — after the capture, never before it. The reminder reads the rows this
  // run just wrote, and the capture is the part that cannot be repeated: a war
  // that ends before the next run takes its attacks with it permanently. Nothing
  // in here throws, so a push service having a bad day cannot fail a sync that
  // already did the irreplaceable half of its job.
  await remindUnusedAttacks(supabase, clans);
}

if (process.argv[1]?.includes("cwl")) {
  void main("cwl", syncCwl);
}
