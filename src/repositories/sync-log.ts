// T4.8 — reading sync_log, so a page can say how fresh its data is.
//
// Until now sync_log was write-only: scripts/sync/shared.ts opens a row at the
// start of a job and closes it at the end, and nothing ever read one back. A
// record nobody reads catches nothing — the point of R9 is that a job which dies
// during CWL week is noticed before the season is gone.
//
// R3 — sync_log rows are either clan-scoped or global (clan_id null, e.g. the
// backup job). The policy in 006 allows both; a caller asking about one clan
// gets that clan's rows and the global ones, never another clan's.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SyncRun {
  jobType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  skipReason: string | null;
  error: string | null;
  recordsWritten: number | null;
}

/**
 * The most recent FINISHED run of one job type for one clan.
 *
 * "Finished" matters: a job that is still running, or one that died without
 * closing its row, must not be reported as fresh data. Both leave finished_at
 * null, so both are excluded and the page falls back to the last run that
 * actually completed — which is the honest answer.
 *
 * A skipped run counts as finished and current. R10: three weeks of every month
 * "no CWL group" is the correct, successful outcome, and treating it as staleness
 * would light the indicator red for most of the year.
 */
export async function latestRun(
  supabase: SupabaseClient,
  jobType: string,
  clanId: string,
): Promise<SyncRun | null> {
  const { data, error } = await supabase
    .from("sync_log")
    .select(
      "job_type, clan_id, status, started_at, finished_at, skip_reason, error, records_written",
    )
    .eq("job_type", jobType)
    .is("deleted_at", null)
    .order("started_at");

  if (error || !data) return null;

  const rows = data as unknown as Array<Record<string, unknown>>;

  // R3, done honestly rather than decoratively. sync:cwl covers all three clans
  // in one pass and so writes clan_id = null; a per-clan job writes its own id.
  // Both are legitimately "this clan's freshness", and another clan's row is
  // not — which is precisely what the policy in 006 says, restated here in the
  // query rather than left entirely to RLS.
  //
  // Expressed in TypeScript because this is an OR across two columns and
  // PostgREST's .or() is not supported by the PGlite stand-in the tests use.
  const mine = rows.filter((r) => r.clan_id === null || r.clan_id === clanId);

  const finished = mine.filter((r) => r.finished_at !== null);
  const row = finished[finished.length - 1]; // .order() here is ascending only
  if (!row) return null;

  return {
    jobType: row.job_type as string,
    status: row.status as string,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    skipReason: (row.skip_reason as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    recordsWritten: (row.records_written as number | null) ?? null,
  };
}
