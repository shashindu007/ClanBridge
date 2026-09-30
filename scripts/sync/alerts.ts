// T5.8 — tell somebody when a sync job dies.
//
// T4.8 already shows "updated N minutes ago" on every page, and turns it red.
// That only works if somebody happens to look at a page. This is the half that
// does not wait to be noticed, and it is the version that actually saves a CWL
// season: the failure mode being defended against is a job that stops on a
// Tuesday during CWL week and is discovered the following Monday, by which point
// the data it was supposed to capture has been deleted by Supercell and cannot
// be re-fetched from anywhere.
//
// TWO HALVES, AND THE SECOND IS THE IMPORTANT ONE
//
//   alertSyncFailure   a job ran and threw. Called from runSyncJob.
//   alertStaleJobs     a job has not run at all. Called from health.ts.
//
// A job that crashes tells you it crashed. A job whose workflow was disabled,
// whose schedule silently stopped firing, or whose runner never started, tells
// you nothing — and that is the case that costs the season. Nothing can report
// its own absence, which is why the second check has to run from somewhere else.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHO IS TOLD, AND WHY IT IS NOT PREFERENCE-FILTERED
//
// Leaders of the affected clan, plus every platform admin. Not the members: a
// member cannot fix a dead sync job, and a notification nobody can act on is
// noise that teaches people to swipe alerts away.
//
// T5.9's toggles deliberately do not cover this. They exist so a member can mute
// reminders they find annoying, and every kind they list is something a person
// chose to be told about. An operational alert to the two people responsible for
// the platform is not that, and an alert that can be switched off is one that
// will be, on the quiet week before the loud one.
//
// R6 — these run with the service key inside GitHub Actions and bypass RLS, so
// the recipient query is written here rather than through push_targets(). That
// function exists to constrain the APPLICATION, which cannot be trusted with
// other members' endpoints; a sync job already holds the key to everything.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordNotification, retireExpired, sendPush, type PushTarget } from "@/lib/push";
import { isStale } from "@/services/freshness";
import type { JobType } from "./shared";

/** Where a member is sent to see the damage. T9.2 fills this page out further. */
const ADMIN_PATH = "/admin";

/**
 * Platform admins, plus leaders of one clan.
 *
 * `clanId` is null for family-wide jobs, in which case only platform admins are
 * told — there is no single clan whose leader owns the problem.
 */
async function alertRecipients(
  supabase: SupabaseClient,
  clanId: string | null,
): Promise<string[]> {
  const recipients = new Set<string>();

  const { data: admins } = await supabase
    .from("users")
    .select("id")
    .eq("is_platform_admin", true)
    .eq("status", "approved")
    .is("deleted_at", null);

  for (const row of (admins ?? []) as Array<{ id: string }>) {
    recipients.add(row.id);
  }

  if (clanId) {
    const { data: leaders } = await supabase
      .from("clan_roles")
      .select("user_id")
      .eq("clan_id", clanId) // R3
      .eq("role", "leader")
      .is("deleted_at", null);

    for (const row of (leaders ?? []) as Array<{ user_id: string }>) {
      recipients.add(row.user_id);
    }
  }

  return [...recipients];
}

/** Live subscriptions for a set of accounts. */
async function subscriptionsFor(
  supabase: SupabaseClient,
  userIds: readonly string[],
): Promise<PushTarget[]> {
  if (userIds.length === 0) return [];

  const { data, error } = await supabase
    .from("push_subscriptions")
    .select("user_id, endpoint, p256dh, auth")
    .in("user_id", [...userIds])
    .is("deleted_at", null);

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((r) => ({
    user_id: r.user_id as string,
    endpoint: r.endpoint as string,
    p256dh: r.p256dh as string,
    auth_key: r.auth as string,
  }));
}

/**
 * A job ran and threw.
 *
 * Never throws. This is called from the failure path of runSyncJob, and an alert
 * that fails must not replace the original error with its own — the sync failure
 * is the news, and losing it to a push problem would be a strictly worse outcome
 * than sending nothing.
 */
export async function alertSyncFailure(
  supabase: SupabaseClient,
  jobType: JobType,
  clanId: string | null,
  message: string,
): Promise<void> {
  try {
    const recipients = await alertRecipients(supabase, clanId);
    const targets = await subscriptionsFor(supabase, recipients);

    // T12.3 — the record, before the doorbell. These alerts go to the two or
    // three people who can fix a dead job, and the whole point of T5.8 is that
    // a failure is noticed at all — so it must survive nobody having push set
    // up. 'sync_alerts' is not a notification_preferences column on purpose:
    // this file's header explains why an operational alert is not mutable, and
    // the feed does not consult preferences in any case.
    const payload = {
      title: `Sync failed: ${jobType}`,
      // R8 — the job's error text is NOT included. Nothing in src/integration/
      // puts a token into an error message, but a push payload is decrypted on
      // devices this system does not control and lands on lock screens, and the
      // full text is in sync_log for anyone who can read it anyway.
      body: `The ${jobType} sync did not complete. Check the sync log.`,
      url: ADMIN_PATH,
      // One key per job type: a job failing every two hours all night leaves one
      // notification, not twelve.
      tag: `sync-failed:${jobType}`,
    };

    await recordNotification(supabase, clanId, "sync_alerts", recipients, payload);

    const result = await sendPush(targets, payload);
    await retireExpired(supabase, result.expired);
  } catch (error) {
    console.error(
      `[${jobType}] could not send failure alert: ${
        error instanceof Error ? error.message : String(error)
      } (original failure: ${message.slice(0, 200)})`,
    );
  }
}

