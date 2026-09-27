// T2.5 — Shared plumbing for every sync job.
//
// R9 — every job writes to sync_log at start and finish. A job that fails
// silently during CWL costs a season of data that cannot be re-fetched from
// anywhere, which is why the log row is closed in a `finally` rather than on the
// happy path.
//
// ─────────────────────────────────────────────────────────────────────────────
// R11 — WHAT SYNC JOBS MAY WRITE
//
// These scripts hold the service-role key and bypass RLS entirely, so nothing in
// the database stops them. This list is the only boundary that exists.
//
//   MAY WRITE (game facts, from Supercell):
//     clans, players, clan_roles, member_snapshots
//     cwl_seasons, cwl_wars, cwl_attacks, cwl_group_clans, cwl_group_wars
//     wars, war_attacks
//     raid_seasons, raid_participants, clan_games, clan_games_scores
//     sync_log
//
//   MUST NEVER WRITE (human decisions, entered by people):
//     polls, poll_options, poll_responses
//     cwl_rosters, cwl_roster_members
//     war_lineups, war_lineup_members
//     war_targets, cwl_bonuses, announcements, base_layouts
//
// Sync jobs re-run every few minutes and overwrite. If a leader's roster
// selection sits in a table a job touches, a routine 2 AM run silently erases an
// hour of their work — and R4 means there is no deleted row to recover.
//
// R12 — the plan is compared to reality, never replaced by it. A job that
// "reconciles" cwl_roster_members against the API roster has destroyed the exact
// comparison T4B.11 exists to show.
// ─────────────────────────────────────────────────────────────────────────────

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type JobType = "clans" | "cwl" | "war" | "raids" | "clan-games" | "players" | "backup";

/**
 * Thrown by a job to record an ordinary non-event.
 *
 * R10 — notInWar, warEnded, preparation and a missing CWL group are normal for
 * most of the month. They are recorded as `skipped`, never `failed`. A job that
 * reports failure three weeks out of four trains you to ignore the alerts that
 * actually matter.
 */
export class SyncSkipped extends Error {
  readonly reason: string;

  constructor(reason: string, detail?: string) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = "SyncSkipped";
    this.reason = reason;
  }
}

/** Signal a clean, expected exit. See {@link SyncSkipped}. */
export function skip(reason: string, detail?: string): never {
  throw new SyncSkipped(reason, detail);
}

/**
 * Refuse to write fixture data into a real database.
 *
 * USE_FIXTURES=true makes coc-client.ts read fixtures/ instead of the network
 * (T2.3), which is correct for the offline suite and for development. It is
 * catastrophic for a sync job pointed at Supabase: the job would write the
 * scrubbed placeholder clan and its invented members into `clans`, `players` and
 * `member_snapshots` as ordinary rows, indistinguishable from real ones.
 *
 * There is no undo. R4 forbids deletes, and 014 withholds DELETE from
 * service_role deliberately, so the only available correction is setting
 * deleted_at — the fabricated players stay in the table for the life of the
 * project, attached to whatever history accumulates against their ids.
 *
 * `.env.local` ships with USE_FIXTURES=true, so this is the default state of a
 * fresh checkout, not an exotic mistake.
 *
 * THE TEST SUITE IS NOT AFFECTED, and the discriminator is not an environment
 * variable but the injected client: tests pass `options.client` (PGlite), whereas
 * a job run from a workflow or a terminal has none and builds the service-role
 * client against the real project. Guarding on that means the offline tests keep
 * exercising the real fixture path, while the one case that reaches live data is
 * the one that stops.
 *
 * ALLOW_FIXTURE_SYNC=true overrides, for deliberately seeding a scratch database.
 */
export function assertNotFixtureSync(jobType: JobType): void {
  if (process.env.USE_FIXTURES !== "true") return;
  if (process.env.ALLOW_FIXTURE_SYNC === "true") return;

  throw new Error(
    `Refusing to run the ${jobType} sync with USE_FIXTURES=true.\n\n` +
      "  This job would read fixtures/ and write invented members into the real\n" +
      "  database as real rows. R4 means they could never be removed, only\n" +
      "  soft-deleted, so the correction is permanent damage rather than a fix.\n\n" +
      "  Set USE_FIXTURES=false in .env.local to sync against the live API.\n" +
      "  Set ALLOW_FIXTURE_SYNC=true as well only if you meant to seed a\n" +
      "  throwaway database from fixtures.",
  );
}

export interface JobContext {
  supabase: SupabaseClient;
  /** Count rows actually written, so sync_log records real work rather than "it ran". */
  recorded(n: number): void;
}

export interface RunOptions {
  clanId?: string | null;
  /** Injected by tests. Defaults to the service-role client. */
  client?: SupabaseClient;
}

/** Insert a `running` row and return its id. */
export async function startSyncLog(
  supabase: SupabaseClient,
  jobType: JobType,
  clanId?: string | null,
): Promise<string> {
  const { data, error } = await supabase
    .from("sync_log")
    .insert({ job_type: jobType, clan_id: clanId ?? null, status: "running" })
    .select("id")
    .single();

  if (error) {
    // If the log itself cannot be written, the job must not proceed — it would
    // run invisibly, which is the exact failure R9 exists to prevent.
    throw new Error(`Could not open sync_log for ${jobType}: ${error.message}`);
  }
  return data.id as string;
}

