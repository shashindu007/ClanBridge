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
import { clanGamesWindow } from "@/lib/coc-time";

/** How long each job may go between successful runs before its data is suspect. */
export const STALE_AFTER_MS: Record<string, number> = {
  // Every 2 hours on days 1-14 only (sync-cwl.yml). Three hours allows a missed
  // tick plus GitHub's habit of delaying scheduled runs by up to twenty minutes.
  // isStale() applies it only inside that window.
  cwl: 3 * 60 * 60 * 1000,
  // 057 — a step of the same workflow, so the same window. Its skips ("every
  // village read in the last 20 hours") are fresh, as any R10 skip is.
  "cwl-scout": 3 * 60 * 60 * 1000,
  // Every 30 minutes since 054; two hours is four missed runs, not one.
  clans: 2 * 60 * 60 * 1000,
  // Every 30 minutes, as a step of sync-clans.yml — NOT every 15 minutes as first planned
  // (see the T6.2 deviation note in IMPLEMENTATION.md §0). The old 45-minute
  // window was written for the 15-minute schedule and, against the hourly one,
  // marked the war sync stale for the last quarter of every single hour. An
  // indicator that is amber a quarter of the time is one nobody reads on the
  // day it means something — the same argument the R10 note above makes.
  war: 2 * 60 * 60 * 1000,
  // Friday to Monday only, at 08:41 (sync-raids.yml). The longest gap is Monday
  // to Friday, 96 hours. 104, not 100: GitHub has been observed starting
  // scheduled runs hours late (sync-clans ran ~5 times a day against a
  // 48-a-day schedule), so a 4-hour margin fired a false alarm on any slow
  // Friday. Eight hours still flags a missed Friday run the same afternoon.
  raids: 104 * 60 * 60 * 1000,
  // Two boundary days a month (sync-raids.yml), so no single window fits: 36
  // hours cried wolf for three weeks of every month, and this 25 days — the
  // longest gap between runs — would sleep through a missed START, which is a
  // lost month. isStale() adds the check that matters: a boundary run came due
  // and nothing has finished since. This entry is only the outer bound.
  //
  // Without an entry here it would fall through to DEFAULT_STALE_AFTER_MS — 3
  // hours against a job that runs once a day, which reads stale for 21 hours
  // out of every 24. That is the same mistake the `war` note above records,
  // and it is worth stating that the default is not a safe fallback for a job
  // slower than a few hours: EVERY job on a schedule needs a line here.
  "clan-games": 25 * 24 * 60 * 60 * 1000,
  // T11B.6 — daily, its own workflow (sync-players.yml). Same window as raids.
  players: 36 * 60 * 60 * 1000,
};

const DEFAULT_STALE_AFTER_MS = 3 * 60 * 60 * 1000;

/** How late a scheduled Clan Games run may be before it counts as missed. */
const CLAN_GAMES_GRACE_MS = 4 * 60 * 60 * 1000;

/**
 * Was a Clan Games boundary run due, and has nothing finished since?
 *
 * The runs are due half an hour after the Games open and forty minutes after
 * they close (sync-raids.yml). The dates come from clanGamesWindow(), so if
 * Supercell moves the Games, this moves with the job rather than drifting.
 */
function clanGamesRunMissed(finishedAt: Date, now: Date): boolean {
  const cutoff = now.getTime() - CLAN_GAMES_GRACE_MS;
  const thisMonth = clanGamesWindow(now);
  const lastMonth = clanGamesWindow(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)),
  );

  const due = [lastMonth, thisMonth]
    .flatMap((w) => [w.start.getTime() + 31 * 60_000, w.end.getTime() + 41 * 60_000])
    .filter((t) => t <= cutoff);

  return due.length > 0 && finishedAt.getTime() < Math.max(...due);
}

/**
 * Has this job gone quiet? The one definition, shared by the page indicator and
 * the watchdog's alerts (scripts/sync/alerts.ts), so the two cannot disagree.
 */
export function isStale(jobType: string, finishedAt: Date, now: Date): boolean {
  const limit = STALE_AFTER_MS[jobType] ?? DEFAULT_STALE_AFTER_MS;
  const late = now.getTime() - finishedAt.getTime() > limit;
  if (jobType === "cwl" || jobType === "cwl-scout") return late && inCwlWindow(now);
  if (late) return true;
  return jobType === "clan-games" && clanGamesRunMissed(finishedAt, now);
}

/** The last day of the month sync-cwl.yml runs on. */
const CWL_LAST_DAY = 14;

/**
 * Is a CWL run expected right now? Days 1-14, but not in the first hours of the
 * 1st, when the last run was naturally on the 14th of the month before.
 */
function inCwlWindow(now: Date): boolean {
  const monthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return (
    now.getUTCDate() <= CWL_LAST_DAY &&
    now.getTime() - monthStart > STALE_AFTER_MS.cwl!
  );
}

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

  const level: FreshnessLevel = isStale(run.jobType, new Date(finished), now) ? "stale" : "fresh";

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
