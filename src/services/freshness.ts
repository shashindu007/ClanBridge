// T4.8 — "updated N minutes ago", and the threshold past which it turns red.
//
// This is the cheap half of noticing a dead sync job. It only works if somebody
// happens to look at a page; T5.8 is the half that pushes a notification without
// being asked. Both exist because a CWL sync that dies quietly on a Tuesday
// costs a season nobody can re-fetch.
//
// Pure functions over a SyncRun. No database and no clock reading beyond the
// `now` passed in, so the thresholds are testable without waiting.

import type { SyncRun } from "@/repositories/sync-log";

/** How long each job may go between successful runs before its data is suspect. */
export const STALE_AFTER_MS: Record<string, number> = {
  // Runs every 2 hours. Three hours allows a missed tick plus GitHub's habit of
  // delaying scheduled runs by up to twenty minutes.
  cwl: 3 * 60 * 60 * 1000,
  // Hourly.
  clans: 2 * 60 * 60 * 1000,
  // Hourly, as a step of sync-clans.yml — NOT every 15 minutes as first planned
  // (see the T6.2 deviation note in IMPLEMENTATION.md §0). The old 45-minute
  // window was written for the 15-minute schedule and, against the hourly one,
  // marked the war sync stale for the last quarter of every single hour. An
  // indicator that is amber a quarter of the time is one nobody reads on the
  // day it means something — the same argument the R10 note above makes.
  war: 2 * 60 * 60 * 1000,
  // Daily. 36 hours allows a missed run plus GitHub's delay.
  raids: 36 * 60 * 60 * 1000,
  // Daily too, as a step of sync-raids.yml, so the same window.
  //
  // Without an entry here it would fall through to DEFAULT_STALE_AFTER_MS — 3
  // hours against a job that runs once a day, which reads stale for 21 hours
  // out of every 24. That is the same mistake the `war` note above records,
  // and it is worth stating that the default is not a safe fallback for a job
  // slower than a few hours: EVERY job on a schedule needs a line here.
  "clan-games": 36 * 60 * 60 * 1000,
  // T11B.6 — daily, its own workflow (sync-players.yml). Same window as raids.
  players: 36 * 60 * 60 * 1000,
};

const DEFAULT_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

export type FreshnessLevel = "fresh" | "stale" | "failed" | "never";

export interface Freshness {
  level: FreshnessLevel;
  /** Whole minutes since the run finished; null when it has never run. */
  minutesAgo: number | null;
  label: string;
  /** The skip reason, when the last run was a legitimate no-op (R10). */
  skipReason: string | null;
}

/**
 * Turn the last run of a job into something a page can render.
 *
 * A `skipped` run is FRESH, not stale. R10: for three weeks of every month "no
 * CWL group" is the correct outcome, and colouring it red would mean the
 * indicator is red most of the year — which trains you to ignore it, and then it
 * is worth nothing on the one week it matters.
 */
export function freshness(
  run: SyncRun | null,
  now: Date = new Date(),
): Freshness {
  if (!run || !run.finishedAt) {
    return {
      level: "never",
      minutesAgo: null,
      label: "never run",
      skipReason: null,
    };
  }

  const finished = new Date(run.finishedAt).getTime();
  const elapsed = now.getTime() - finished;
  const minutesAgo = Math.max(0, Math.floor(elapsed / 60_000));
  const skipReason = run.skipReason;

  if (run.status === "failed") {
    return { level: "failed", minutesAgo, label: `failed ${ago(minutesAgo)}`, skipReason };
  }

  const limit = STALE_AFTER_MS[run.jobType] ?? DEFAULT_STALE_AFTER_MS;
  const level: FreshnessLevel = elapsed > limit ? "stale" : "fresh";

  return { level, minutesAgo, label: `updated ${ago(minutesAgo)}`, skipReason };
}

/** Human phrasing. Deliberately coarse — nobody needs "updated 97 minutes ago". */
export function ago(minutes: number): string {
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}
