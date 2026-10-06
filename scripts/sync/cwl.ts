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
// The one thing it takes back is a lineup place nobody played: a member swapped
// out during preparation is soft-deleted (deleted_at) from the war he was
// listed in, and restored if he returns. See "WHO LEFT A LINEUP" below.
//
// R11/R12 — this job writes cwl_seasons, cwl_wars, cwl_war_members,
// cwl_attacks, (048) cwl_group_clans and cwl_group_wars — the rest of the
// group, from which standings and medals are derived — and (057)
// cwl_group_members and cwl_group_war_members, the group's rosters and fielded
// lineups for scouting — with (062) the order of each attack within its war.
// It must NOT touch cwl_rosters or cwl_roster_members: those are the
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
import type { CwlGroupRoster, War, WarMember, WarResult, WarSide } from "@/types/domain";
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
  groupState?: string,
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
  // Never allowed to cost the season: a failure here is logged and the capture
  // of our wars carries on (see "THE REST OF THE GROUP" below).
  await stampLeague(supabase, clan, id, groupState).catch((error: unknown) =>
    console.warn(`  ${clan.tag}: league not stamped — ${error instanceof Error ? error.message : String(error)}`),
  );
  return id;
}

/**
 * The league this season is played in — the thing the medal table is keyed on.
 *
 * cwl_seasons.league existed from 002 and nothing ever wrote it, so every
 * season showed "—". The API has no league on the group or the wars; the only
 * source is the clan's current war league, which sync:clans keeps in
 * clans.war_league.
 *
 * Only WHILE the season runs, and only into an empty column. Promotion and
 * relegation happen when the season ends: stamped afterwards, a clan promoted
 * from Master III would record the season it just won as Master II. A value
 * once written is never replaced (R5).
 */
