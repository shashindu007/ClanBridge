// T11B.8 — reads behind "Base details".
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO SCOPES, AND WHICH ONE IS R3
//
//   { clanId }  a leader looking at a member through the directory. Filtered by
//               clan explicitly, exactly as README.md asks: the mechanism is the
//               .eq(), and 036's clan policy is the net. A reading taken while
//               the village was in ANOTHER clan does not appear, which is the
//               point.
//
//   "owner"     a member looking at their own village from /account. NOT
//               clan-filtered, and account-bases.ts is the precedent that says
//               why at length: "the villages this member proved they own" is not
//               a clan-shaped question, and a village outside every platform clan
//               has clan_id null, which no clan filter can ever match. The page
//               has already gated on basesForUser(); 036's owner policy is the
//               net, and it only ever returns rows about villages whose user_id
//               is the caller.
//
// The scope is a required parameter rather than an optional clanId, so a caller
// cannot drop the clan filter by forgetting an argument — it has to write
// "owner", which is visible at the call site and in review.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import type { StoredUnit } from "@/services/progress";

export type ProgressScope = { clanId: string } | "owner";

export interface ProgressReading {
  capturedAt: string;
  thLevel: number | null;
  thWeaponLevel: number | null;
  bhLevel: number | null;
  units: StoredUnit[];
}

export interface BaseProgress {
  /** The newest reading, or null when the sync has never read this village. */
  latest: ProgressReading | null;
  /**
   * The OLDEST reading inside the comparison window, for "upgraded lately".
   * Null when there is no second reading to compare against.
   */
  baseline: ProgressReading | null;
}

/** How far back "upgraded lately" looks. */
export const UPGRADE_WINDOW_DAYS = 30;

const COLUMNS = "captured_at, th_level, th_weapon_level, bh_level, units";

function toReading(row: Record<string, unknown>): ProgressReading {
  return {
    // PostgREST sends an ISO string; the PGlite stand-in sends a Date. Normalised
    // so the page's date formatting sees one shape.
    capturedAt:
      row.captured_at instanceof Date
        ? row.captured_at.toISOString()
        : new Date(String(row.captured_at)).toISOString(),
    thLevel: (row.th_level as number | null) ?? null,
    thWeaponLevel: (row.th_weapon_level as number | null) ?? null,
    bhLevel: (row.bh_level as number | null) ?? null,
    // jsonb arrives parsed from PostgREST. Guarded rather than trusted, so one
    // malformed row renders as an empty reading instead of crashing the page.
    units: Array.isArray(row.units) ? (row.units as StoredUnit[]) : [],
  };
}

/**
 * The newest reading of one village, and the oldest inside the window.
 *
 * Two small queries in parallel rather than reading the whole window: a daily
 * reading carries ~150 units, and "what changed" only ever needs the two ends.
 */
export async function baseProgress(
  supabase: SupabaseClient,
  scope: ProgressScope,
  playerId: string,
  now: Date = new Date(),
): Promise<BaseProgress> {
  const since = new Date(now.getTime() - UPGRADE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const scoped = () => {
    let query = supabase
      .from("player_progress")
      .select(COLUMNS)
      .eq("player_id", playerId)
      .is("deleted_at", null);
    if (scope !== "owner") query = query.eq("clan_id", scope.clanId); // R3
    return query;
  };

  const [newest, oldest] = await Promise.all([
    scoped().limit(1).order("captured_at", { ascending: false }),
    scoped().gte("captured_at", since.toISOString()).limit(1).order("captured_at"),
  ]);

  const latestRow = (newest.error ? null : newest.data?.[0]) as
    | Record<string, unknown>
    | undefined;
  const oldestRow = (oldest.error ? null : oldest.data?.[0]) as
    | Record<string, unknown>
    | undefined;

  const latest = latestRow ? toReading(latestRow) : null;
  const baseline = oldestRow ? toReading(oldestRow) : null;

  return {
    latest,
    // The same reading at both ends is not a comparison.
    baseline: baseline && latest && baseline.capturedAt !== latest.capturedAt ? baseline : null,
  };
}
