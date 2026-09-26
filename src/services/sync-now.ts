// "Refresh now" — a member asking for fresher game data than the schedule gives.
//
// R2 still holds: nothing here syncs. It asks GitHub to run the same workflow
// the schedule runs (lib/github.ts), and the page learns the answer the way it
// always does, from sync_log. What this file adds is the judgement about WHEN
// asking is worth it, because any member can press the button and every run is
// paid for from one shared budget.
//
// Pure over its dependencies, so every refusal below is testable without
// GitHub, Upstash or a database.

import type { DispatchOutcome, DispatchableJob } from "@/lib/github";
import {
  SYNC_NOW_DAILY_LIMIT,
  SYNC_NOW_JOB_LIMIT,
  SYNC_NOW_USER_LIMIT,
  type RateLimitConfig,
  type RateLimitResult,
} from "@/lib/rate-limit";

/**
 * What a page shows fresher, and which workflow brings it.
 *
 * `war` dispatches sync-clans, not sync-war: that workflow reads the member
 * lists AND the current war in one run for the price of one install, so the
 * war board also learns who changed clan. `jobs` are the sync_log job types that
 * run writes, in order — the first is what "already running" looks for, and
 * `watch` is the one whose finished row means the page's data has changed.
 */
export const SYNC_TARGETS = {
  war: { dispatch: "clans", jobs: ["clans", "war"], watch: "war" },
  clans: { dispatch: "clans", jobs: ["clans", "war"], watch: "clans" },
  cwl: { dispatch: "cwl", jobs: ["cwl"], watch: "cwl" },
  raids: { dispatch: "raids", jobs: ["raids"], watch: "raids" },
} as const satisfies Record<
  string,
  { dispatch: DispatchableJob; jobs: readonly string[]; watch: string }
>;

export type SyncTarget = keyof typeof SYNC_TARGETS;

export function isSyncTarget(value: string): value is SyncTarget {
  return Object.hasOwn(SYNC_TARGETS, value);
}

export type SyncNowState =
  | { status: "dispatched"; message: string }
  | { status: "running"; message: string }
  | { status: "cooldown"; message: string; retryAt: number }
  | { status: "unconfigured"; message: string }
  | { status: "error"; message: string };

export interface SyncNowDeps {
  /** When the newest unfinished run of this job type started, or null. */
  runningSince(jobType: string): Promise<string | null>;
  limit(config: RateLimitConfig, key: string): Promise<RateLimitResult>;
  dispatch(job: DispatchableJob): Promise<DispatchOutcome>;
  configured: boolean;
  now?: number;
}

function minutesUntil(reset: number, now: number): number {
  return Math.max(1, Math.ceil((reset - now) / 60_000));
}

/**
 * Ask for a run, or explain why not.
 *
 * ORDER MATTERS. Checks that spend nothing come first, so a member pressing the
 * button while a run is already under way does not burn their own allowance or
 * the day's. The per-workflow cooldown comes before the per-user and daily
 * counters for the same reason: during a cooldown, the answer is "someone
 * already asked", and it should cost nobody anything to be told that.
 */
export async function requestSyncNow(
  target: SyncTarget,
  userId: string,
  deps: SyncNowDeps,
): Promise<SyncNowState> {
  const now = deps.now ?? Date.now();

  if (!deps.configured) {
    return { status: "unconfigured", message: "Manual refresh is not set up yet." };
  }

  const { dispatch, jobs } = SYNC_TARGETS[target];

  for (const job of jobs) {
    if (await deps.runningSince(job)) {
      return {
        status: "running",
        message: "Already updating — the page will refresh itself when it lands.",
      };
    }
  }

  const perJob = await deps.limit(SYNC_NOW_JOB_LIMIT, `sync-now:${dispatch}`);
  if (!perJob.success) {
    return {
      status: "cooldown",
      message: `Refreshed a moment ago. Try again in ${minutesUntil(perJob.reset, now)} min.`,
      retryAt: perJob.reset,
    };
  }

  const perUser = await deps.limit(SYNC_NOW_USER_LIMIT, `sync-now-user:${userId}`);
  if (!perUser.success) {
    return {
      status: "cooldown",
      message: `You have refreshed a lot this hour. Try again in ${minutesUntil(perUser.reset, now)} min.`,
      retryAt: perUser.reset,
    };
  }

  const daily = await deps.limit(SYNC_NOW_DAILY_LIMIT, "sync-now:all");
  if (!daily.success) {
    return {
      status: "cooldown",
      message: "Today's refresh allowance is used up. The hourly update still runs.",
      retryAt: daily.reset,
    };
  }

  const outcome = await deps.dispatch(dispatch);
  if (!outcome.ok) {
    // The detail names a GitHub setting, which is for a leader on /admin, not
    // for a member looking at the war board.
    console.error(`sync-now: dispatch ${dispatch} failed — ${outcome.detail}`);
    return { status: "error", message: "Could not start an update. Try again later." };
  }

  return {
    status: "dispatched",
    message: "Updating — usually 1–2 minutes. The page will refresh itself.",
  };
}
