// The member's saved in-game village export (076).
//
// ─────────────────────────────────────────────────────────────────────────────
// R3, AND WHY THE FILTER HERE IS NOT A CLAN
//
// account-bases.ts says it at length: "the villages this member proved they own"
// is not a clan-shaped question. An export belongs to its owner, and 076's
// policies admit only rows about villages whose user_id is the caller. So the
// reads filter by the player ids the page has already gated on basesForUser(),
// and the policy is the net. Leaders never see these rows, by design.
//
// R11 — this is a HUMAN-SUPPLIED copy of game data. It is written only here, by
// the owner, and never merged into player_progress. 076's header has the whole
// argument.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRead } from "@/lib/errors";
import { refreshVillage } from "@/integration/village-export";
import type { WriteResult } from "@/repositories/account-bases";
import type { ExportedVillage } from "@/types/village";

export interface SavedExport {
  village: ExportedVillage;
  /** When the game took the export. Timers count from here. */
  exportedAt: string;
  /** When the member last saved it here. */
  savedAt: string;
  /** 079's optimistic lock: a fold writes only if this has not moved. */
  revision: number;
}

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

/**
 * jsonb arrives parsed. Guarded rather than trusted, as player-progress.ts's
 * toReading() is, so one malformed row reads as "nothing saved" instead of
 * crashing Home.
 */
function toVillage(value: unknown): ExportedVillage | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ExportedVillage>;
  if (typeof v.tag !== "string" || typeof v.exportedAt !== "string") return null;
  // Read against TODAY's game data, not the data it was saved with: a game
  // update (TH19) must not need every member to upload again.
  return refreshVillage({
    tag: v.tag,
    exportedAt: v.exportedAt,
    thLevel: typeof v.thLevel === "number" ? v.thLevel : null,
    bhLevel: typeof v.bhLevel === "number" ? v.bhLevel : null,
    buildings: Array.isArray(v.buildings) ? v.buildings : [],
    units: Array.isArray(v.units) ? v.units : [],
    upgrades: Array.isArray(v.upgrades) ? v.upgrades : [],
    unknownIds: typeof v.unknownIds === "number" ? v.unknownIds : 0,
    thWeapon: typeof v.thWeapon === "number" ? v.thWeapon : null,
    appliedSince: typeof v.appliedSince === "number" ? v.appliedSince : 0,
  });
}

/** Each village's saved export, in one read however many there are. */
export async function villageExportsFor(
  supabase: SupabaseClient,
  playerIds: readonly string[],
): Promise<Map<string, SavedExport>> {
  const out = new Map<string, SavedExport>();
  const ids = [...new Set(playerIds)];
  if (!ids.length) return out;

  const { data, error } = await supabase
    .from("village_exports")
    .select("player_id, exported_at, village, created_at, updated_at, revision")
    .in("player_id", ids) // the mechanism; 076's owner policy is the net
    .is("deleted_at", null);

  assertRead(error, "village_exports");

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const village = toVillage(row.village);
    if (!village) continue;
    out.set(row.player_id as string, {
      village,
      exportedAt: iso(row.exported_at),
      savedAt: iso(row.updated_at ?? row.created_at),
      revision: typeof row.revision === "number" ? row.revision : 0,
    });
  }
  return out;
}

/**
 * Save or replace one base's export. ONE STATEMENT on the full unique index, as
 * account-bases.ts's setNickname() — it also revives a removed export (R4).
 */
export async function saveVillageExport(
  supabase: SupabaseClient,
  playerId: string,
  userId: string,
  village: ExportedVillage,
): Promise<WriteResult> {
  const { error } = await supabase.from("village_exports").upsert(
    {
      player_id: playerId,
      uploaded_by: userId,
      exported_at: village.exportedAt,
      th_level: village.thLevel,
      bh_level: village.bhLevel,
      village,
      deleted_at: null,
    },
    { onConflict: "player_id" },
  );

  return { error };
}

/** Remove the saved export. A soft delete (R4); a second call is a no-op. */
export async function clearVillageExport(
  supabase: SupabaseClient,
  playerId: string,
): Promise<WriteResult> {
  const { error } = await supabase
    .from("village_exports")
    .update({ deleted_at: new Date().toISOString() })
    .eq("player_id", playerId)
    .is("deleted_at", null);

  return { error };
}
