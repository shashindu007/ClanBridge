// 057 — scouting the CWL group. A second step of sync-cwl.yml, after the
// capture, never before it.
//
// sync:cwl already records every clan's registered roster and fielded lineups
// (cwl_group_members, cwl_group_war_members) from responses it fetches anyway.
// What those do not say is how far along each village is — heroes, pets and
// equipment against THEIR Town Hall's caps. That needs one /players/{tag} per
// enemy, and there is no bulk endpoint, so it is the one part of scouting that
// costs calls. Hence its own job:
//
//   * its own sync_log type, so a bad scouting run can never fail — or alert
//     on — the CWL capture, which is the data that cannot be re-fetched;
//   * at most one reading per village per FRESH_FOR_MS: the workflow runs every
//     two hours, and all but about one run a day find nothing to do;
//   * at most MAX_CALLS a run, the next opponent's village first, so a big
//     group is finished by the following run rather than timing out this one.
//
// About 7 clans × 15–50 registered = 100–350 calls a day of league week, at the
// client's 200 ms throttle well under two minutes.
//
// ─────────────────────────────────────────────────────────────────────────────
// A SUMMARY, REFRESHED IN PLACE — NOT A SNAPSHOT
//
// player_progress (036) keeps every unit of our own villages, daily, forever:
// that history is what "what changed" is built on. Nobody needs the history of
// another clan's village, and at 10–20 KB a reading it would spend the free
// tier's 500 MB on it within months. So cwl_scout_players holds one ~0.5 KB row
// per enemy per season, overwritten by each new reading. It is a current fact
// about someone else's village, not a record of ours, which is why R5's
// insert-only rule is not the right one for it.
//
// R11 — writes cwl_scout_players, a game fact. Reads the season and group
// tables sync:cwl wrote. Never touches a player of our own clans: their
// readings are player_progress's, and they are not who is being scouted.

import type { SupabaseClient } from "@supabase/supabase-js";
import { playerEndpoint, request } from "@/integration/coc-client";
import { playerSchema } from "@/integration/coc-schemas";
import { CocNotFoundError } from "@/integration/errors";
import { mapPlayer, mapPlayerProgress } from "@/integration/mappers";
import { cwlSeason } from "@/lib/coc-time";
import { normaliseTag } from "@/lib/tags";
import { villageSnapshot } from "@/services/progress";
import type { PlayerDetail, PlayerProgress } from "@/types/domain";
import { resolveProgressUnits } from "./players";
import { activeClans, main, skip, type JobContext } from "./shared";

/** A reading younger than this is not taken again. Under a day, so the daily drift of a 2-hourly schedule cannot skip a day. */
export const FRESH_FOR_MS = 20 * 60 * 60 * 1000;

/**
 * API calls a single run may spend. Enough for a whole first run: every clan
 * of the family in CWL is a group of seven others, up to 50 registered each —
 * 3 × 7 × 50 = 1,050, about four minutes at the client's throttle. 400 was the
 * first guess, and the first live run found 587 villages due and left four
 * clans entirely unread until the next run.
 */
export const MAX_CALLS = 1200;

/** Rows per upsert. */
const BATCH = 100;

/** One village to read, and the season it is filed under. */
export interface ScoutTarget {
  seasonId: string;
  /** The clan whose CWL roster the village is on — not necessarily its clan today. */
  clanTag: string;
  tag: string;
  /** 0 our opponent on preparation day, 1 our opponent in battle, 2 the rest. */
  priority: number;
}

interface SeasonRow {
  id: string;
}

/**
 * Who to read this run, deduplicated by village.
 *
 * A village listed under two seasons — two of our clans drawn into one group —
 * is fetched once and filed under both.
 *
 * Ordered by priority, then TAKING TURNS between clans: every clan's first
 * village, then every clan's second, and so on. Clan by clan, a run cut short
 * by MAX_CALLS left the clans late in tag order with nothing at all — a "—" on
 * the Standings table — while earlier clans were complete. Taking turns, a
 * short run leaves every clan partly read instead.
 */