export interface JobHealth {
  jobType: string;
  lastSuccessAt: string | null;
  /** Milliseconds since the last success, or null when there has never been one. */
  ageMs: number | null;
  stale: boolean;
}

/**
 * Which jobs have gone quiet, given the last successful run of each.
 *
 * Pure, so the thresholds are testable without waiting hours for one to expire.
 *
 * A job that has NEVER succeeded is not reported. On a fresh install that would
 * fire five alerts for jobs whose phase has not been built yet, and an alerting
 * system that is wrong on the day it is installed is one nobody trusts later.
 * `expected` names the jobs that are actually scheduled — it is the operator's
 * statement of what should be running, and a job missing from it is not watched.
 */
export function staleJobs(
  lastSuccesses: ReadonlyArray<{ jobType: string; finishedAt: string | null }>,
  expected: readonly string[],
  now: Date = new Date(),
): JobHealth[] {
  const byType = new Map(lastSuccesses.map((r) => [r.jobType, r.finishedAt]));

  return expected.map((jobType) => {
    const finishedAt = byType.get(jobType) ?? null;
    const ageMs = finishedAt ? now.getTime() - new Date(finishedAt).getTime() : null;
    // The same rule the page indicator uses (T4.8), so a red badge and an alert
    // cannot disagree about what "stale" means — including the schedule-aware
    // check for Clan Games, which runs on two days a month.
    return {
      jobType,
      lastSuccessAt: finishedAt,
      ageMs,
      stale: finishedAt !== null && isStale(jobType, new Date(finishedAt), now),
    };
  });
}

/** Human phrasing for the alert body. Coarse on purpose. */
function describeAge(ageMs: number): string {
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 1) return "under an hour";
  if (hours === 1) return "1 hour";
  if (hours < 48) return `${hours} hours`;
  return `${Math.floor(hours / 24)} days`;
}

/**
 * Check every scheduled job and alert on the ones that have gone quiet.
 *
 * Returns the health of all of them so the caller can log it, not only the bad
 * ones — a health check whose quiet output is indistinguishable from a health
 * check that did not run has the same problem it exists to solve.
 */
export async function alertStaleJobs(
  supabase: SupabaseClient,
  expected: readonly string[],
  now: Date = new Date(),
): Promise<JobHealth[]> {
  // The most recent SUCCESS per job type. Not the most recent run: a job failing
  // every two hours is producing rows constantly while its data gets older, and
  // keying on "ran" would call that healthy.
  const { data, error } = await supabase
    .from("sync_log")
    .select("job_type, finished_at")
    .eq("status", "success")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error(`health: could not read sync_log — ${error.message}`);
    return [];
  }

  const latest = new Map<string, string>();
  for (const row of (data ?? []) as Array<{ job_type: string; finished_at: string }>) {
    if (!latest.has(row.job_type)) latest.set(row.job_type, row.finished_at);
  }

  const health = staleJobs(
    [...latest].map(([jobType, finishedAt]) => ({ jobType, finishedAt })),
    expected,
    now,
  );

  const stale = health.filter((h) => h.stale);
  if (stale.length === 0) return health;

  // Platform admins only. A stale job is rarely one clan's problem, and sending
  // three leaders an alert about a schedule they cannot fix is noise.
  const recipients = await alertRecipients(supabase, null);
  const targets = await subscriptionsFor(supabase, recipients);

  const worst = stale.reduce((a, b) => ((a.ageMs ?? 0) > (b.ageMs ?? 0) ? a : b));

  // T12.3 — recorded as well as pushed. This is the alert that exists because
  // nothing can report its own absence, so it is the last one that should
  // depend on a browser subscription being in place.
  const payload = {
    title: stale.length === 1 ? `${worst.jobType} sync has stopped` : "Syncs have stopped",
    body:
      stale.length === 1
        ? `No successful ${worst.jobType} run for ${describeAge(worst.ageMs ?? 0)}.`
        : `${stale.length} jobs have gone quiet. The worst is ${worst.jobType}, ` +
          `${describeAge(worst.ageMs ?? 0)} ago.`,
    url: ADMIN_PATH,
    tag: "sync-stale",
  };

  await recordNotification(supabase, null, "sync_alerts", recipients, payload);

  const result = await sendPush(targets, payload);
  await retireExpired(supabase, result.expired);
  return health;
}
