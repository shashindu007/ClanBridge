// 053 — storage figures and thinning old readings, for the admin page.
//
// Every call here is a definer function that checks for the platform admin
// itself. The page decides what to render; the database decides what happens.

import type { SupabaseClient } from "@supabase/supabase-js";

/** The months-kept choices the page offers. 053 refuses anything below 3. */
export const KEEP_MONTH_CHOICES = [3, 4, 6, 12] as const;

/** The free tier's database limit, for the "x of 500 MB" line. */
export const FREE_TIER_BYTES = 500 * 1024 * 1024;

export interface TableSize {
  name: string;
  bytes: number;
  /** Postgres's estimate, refreshed by autovacuum; null for the database row. */
  rows: number | null;
}

/** '(database)' first, then every table, largest first. Empty for a non-admin. */
export async function storageUsage(supabase: SupabaseClient): Promise<TableSize[]> {
  const { data, error } = await supabase.rpc("storage_usage");
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) => ({
    name: r.name as string,
    // bigint arrives as a number from PostgREST and as a string from PGlite.
    bytes: Number(r.bytes),
    rows: r.row_estimate === null ? null : Number(r.row_estimate),
  }));
}

export interface RetentionState {
  thinnedUntil: string | null;
  keepMonths: number | null;
  lastRunAt: string | null;
  lastRemoved: { snapshots: number; progress: number; syncRuns: number } | null;
}

export async function retentionState(supabase: SupabaseClient): Promise<RetentionState | null> {
  const { data, error } = await supabase
    .from("data_retention")
    .select("thinned_until, keep_months, last_run_at, last_removed")
    .maybeSingle();
  if (error || !data) return null;
  const removed = data.last_removed as RetentionState["lastRemoved"] | null;
  return {
    thinnedUntil: (data.thinned_until as string | null) ?? null,
    keepMonths: (data.keep_months as number | null) ?? null,
    lastRunAt: (data.last_run_at as string | null) ?? null,
    lastRemoved: removed
      ? { snapshots: removed.snapshots, progress: removed.progress, syncRuns: removed.syncRuns }
      : null,
  };
}

/** Thin the oldest month not yet thinned. `more` when older months remain. */
export async function thinOldData(
  supabase: SupabaseClient,
  keepMonths: number,
): Promise<{ ok: true; more: boolean } | { ok: false; error: { message?: unknown } }> {
  const { data, error } = await supabase.rpc("thin_old_data", { p_keep_months: keepMonths });
  if (error) return { ok: false, error };
  const row = (data as Array<{ more: boolean }> | null)?.[0];
  return { ok: true, more: row?.more === true };
}