export function planCalls(
  targets: readonly ScoutTarget[],
  limit: number = MAX_CALLS,
): Array<{ tag: string; targets: ScoutTarget[] }> {
  const byTag = new Map<string, ScoutTarget[]>();
  for (const t of targets) {
    const list = byTag.get(t.tag);
    if (list) list.push(t);
    else byTag.set(t.tag, [t]);
  }
  const rank = (list: ScoutTarget[]) => Math.min(...list.map((t) => t.priority));
  const calls = [...byTag].map(([tag, list]) => ({ tag, targets: list, clan: list[0]!.clanTag }));

  // Each village's turn within its own clan, by tag.
  const turn = new Map<string, number>();
  const byClan = new Map<string, string[]>();
  for (const c of calls) byClan.set(c.clan, [...(byClan.get(c.clan) ?? []), c.tag]);
  for (const tags of byClan.values()) tags.sort().forEach((tag, i) => turn.set(tag, i));

  return calls
    .sort(
      (a, b) =>
        rank(a.targets) - rank(b.targets) ||
        turn.get(a.tag)! - turn.get(b.tag)! ||
        a.clan.localeCompare(b.clan),
    )
    .slice(0, limit)
    .map(({ tag, targets: list }) => ({ tag, targets: list }));
}

/** The stored shape of one reading. Pure — the test exercises it directly. */
export function scoutRow(
  target: ScoutTarget,
  detail: PlayerDetail,
  progress: PlayerProgress,
  capturedAt: Date,
) {
  const score = villageSnapshot(resolveProgressUnits(progress));
  return {
    season_id: target.seasonId,
    clan_tag: target.clanTag,
    tag: target.tag,
    name: detail.name ?? null,
    th_level: progress.thLevel ?? null,
    th_weapon_level: progress.thWeaponLevel ?? null,
    heroes: score.heroes,
    hero_pct: score.heroPct,
    pet_pct: score.petPct,
    equipment_pct: score.equipmentPct,
    offence_pct: score.offencePct,
    max_pct: score.maxPct,
    war_stars: detail.warStars ?? null,
    captured_at: capturedAt.toISOString(),
  };
}

/**
 * Every enemy village worth reading, across the current season of each clan.
 *
 * Current means this month's season whose group is still being played: no
 * wars recorded yet, or at least one not ended. A finished week is not worth a
 * call — the group can no longer be met.
 */
export async function scoutTargets(
  supabase: SupabaseClient,
  now: Date,
): Promise<{ targets: ScoutTarget[]; seasons: number }> {
  const clans = await activeClans(supabase);
  const ownTags = new Set(clans.map((c) => normaliseTag(c.tag)));
  const season = cwlSeason(now);
  const freshAfter = now.getTime() - FRESH_FOR_MS;

  const targets: ScoutTarget[] = [];
  let seasons = 0;

  for (const clan of clans) {
    const { data: seasonRows, error } = await supabase
      .from("cwl_seasons")
      .select("id")
      .eq("clan_id", clan.id) // R3
      .eq("season", season)
      .is("deleted_at", null);
    if (error) throw new Error(`cwl_seasons read failed for ${clan.tag}: ${error.message}`);
    const seasonId = (seasonRows as SeasonRow[] | null)?.[0]?.id;
    if (!seasonId) continue;

    const { data: wars, error: warsError } = await supabase
      .from("cwl_group_wars")
      .select("state")
      .eq("season_id", seasonId)
      .is("deleted_at", null);
    if (warsError) throw new Error(`cwl_group_wars read failed for ${clan.tag}: ${warsError.message}`);
    const states = ((wars ?? []) as Array<{ state: string | null }>).map((w) => w.state);
    if (states.length && states.every((s) => s === "warEnded")) continue;
    seasons += 1;

    // Our own opponent today and tomorrow, read first.
    const { data: ours, error: oursError } = await supabase
      .from("cwl_wars")
      .select("opponent_tag, state")
      .eq("season_id", seasonId)
      .in("state", ["preparation", "inWar"])
      .is("deleted_at", null);
    if (oursError) throw new Error(`cwl_wars read failed for ${clan.tag}: ${oursError.message}`);
    const priority = new Map<string, number>();
    for (const w of (ours ?? []) as Array<{ opponent_tag: string | null; state: string }>) {
      if (!w.opponent_tag) continue;
      const p = w.state === "preparation" ? 0 : 1;
      priority.set(w.opponent_tag, Math.min(p, priority.get(w.opponent_tag) ?? p));
    }

    const { data: members, error: membersError } = await supabase
      .from("cwl_group_members")
      .select("clan_tag, tag")
      .eq("season_id", seasonId)
      .is("deleted_at", null);
    if (membersError) {
      throw new Error(`cwl_group_members read failed for ${clan.tag}: ${membersError.message}`);
    }

    const { data: scouted, error: scoutedError } = await supabase
      .from("cwl_scout_players")
      .select("tag, captured_at")
      .eq("season_id", seasonId)
      .is("deleted_at", null);
    if (scoutedError) {
      throw new Error(`cwl_scout_players read failed for ${clan.tag}: ${scoutedError.message}`);
    }
    const fresh = new Set(
      ((scouted ?? []) as Array<{ tag: string; captured_at: string | Date }>)
        .filter((r) => new Date(r.captured_at).getTime() > freshAfter)
        .map((r) => r.tag),
    );

    for (const m of (members ?? []) as Array<{ clan_tag: string; tag: string }>) {
      if (ownTags.has(m.clan_tag) || fresh.has(m.tag)) continue;
      targets.push({
        seasonId,
        clanTag: m.clan_tag,
        tag: m.tag,
        priority: priority.get(m.clan_tag) ?? 2,
      });
    }
  }

  return { targets, seasons };
}

