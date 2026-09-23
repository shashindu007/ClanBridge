// The Admin page's "Sync problems": failed runs, as PROBLEMS rather than runs.
//
// The war job runs every hour, so one clan with a private war log fails the
// same way every hour, and the panel listed the identical line fifteen times —
// five shown, ten implied, none of them saying what to do. An operator reading
// that sees fifteen problems; there is one. So identical failures (same job,
// same clan, same message) collapse into one row with a count and the time it
// last happened, and a message this platform knows the cause of carries the fix.
//
// PURE, and fed the same array as the history table (recentRuns), so the two
// can never disagree.

import type { SyncRunRecord } from "@/repositories/sync-log";

export interface SyncProblem {
  jobType: string;
  clanId: string | null;
  /** The message as stored, whitespace collapsed. */
  error: string;
  /** How many of the runs read failed this way. */
  count: number;
  /** The newest run's start — runs arrive newest first, so it is the first seen. */
  lastAt: string;
  /** What to do about it, when the cause is one this platform knows. */
  fix: string | null;
}

/**
 * Known causes, matched against the message. Each is an instruction a person
 * can follow, not a restatement of the error.
 */
const FIXES: Array<{ match: RegExp; fix: string }> = [
  {
    // scripts/sync/war.ts and cwl.ts — a 403 on a war endpoint (T0.1).
    match: /war log is private/i,
    fix: "In game, a leader opens Clan settings and sets War log to Public. The next sync picks it up.",
  },
  {
    match: /accessDenied|invalid ?ip|\b403\b/i,
    fix: "The Clash of Clans API key was refused. Check that the key allows the sync runner's IP address.",
  },
  {
    match: /rate ?limit|\b429\b/i,
    fix: "The Clash of Clans API is rate limiting the sync. It usually clears on the next run.",
  },
];

export function failureFix(error: string): string | null {
  return FIXES.find((f) => f.match.test(error))?.fix ?? null;
}

export function groupFailures(runs: readonly SyncRunRecord[]): SyncProblem[] {
  const groups = new Map<string, SyncProblem>();
  for (const run of runs) {
    if (run.status !== "failed") continue;
    const error = (run.error ?? "No error recorded").replace(/\s+/g, " ").trim();
    const key = `${run.jobType}\u0000${run.clanId ?? ""}\u0000${error}`;
    const seen = groups.get(key);
    if (seen) {
      seen.count += 1;
      if (run.startedAt > seen.lastAt) seen.lastAt = run.startedAt;
    } else {
      groups.set(key, {
        jobType: run.jobType,
        clanId: run.clanId,
        error,
        count: 1,
        lastAt: run.startedAt,
        fix: failureFix(error),
      });
    }
  }
  return [...groups.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
}