/** Close the row. Called from a `finally`, so it must never throw. */
export async function finishSyncLog(
  supabase: SupabaseClient,
  id: string,
  status: "success" | "skipped" | "failed",
  extra: { error?: string; skipReason?: string; recordsWritten?: number } = {},
): Promise<void> {
  const { error } = await supabase
    .from("sync_log")
    .update({
      status,
      finished_at: new Date().toISOString(),
      error: extra.error ?? null,
      skip_reason: extra.skipReason ?? null,
      records_written: extra.recordsWritten ?? null,
    })
    .eq("id", id);

  if (error) {
    // Reported, not thrown: a failure to close the log must not mask the real
    // error from the job body.
    console.error(`Could not close sync_log ${id}: ${error.message}`);
  }
}

/**
 * Run a sync job with the log row opened and closed around it.
 *
 * Exit codes matter, because GitHub Actions decides the run's status from them:
 *   0  success, and also skipped — a skip is not a failure (R10)
 *   1  failed
 */
export async function runSyncJob(
  jobType: JobType,
  job: (ctx: JobContext) => Promise<void>,
  options: RunOptions = {},
): Promise<"success" | "skipped" | "failed"> {
  // Before the client, and therefore before sync_log: a job that must not run has
  // not failed, and recording a `failed` row here would also fire T5.8's alert —
  // pushing a notification to the leader about a variable in someone's .env.local.
  // Only for a real run; an injected client is the offline suite. See the note on
  // assertNotFixtureSync.
  if (!options.client) assertNotFixtureSync(jobType);

  const supabase = options.client ?? createAdminClient();
  const id = await startSyncLog(supabase, jobType, options.clanId);

  let written = 0;
  const ctx: JobContext = {
    supabase,
    recorded: (n) => {
      written += n;
    },
  };

  try {
    await job(ctx);
    await finishSyncLog(supabase, id, "success", { recordsWritten: written });
    console.log(`[${jobType}] success, ${written} rows written`);
    return "success";
  } catch (error) {
    if (error instanceof SyncSkipped) {
      await finishSyncLog(supabase, id, "skipped", {
        skipReason: error.reason,
        recordsWritten: written,
      });
      console.log(`[${jobType}] skipped: ${error.message}`);
      return "skipped";
    }

    // R8 — an API token must never reach sync_log. Nothing in src/integration/
    // puts one into an error, and this is the last place that would leak it.
    const message = error instanceof Error ? error.message : String(error);
    await finishSyncLog(supabase, id, "failed", {
      error: message.slice(0, 2000),
      recordsWritten: written,
    });
    console.error(`[${jobType}] FAILED: ${message}`);

    // T5.8 — the log row is written; now tell someone without waiting for them
    // to look. Imported lazily so that a job which never fails never loads the
    // push stack, and awaited so the process cannot exit before it sends.
    //
    // alertSyncFailure never throws: an alerting failure must not replace the
    // sync failure, which is the news.
    const { alertSyncFailure } = await import("./alerts");
    await alertSyncFailure(supabase, jobType, options.clanId ?? null, message);

    return "failed";
  }
}

/**
 * Entry point wrapper for a script run directly by a workflow.
 * Sets the process exit code so a failed sync fails the Actions run (T5.8).
 */
export async function main(
  jobType: JobType,
  job: (ctx: JobContext) => Promise<void>,
  options: RunOptions = {},
): Promise<void> {
  let result: "success" | "skipped" | "failed";
  try {
    result = await runSyncJob(jobType, job, options);
  } catch (error) {
    // Only reachable before the log row is opened — currently the fixture guard
    // and a startSyncLog failure. Printed as the message alone: both already say
    // exactly what to do, and a stack trace above the instruction is how an
    // operator concludes the tool is broken rather than that they are being told
    // something.
    console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = result === "failed" ? 1 : 0;
}

/**
 * The clans to sync, read from the database rather than hardcoded (R3).
 *
 * There is no fixed list of three anywhere. Migration 015 made clans data the
 * leader owns, added through /admin after signing in — the tag is the one part
 * of a clan a human supplies (R11), and everything else about it is filled in
 * by these jobs on the first run.
 */
export async function activeClans(
  supabase: SupabaseClient,
): Promise<Array<{ id: string; tag: string; name: string }>> {
  const { data, error } = await supabase
    .from("clans")
    .select("id, tag, name")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("tag");

  if (error) throw new Error(`Could not load clans: ${error.message}`);
  if (!data?.length) {
    // NOT "run seed.sql". That file was superseded by migration 015 and now only
    // exists because a test still reads it; pointing an operator at it sends
    // them to paste SQL for something the admin page does properly.
    skip("noClansSeeded", "no clans added yet — sign in and add them at /admin");
  }
  return data;
}