export async function syncCwlScout(ctx: JobContext, now: Date = new Date()): Promise<void> {
  const { supabase } = ctx;

  const { targets, seasons } = await scoutTargets(supabase, now);
  if (seasons === 0) skip("noCwlGroup", "no clan has a CWL week in progress");

  const calls = planCalls(targets);
  if (!calls.length) {
    skip("scoutFresh", `every village in ${seasons} group(s) read in the last 20 hours`);
  }

  const rows: Array<ReturnType<typeof scoutRow>> = [];
  const problems: string[] = [];
  let missing = 0;

  for (const call of calls) {
    try {
      const api = await request(playerEndpoint(call.tag), playerSchema);
      const detail = mapPlayer(api);
      const progress = mapPlayerProgress(api);
      for (const target of call.targets) rows.push(scoutRow(target, detail, progress, now));
    } catch (error) {
      // A banned or renamed-away village must not cost the rest of the group.
      if (error instanceof CocNotFoundError) {
        missing += 1;
        continue;
      }
      problems.push(`${call.tag}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Readings already taken are written before any failure is reported: they
  // cost calls, and the next run only retries what is still missing.
  //
  // 060 adds th_weapon_level. Deployed before it is applied, the readings are
  // still written without it rather than the whole run failing.
  let write: Array<Record<string, unknown>> = rows;
  for (let i = 0; i < write.length; i += BATCH) {
    const upsert = () =>
      supabase
        .from("cwl_scout_players")
        .upsert(write.slice(i, i + BATCH), { onConflict: "season_id,tag", ignoreDuplicates: false });
    let { error } = await upsert();
    if (error && /th_weapon_level/.test(error.message)) {
      console.warn("  th_weapon_level not stored — apply migration 060");
      write = rows.map(({ th_weapon_level: _weapon, ...rest }) => rest);
      ({ error } = await upsert());
    }
    if (error) throw new Error(`cwl_scout_players upsert failed: ${error.message}`);
  }
  ctx.recorded(rows.length);

  console.log(
    `  ${calls.length} of ${new Set(targets.map((t) => t.tag)).size} village(s) due, ` +
      `${rows.length} reading(s) written` +
      (missing ? `, ${missing} not found` : "") +
      (problems.length ? `, ${problems.length} failed` : ""),
  );

  // Only a run that read nothing at all is a failure. A handful of 5xx in a
  // run of 300 is retried by the next run; alerting on it would be noise.
  if (problems.length && !rows.length) throw new Error(problems.slice(0, 5).join("; "));
  for (const p of problems) console.warn(`  ${p}`);
}

if (/[\\/]cwl-scout\.ts$/.test(process.argv[1] ?? "")) {
  void main("cwl-scout", (ctx) => syncCwlScout(ctx));
}
