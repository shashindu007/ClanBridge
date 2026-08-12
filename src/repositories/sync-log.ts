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

/** As SyncRun, plus the identity a history table needs to key and group rows. */
export interface SyncRunRecord extends SyncRun {
  id: string;
  clanId: string | null;
}

const RUN_COLUMNS =
  "id, job_type, clan_id, status, started_at, finished_at, skip_reason, error, records_written";

function toRun(row: Record<string, unknown>): SyncRunRecord {
  return {
    id: row.id as string,
    jobType: row.job_type as string,
    clanId: (row.clan_id as string | null) ?? null,
    status: row.status as string,
    startedAt: row.started_at as string,
    finishedAt: (row.finished_at as string | null) ?? null,
    skipReason: (row.skip_reason as string | null) ?? null,
    error: (row.error as string | null) ?? null,
    recordsWritten: (row.records_written as number | null) ?? null,
  };
}

/**
 * T9.2 — the most recent runs of every job, newest first.
 *
 * UNFILTERED BY JOB TYPE AND BY CLAN, deliberately, and RLS is what scopes it.
 * 006's sync_log policy already returns only rows for clans the caller belongs
 * to, plus the global ones; re-stating that here as an explicit filter would
 * mean a platform admin — who legitimately sees every clan — silently got a
 * narrower answer than the policy grants them.
 *
 * Descending, which is the whole reason this is not `latestRun()` in a loop:
 * ascending plus a limit returns the OLDEST N, which is exactly the opposite of
 * a history page and fails silently because it still returns rows.
 *
 * `limit` is applied before `order` because the PGlite stand-in the tests use
 * runs the query on `.order()` — legal in supabase-js too, and the note in
 * test/pglite-supabase.ts explains why it has to be this way round.
 */
export async function recentRuns(
  supabase: SupabaseClient,
  limit = 50,
): Promise<SyncRunRecord[]> {
  const { data, error } = await supabase
    .from("sync_log")
    .select(RUN_COLUMNS)
    .is("deleted_at", null)
    .limit(limit)
    .order("started_at", { ascending: false });

  if (error || !data) return [];
  return (data as unknown as Array<Record<string, unknown>>).map(toRun);
}

/**
 * Runs that ended badly and are still worth someone's attention.
 *
 * Derived from the same read rather than a second query: a "failed" list that
 * disagrees with the history table directly above it on the same page is worse
 * than either alone, and two queries against a table being written to by a live
 * sync job can absolutely disagree.
 *
 * A row still `running` is not a failure and is not listed. It becomes one only
 * by being old, which is `staleJobs()` in scripts/sync/alerts.ts (T5.8) — the
 * check that runs from outside and does not wait to be looked at.
 */
export function failedRuns(runs: readonly SyncRunRecord[]): SyncRunRecord[] {
  return runs.filter((r) => r.status === "failed");
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
