// Everything a leader looks at to pick a CWL lineup, for many players at once:
// hero levels and progress (049, one read) and the last CWLs across the whole
// family (037, one read). The builder, its dialog and the export sheet all use
// this, so a player's numbers are the same on every one of them.

import type { SupabaseClient } from "@supabase/supabase-js";
import { familyCwlHistory } from "@/repositories/cwl";
import { latestProgressFor, type HeroLevel } from "@/repositories/player-progress";
import type { CwlSeasonLine } from "@/components/cwl-lineup";

export interface PlayerDetail {
  thLevel: number | null;
  heroes: HeroLevel[];
  maxPct: number | null;
  heroPct: number | null;
  /** Newest first, up to three. */
  history: CwlSeasonLine[];
  /** Average stars per attack over those seasons, for sorting. Null with no CWL. */
  starsPerAttack: number | null;
}

export async function playerDetails(
  supabase: SupabaseClient,
  playerIds: readonly string[],
): Promise<Map<string, PlayerDetail>> {
  const ids = [...new Set(playerIds)];
  const [progress, history] = await Promise.all([
    latestProgressFor(supabase, ids),
    familyCwlHistory(supabase, ids),
  ]);

  const out = new Map<string, PlayerDetail>();
  for (const id of ids) {
    const snap = progress.get(id);
    const seasons = (history.get(id) ?? []).slice(0, 3).map((s) => ({
      season: s.season,
      clanName: s.clanName,
      stars: s.stars,
      attacksUsed: s.attacksUsed,
      warsRostered: s.warsRostered,
    }));
    const attacks = seasons.reduce((t, s) => t + s.attacksUsed, 0);
    out.set(id, {
      thLevel: snap?.thLevel ?? null,
      heroes: snap?.heroes ?? [],
      maxPct: snap?.maxPct ?? null,
      heroPct: snap?.heroPct ?? null,
      history: seasons,
      starsPerAttack: attacks ? seasons.reduce((t, s) => t + s.stars, 0) / attacks : null,
    });
  }
  return out;
}