async function stampLeague(
  supabase: SupabaseClient,
  clan: ClanRow,
  seasonId: string,
  groupState: string | undefined,
): Promise<void> {
  if (groupState === "ended") return;

  const { data, error } = await supabase.from("clans").select("war_league").eq("id", clan.id);
  if (error) throw new Error(`clans read failed for ${clan.tag}: ${error.message}`);
  const league = (data as Array<{ war_league: string | null }> | null)?.[0]?.war_league ?? null;
  if (!league) return;

  const { error: updateError } = await supabase
    .from("cwl_seasons")
    .update({ league })
    .eq("id", seasonId)
    .is("league", null);
  if (updateError) {
    throw new Error(`cwl_seasons league update failed for ${clan.tag}: ${updateError.message}`);
  }
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
        // Only once the day is over: a running day's "result" was the stars so
        // far, and read as won or lost before anyone had finished attacking.
        result: storedState(war.state) === "warEnded" ? warResult(ours, theirs) : null,
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

// ─────────────────────────────────────────────────────────────────────────────
// WHO LEFT A LINEUP
//
// A lineup can be changed all through preparation day, and this job first
// sees a war DURING preparation. Both tables it writes a lineup into only ever
// gained rows — cwl_war_members is insert-once, cwl_group_war_members an upsert
// — so a member swapped out stayed listed beside his replacement: sixteen rows
// for a 15-base war. Every base below him was numbered one too low, and he
// counted as a player who missed his attack. For one of OURS that is a missed
// attack on the report, an attack "left" on the dashboard, and a push reminder
// to a member who is not in the war.
//
// 019 says a roster is fixed once the war starts. It is; what it is not is
// fixed when it is first written.
//
// So after a lineup is written, whoever is stored for that side and no longer
// listed is soft-deleted, and whoever is back has it cleared. deleted_at, never
// a DELETE: every reader already filters on it, and the row can be put back.
//
// THE GUARD is that the API lists exactly teamSize members for the side. That
// is what a real lineup looks like; a short, long or repeated list is "the API
// returned something unexpected", and R5 says to change nothing because of it.
// It runs only for a war not yet settled — a finished war is never written
// again, by this or anything else.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Who has left one side's lineup, and who is back. Pure — exported for the
 * test.
 *
 * `stored` is every row recorded for that side, soft-deleted ones included;
 * `current` is who the API lists now. Nothing changes unless `current` is
 * exactly a team: see THE GUARD above.
 */
export function lineupChanges(
  stored: ReadonlyArray<{ key: string; deleted: boolean }>,
  current: readonly string[],
  teamSize: number | undefined,
): { left: string[]; back: string[] } {
  const listed = new Set(current);
  if (teamSize === undefined || current.length !== teamSize || listed.size !== teamSize) {
    return { left: [], back: [] };
  }
  return {
    left: stored.filter((r) => !r.deleted && !listed.has(r.key)).map((r) => r.key),
    back: stored.filter((r) => r.deleted && listed.has(r.key)).map((r) => r.key),
  };
}

/**
 * Bring our roster for one war into line with the API's lineup. Returns how
 * many left and how many came back.
 *
 * A member with an attack in this war is never taken off it, whatever the
 * lineup says: he played, and the attack would be orphaned.
 */
async function reconcileRoster(
  supabase: SupabaseClient,
  warId: string,
  members: WarMember[],
  playerIds: Map<string, string>,
  teamSize: number | undefined,
): Promise<{ left: number; back: number }> {
  const current = members.flatMap((m) => {
    const id = playerIds.get(m.tag);
    return id ? [id] : [];
  });
  // Someone could not be resolved: the list is not the lineup, so it decides nothing.
  if (current.length !== members.length) return { left: 0, back: 0 };

  const { data, error } = await supabase
    .from("cwl_war_members")
    .select("player_id, deleted_at")
    .eq("war_id", warId);
  if (error) throw new Error(`cwl_war_members read failed: ${error.message}`);
  const stored = ((data ?? []) as Array<{ player_id: string; deleted_at: string | null }>).map((r) => ({
    key: r.player_id,
    deleted: r.deleted_at !== null,
  }));

  const changes = lineupChanges(stored, current, teamSize);
  let left = changes.left;
  if (left.length) {
    const { data: attacked, error: attackError } = await supabase
      .from("cwl_attacks")
      .select("player_id")
      .eq("war_id", warId)
      .in("player_id", left)
      .is("deleted_at", null);
    if (attackError) throw new Error(`cwl_attacks read failed: ${attackError.message}`);
    const played = new Set(((attacked ?? []) as Array<{ player_id: string }>).map((r) => r.player_id));
    left = left.filter((id) => !played.has(id));
  }

  if (left.length) {
    const { error: leftError } = await supabase
      .from("cwl_war_members")
      .update({ deleted_at: new Date().toISOString() })
      .eq("war_id", warId)
      .in("player_id", left);
    if (leftError) throw new Error(`cwl_war_members could not be reconciled: ${leftError.message}`);
  }
  if (changes.back.length) {
    const { error: backError } = await supabase
      .from("cwl_war_members")
      .update({ deleted_at: null })
      .eq("war_id", warId)
      .in("player_id", changes.back);
    if (backError) throw new Error(`cwl_war_members could not be restored: ${backError.message}`);
  }
  return { left: left.length, back: changes.back.length };
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

// ─────────────────────────────────────────────────────────────────────────────
// THE REST OF THE GROUP (048)
//
// Standings decide the medals, and standings need all 28 wars — our 7 and the
// 21 between the other clans. Each is fetched until it ends and never again
// (the same rule storedWars() applies to ours), so a season costs about 28
// extra calls in total, not 21 a run. Wars fetched while looking for ours in a
// new round are recorded on the way past rather than asked for twice.
//
// A failure here is logged, never thrown: our own wars — the data that cannot
// be re-fetched and that missed attacks depend on — are already written by the
// time this runs, and the next run fills any gap while the season lasts.
// ─────────────────────────────────────────────────────────────────────────────

async function upsertGroupClans(
  supabase: SupabaseClient,
  seasonId: string,
  group: ApiCwlGroup,
): Promise<void> {
  const rows = group.clans.map((c) => ({
    season_id: seasonId,
    clan_tag: normaliseTag(c.tag),
    name: c.name ?? null,
    badge_url: c.badgeUrls?.medium ?? c.badgeUrls?.small ?? null,
    clan_level: c.clanLevel ?? null,
  }));
  if (!rows.length) return;
  const { error } = await supabase
    .from("cwl_group_clans")
    .upsert(rows, { onConflict: "season_id,clan_tag", ignoreDuplicates: false });
  if (error) throw new Error(`cwl_group_clans upsert failed: ${error.message}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SCOUTING (057)
//
// Who each clan registered, who it actually fielded each day, and the one
// attack each of them made. All of it rides on responses fetched above for
// standings, so it costs no call of its own — and all of it is gone when the
// season ends. Like the rest of the group, a failure here warns and never
// costs our own wars.
// ─────────────────────────────────────────────────────────────────────────────

/** Rows per upsert, well under PostgREST's body limit. */
const MEMBER_BATCH = 200;

async function upsertInBatches(
  supabase: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  ignoreDuplicates: boolean,
): Promise<void> {
  for (let i = 0; i < rows.length; i += MEMBER_BATCH) {
    const { error } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + MEMBER_BATCH), { onConflict, ignoreDuplicates });
    if (error) throw new Error(`${table} upsert failed: ${error.message}`);
  }
}

/** The registered rosters. Pure — exported for the test. */
export function groupMemberRows(seasonId: string, rosters: readonly CwlGroupRoster[]) {
  return rosters.flatMap((roster) =>
    roster.members.map((m) => ({
      season_id: seasonId,
      clan_tag: roster.clanTag,
      tag: m.tag,
      name: m.name ?? null,
      th_level: m.thLevel ?? null,
    })),
  );
}

/**
 * Refreshed every run while the season is on — a Town Hall upgraded mid-week is
 * the current fact, not a rewrite of history.
 *
 * Not written at all once the group has ended: a finished week's rosters are
 * of no further use, and 058 lets the admin clear them. The daily catch-up runs
 * of days 15–28 still read the ended group, and would otherwise put back every
 * roster the admin just cleared.
 */
async function upsertGroupMembers(
  supabase: SupabaseClient,
  seasonId: string,
  rosters: readonly CwlGroupRoster[],
  groupState: string | undefined,
): Promise<void> {
  if (groupState === "ended") return;
  const rows = groupMemberRows(seasonId, rosters);
  if (!rows.length) return;
  await upsertInBatches(supabase, "cwl_group_members", rows, "season_id,tag", false);
}

/**
 * Both lineups of one group war, with each member's attack inline (CWL gives
 * one). Pure — exported for the test. A side without a tag is skipped, as
 * upsertGroupWar skips the whole war.
 */
export function groupWarMemberRows(seasonId: string, warTag: string, war: War) {
  return [war.clan, war.opponent].flatMap((side) => {
    if (!side?.tag) return [];
    const clanTag = side.tag;
    return side.members.map((m) => {
      const attack = m.attacks[0];
      return {
        season_id: seasonId,
        war_tag: warTag,
        clan_tag: clanTag,
        tag: m.tag,
        name: m.name ?? null,
        th_level: m.thLevel ?? null,
        map_position: m.mapPosition ?? null,
        attack_stars: attack?.stars ?? null,
        attack_destruction: attack?.destruction ?? null,
        attack_defender_tag: attack?.defenderTag ?? null,
        // 062 — when in the war it came. The rating reads which of two attacks
        // on one base was the first.
        attack_order: attack?.order ?? null,
        // Listed now, so in the lineup now: a member who was swapped out and
        // is back has his soft delete cleared by the upsert itself.
        deleted_at: null,
      };
    });
  });
}

/**
 * Soft-delete whoever is stored for a side of one group war and no longer in
 * its lineup (see WHO LEFT A LINEUP). The upsert before this has already
 * restored anyone who is back. Returns how many left.
 */
async function reconcileGroupLineups(
  supabase: SupabaseClient,
  seasonId: string,
  warTag: string,
  war: War,
): Promise<number> {
  const { data, error } = await supabase
    .from("cwl_group_war_members")
    .select("clan_tag, tag")
    .eq("season_id", seasonId)
    .eq("war_tag", warTag)
    .is("deleted_at", null);
  if (error) throw new Error(`cwl_group_war_members read failed for ${warTag}: ${error.message}`);
  const stored = (data ?? []) as Array<{ clan_tag: string; tag: string }>;

  const left = [war.clan, war.opponent].flatMap((side) => {
    if (!side?.tag) return [];
    const clanTag = side.tag;
    return lineupChanges(
      stored.filter((r) => r.clan_tag === clanTag).map((r) => ({ key: r.tag, deleted: false })),
      side.members.map((m) => m.tag),
      war.teamSize,
    ).left;
  });
  if (!left.length) return 0;

  const { error: leftError } = await supabase
    .from("cwl_group_war_members")
    .update({ deleted_at: new Date().toISOString() })
    .eq("season_id", seasonId)
    .eq("war_tag", warTag)
    .in("tag", left);
  if (leftError) throw new Error(`cwl_group_war_members could not be reconciled for ${warTag}: ${leftError.message}`);
  console.log(`  group war ${warTag}: ${left.length} left the lineup`);
  return left.length;
}

/**
 * Write one war's lineups and flag the war as captured.
 *
 * `settled` — the war was already stored as ended, so this is the one-off
 * backfill of a war recorded before 057: missing rows are added and nothing
 * existing is touched (R5). A live war's rows are refreshed as attacks land.
 */
async function upsertGroupWarMembers(
  supabase: SupabaseClient,
  seasonId: string,
  warTag: string,
  war: War,
  settled: boolean,
): Promise<void> {
  const rows = groupWarMemberRows(seasonId, warTag, war);
  if (!rows.length) return;
  await upsertInBatches(supabase, "cwl_group_war_members", rows, "season_id,war_tag,tag", settled);
  // A settled war is only ever added to (R5); a live one is brought into line.
  if (!settled) await reconcileGroupLineups(supabase, seasonId, warTag, war);

  const { error } = await supabase
    .from("cwl_group_wars")
    .update({ members_captured_at: new Date().toISOString() })
    .eq("season_id", seasonId)
    .eq("war_tag", warTag);
  if (error) throw new Error(`cwl_group_wars lineup flag failed for ${warTag}: ${error.message}`);
}

/**
 * Group wars whose lineups are already recorded, or null when 057 is not
 * applied — in which case lineups are simply not captured this run.
 */
async function groupWarsWithMembers(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from("cwl_group_wars")
    .select("war_tag")
    .eq("season_id", seasonId)
    .not("members_captured_at", "is", null)
    .is("deleted_at", null);
  if (error) return null;
  return new Set(((data ?? []) as Array<{ war_tag: string }>).map((r) => r.war_tag));
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTACK ORDER FOR WARS ALREADY SETTLED (062)
//
// A live war's lineup rows are refreshed every run, so they pick the order up
// by themselves. A war already stored as ended is never written again — which
// is right for its stars, and leaves its order empty for ever. So for OUR ended
// wars (seven at most, the only ones the rating reads) the war is asked for
// once more and the empty order filled in.
//
// ONLY THE ORDER, AND ONLY WHERE IT IS EMPTY. The rows sent carry the key and
// attack_order and nothing else, so a settled star count cannot be rewritten by
// this even if the API answered differently today (R5). Like the league stamp
// on the season: a missing fact added, not history changed.
// ─────────────────────────────────────────────────────────────────────────────

/** Recorded attacks of the wars named that have no order yet, by war tag. */
async function attacksMissingOrder(
  supabase: SupabaseClient,
  seasonId: string,
  warTags: readonly string[],
): Promise<Map<string, Array<{ tag: string; clanTag: string }>>> {
  const missing = new Map<string, Array<{ tag: string; clanTag: string }>>();
  if (!warTags.length) return missing;
  const { data, error } = await supabase
    .from("cwl_group_war_members")
    .select("war_tag, clan_tag, tag")
    .eq("season_id", seasonId)
    .in("war_tag", [...warTags])
    .not("attack_stars", "is", null)
    .is("attack_order", null)
    .is("deleted_at", null);
  // Before 062 the column does not exist: nothing to fill, and not an error.
  if (error) return missing;
  for (const row of (data ?? []) as Array<{ war_tag: string; clan_tag: string; tag: string }>) {
    const list = missing.get(row.war_tag) ?? [];
    list.push({ tag: row.tag, clanTag: row.clan_tag });
    missing.set(row.war_tag, list);
  }
  return missing;
}

/** attacker tag -> the API's order, for both sides of one war. Pure — exported for the test. */
export function attackOrders(war: War): Map<string, number> {
  const orders = new Map<string, number>();
  for (const side of [war.clan, war.opponent]) {
    for (const member of side?.members ?? []) {
      const order = member.attacks[0]?.order;
      if (order !== undefined) orders.set(member.tag, order);
    }
  }
  return orders;
}

/**
 * Fill the empty attack orders of our ended wars. Returns how many wars it had
 * to ask the API for, which is the whole cost: at most seven, once.
 */
async function backfillAttackOrders(
  supabase: SupabaseClient,
  seasonId: string,
  ourEndedTags: readonly string[],
): Promise<number> {
  const missing = await attacksMissingOrder(supabase, seasonId, ourEndedTags);
  let asked = 0;
  for (const [warTag, rows] of missing) {
    const orders = attackOrders(mapWar(await request(cwlWarEndpoint(warTag), warSchema)));
    asked += 1;
    const fill = rows.flatMap((row) => {
      const order = orders.get(row.tag);
      return order === undefined
        ? []
        : [{ season_id: seasonId, war_tag: warTag, clan_tag: row.clanTag, tag: row.tag, attack_order: order }];
    });
    if (fill.length) {
      await upsertInBatches(supabase, "cwl_group_war_members", fill, "season_id,war_tag,tag", false);
    }
  }
  return asked;
}

/** Group wars already recorded this season: war tag -> state. */
async function storedGroupWars(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<Map<string, string | null>> {
  const { data, error } = await supabase
    .from("cwl_group_wars")
    .select("war_tag, state")
    .eq("season_id", seasonId)
    .is("deleted_at", null);
  if (error) throw new Error(`cwl_group_wars read failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ war_tag: string; state: string | null }>;
  return new Map(rows.map((r) => [r.war_tag, r.state]));
}

/**
 * One war of the group, in the API's own side order.
 *
 * Keyed on the tag the GROUP listed, not the war's own warTag: the group is
 * the index this table mirrors, and the round the tag sits in is its day.
 */
async function upsertGroupWar(
  supabase: SupabaseClient,
  seasonId: string,
  warTag: string,
  war: War,
  dayNumber: number | undefined,
): Promise<boolean> {
  const { clan, opponent } = war;
  if (!clan?.tag || !opponent?.tag) return false;

  const { error } = await supabase.from("cwl_group_wars").upsert(
    [
      {
        season_id: seasonId,
        war_tag: warTag,
        day_number: dayNumber ?? null,
        state: storedState(war.state),
        team_size: war.teamSize ?? null,
        clan_tag: clan.tag,
        opponent_tag: opponent.tag,
        clan_stars: clan.stars ?? null,
        opponent_stars: opponent.stars ?? null,
        clan_destruction: clan.destruction ?? null,
        opponent_destruction: opponent.destruction ?? null,
        clan_attacks: clan.attackCount ?? null,
        opponent_attacks: opponent.attackCount ?? null,
        start_time: war.startTime?.toISOString() ?? null,
        end_time: war.endTime?.toISOString() ?? null,
      },
    ],
    { onConflict: "season_id,war_tag", ignoreDuplicates: false },
  );
  if (error) throw new Error(`cwl_group_wars upsert failed for ${warTag}: ${error.message}`);
  return true;
}

/**
 * Group war tags still worth a call: every real tag not yet stored as ended
 * and not already fetched this run. Exported so the call budget is tested.
 *
 * `withMembers` (057) — wars whose lineups are recorded. An ended war missing
 * from it is asked for once more, so a season already under way when 057 went
 * live still gets its lineups: about 28 calls, once. Null when lineups are not
 * being captured, which leaves the budget exactly as it was.
 */
export function groupTagsToFetch(
  group: ApiCwlGroup,
  stored: ReadonlyMap<string, string | null>,
  fetchedThisRun: ReadonlySet<string>,
  withMembers: ReadonlySet<string> | null = null,
): string[] {
  const tags: string[] = [];
  for (const round of group.rounds) {
    for (const raw of round.warTags) {
      if (!raw || raw === "#0") continue;
      const tag = normaliseTag(raw);
      if (fetchedThisRun.has(tag)) continue;
      const settled = stored.get(tag) === "warEnded";
      if (settled && (!withMembers || withMembers.has(tag))) continue;
      tags.push(tag);
    }
  }
  return tags;
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
      const seasonId = await upsertSeason(supabase, clan, mapped.season, group.state);
      const stored = await storedWars(supabase, seasonId);
      // The group is secondary to our own wars, so none of it may stop them
      // being captured — the API deletes them when the season ends. If 048 is
      // missing, or a group write fails, this run captures ours and warns.
      const groupWarn = (what: string, error: unknown) =>
        console.warn(`  ${clan.tag}: ${what} — ${error instanceof Error ? error.message : String(error)}`);
      let groupOk = true;
      await upsertGroupClans(supabase, seasonId, group).catch((error: unknown) => {
        groupOk = false;
        groupWarn("group clans not captured", error);
      });
      // 057 — scouting rides on the group. Null when it cannot be written, which
      // leaves standings, and our wars, exactly as before.
      let withMembers = groupOk ? await groupWarsWithMembers(supabase, seasonId) : null;
      if (withMembers) {
        await upsertGroupMembers(supabase, seasonId, mapped.rosters, group.state).catch(
          (error: unknown) => {
            withMembers = null;
            groupWarn("group rosters not captured", error);
          },
        );
      }
      const groupStored = groupOk
        ? await storedGroupWars(supabase, seasonId).catch((error: unknown) => {
            groupOk = false;
            groupWarn("group wars not readable", error);
            return new Map<string, string | null>();
          })
        : new Map<string, string | null>();
      // Every war fetched this run, ours or not, by the tag the group listed.
      const fetched = new Set<string>();
      const captureLineup = async (tag: string, war: War) => {
        if (!withMembers) return;
        const settled = groupStored.get(tag) === "warEnded";
        if (settled && withMembers.has(tag)) return;
        try {
          // Not counted in records_written, which stays "our roster and
          // attacks" — the number the CWL health checks are read against.
          await upsertGroupWarMembers(supabase, seasonId, tag, war, settled);
          withMembers.add(tag);
        } catch (error) {
          groupWarn(`group war ${tag} lineups not captured`, error);
        }
      };
      const settled = new Set(
        [...stored].filter(([, war]) => war.state === "warEnded").map(([tag]) => tag),
      );

      let ourWars = 0;
      for (const round of tagsToFetch(group, stored)) {
        for (const requestedTag of round) {
          if (settled.has(requestedTag)) continue;

          const war = mapWar(await request(cwlWarEndpoint(requestedTag), warSchema));
          fetched.add(requestedTag);
          if (groupOk && groupStored.get(requestedTag) !== "warEnded") {
            await upsertGroupWar(supabase, seasonId, requestedTag, war, days.get(requestedTag)).catch(
              (error: unknown) => groupWarn(`group war ${requestedTag} not captured`, error),
            );
          }
          if (groupOk) await captureLineup(requestedTag, war);
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
          // After the attacks, so a member who played is seen to have played.
          // Never allowed to cost the capture above: it warns and tries again
          // next run.
          await reconcileRoster(supabase, warId, sides.ours.members, playerIds, war.teamSize)
            .then(({ left, back }) => {
              if (left || back) {
                console.log(`  ${clan.tag}: day ${days.get(requestedTag) ?? "?"} — ${left} left our lineup, ${back} back in it`);
              }
            })
            .catch((error: unknown) => groupWarn("our roster not reconciled", error));

          // One war per round is ours. Found it — the rest of the round is other
          // clans' business and not worth a call.
          break;
        }
      }

      // 062 — the order of attacks in our wars that were settled before it was
      // recorded. While the week runs only: afterwards the API has nothing to
      // ask. A failure warns and is tried again next run.
      if (withMembers && group.state !== "ended") {
        await backfillAttackOrders(supabase, seasonId, [...settled]).catch((error: unknown) =>
          groupWarn("attack order not backfilled", error),
        );
      }

      // The rest of the group, after ours are safely written.
      let groupWars = 0;
      for (const tag of groupOk ? groupTagsToFetch(group, groupStored, fetched, withMembers) : []) {
        try {
          const war = mapWar(await request(cwlWarEndpoint(tag), warSchema));
          // A war stored as ended is here only for its lineups (the backfill):
          // its scores are settled and are not written again (R5).
          if (groupStored.get(tag) !== "warEnded") {
            if (await upsertGroupWar(supabase, seasonId, tag, war, days.get(tag))) groupWars += 1;
          }
          await captureLineup(tag, war);
        } catch (error) {
          console.warn(
            `  ${clan.tag}: group war ${tag} not captured this run — ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      console.log(
        `  ${clan.tag} ${clan.name}: season ${mapped.season}, ` +
          `${ourWars} of our wars from ${mapped.warTags.length} in the group` +
          (groupWars ? `, ${groupWars} other group war(s) refreshed` : ""),
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

// The file name exactly, as players.ts does: cwl-scout.ts also contains "cwl",
// and a substring match would start a CWL sync from inside the scouting job.
if (/[\\/]cwl\.ts$/.test(process.argv[1] ?? "")) {
  void main("cwl", syncCwl);
}
