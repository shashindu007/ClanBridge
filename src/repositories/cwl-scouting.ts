// 057 — the scouting tables for one season.
//
// `seasonId` must already be clan-checked, as for every read in
// repositories/cwl.ts: the season is what ties these rows to this clan, and the
// tables' policies (057) are the net.
//
// PAGED. A 30-a-side week is 7 days × 4 wars × 60 lineup rows = 1,680 rows,
// past PostgREST's default 1,000-row page. A single select would return the
// first 1,000 and say nothing — a clan's last days would simply be missing.

import type { SupabaseClient } from "@supabase/supabase-js";
import { latestProgressFor } from "@/repositories/player-progress";
import type { HeroLevel } from "@/services/progress";
import type {
  ScoutRosterMember,
  ScoutSeason,
  ScoutVillage,
  ScoutWarMember,
} from "@/services/cwl-scouting";

const PAGE = 1000;

async function allRows(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  seasonId: string,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("season_id", seasonId)
      .is("deleted_at", null)
      .order("id")
      .range(from, from + PAGE - 1);
    // Before 057 is applied the table does not exist: no scouting, not an error page.
    if (error || !data) return out;
    out.push(...(data as unknown as Array<Record<string, unknown>>));
    if (data.length < PAGE) return out;
  }
}

/**
 * Our own registered villages, scored from player_progress (036) rather than
 * scouted — the daily players sync already reads them, so they cost no call and
 * our row sits beside the enemy's on the same scale.
 *
 * Players are looked up by tag alone: a roster member may be filed under
 * another of the family's clans. The read runs as the viewer, so 036's
 * policies decide what comes back, and a village they may not see is absent.
 */
export async function ourVillages(
  supabase: SupabaseClient,
  clanTag: string,
  tags: readonly string[],
): Promise<ScoutVillage[]> {
  if (!tags.length) return [];
  const { data, error } = await supabase.from("players").select("id, tag, name").in("tag", [...tags]);
  if (error || !data) return [];
  const players = data as Array<{ id: string; tag: string; name: string | null }>;
  const progress = await latestProgressFor(
    supabase,
    players.map((p) => p.id),
  );
  return players.flatMap((p): ScoutVillage[] => {
    const snap = progress.get(p.id);
    if (!snap) return [];
    return [
      {
        clanTag,
        tag: p.tag,
        name: p.name,
        thLevel: snap.thLevel,
        heroes: snap.heroes,
        heroPct: snap.heroPct,
        petPct: snap.petPct,
        equipmentPct: snap.equipmentPct,
        offencePct: snap.offencePct,
        maxPct: snap.maxPct,
        // latest_player_progress (051) does not return it; our own villages'
        // weapons are on their Base details page.
        thWeaponLevel: null,
        warStars: null,
        capturedAt: snap.capturedAt,
      },
    ];
  });
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function scoutingForSeason(
  supabase: SupabaseClient,
  seasonId: string,
): Promise<ScoutSeason> {
  const [roster, lineups, villages] = await Promise.all([
    allRows(supabase, "cwl_group_members", "id, clan_tag, tag, name, th_level", seasonId),
    allRows(
      supabase,
      "cwl_group_war_members",
      "id, war_tag, clan_tag, tag, name, th_level, map_position, attack_stars, attack_destruction, attack_defender_tag",
      seasonId,
    ),
    // Every column: th_weapon_level arrives with 060, and naming it before
    // that is applied would make the whole read fail and show no villages.
    allRows(supabase, "cwl_scout_players", "*", seasonId),
  ]);

  return {
    roster: roster.map(
      (r): ScoutRosterMember => ({
        clanTag: r.clan_tag as string,
        tag: r.tag as string,
        name: str(r.name),
        thLevel: num(r.th_level),
      }),
    ),
    lineups: lineups.map(
      (r): ScoutWarMember => ({
        warTag: r.war_tag as string,
        clanTag: r.clan_tag as string,
        tag: r.tag as string,
        name: str(r.name),
        thLevel: num(r.th_level),
        mapPosition: num(r.map_position),
        attackStars: num(r.attack_stars),
        attackDestruction: num(r.attack_destruction),
        attackDefenderTag: str(r.attack_defender_tag),
      }),
    ),
    villages: villages.map(
      (r): ScoutVillage => ({
        clanTag: r.clan_tag as string,
        tag: r.tag as string,
        name: str(r.name),
        thLevel: num(r.th_level),
        thWeaponLevel: num(r.th_weapon_level),
        // jsonb arrives parsed. Guarded, so one malformed row is "no heroes"
        // rather than a crashed page.
        heroes: Array.isArray(r.heroes) ? (r.heroes as HeroLevel[]) : [],
        heroPct: num(r.hero_pct),
        petPct: num(r.pet_pct),
        equipmentPct: num(r.equipment_pct),
        offencePct: num(r.offence_pct),
        maxPct: num(r.max_pct),
        warStars: num(r.war_stars),
        // PostgREST sends an ISO string; the PGlite stand-in a Date.
        capturedAt:
          r.captured_at instanceof Date
            ? r.captured_at.toISOString()
            : new Date(String(r.captured_at)).toISOString(),
      }),
    ),
  };
}
