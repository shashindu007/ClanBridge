// T5.8 — the watchdog. Notices jobs that have gone quiet.
//
// This exists as a separate job for one reason: NOTHING CAN REPORT ITS OWN
// ABSENCE. A crashing job alerts from its own failure path (runSyncJob calls
// alertSyncFailure). A job whose schedule stopped firing, whose workflow was
// disabled after a billing lapse, or whose runner never started, produces no
// output at all — no failure, no log row, no signal of any kind. The only way to
// see that is for something else to look.
//
// It reads sync_log and sends push; it calls no game API and needs no
// COC_API_TOKEN. Cheap enough to run hourly.
//
// Deliberately NOT written as a sync job through runSyncJob(): it would then
// write its own sync_log row every hour, and be a job that watches itself.

import { alertStaleJobs } from "./alerts";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The jobs actually on a schedule today.
 *
 * The operator's statement of what should be running. A job type absent from
 * this list is not watched — which is correct for the phases not yet built:
 * alerting that the war sync has never run is noise until T6.2 exists, and an
 * alerting system that is wrong on day one is one nobody believes on day ninety.
 *
 * ADD TO THIS LIST WHEN A WORKFLOW IS ADDED:
 *   war         T6.2   every 15 minutes
 *   raids       T7.2   daily
 *   clan-games  T7.4   daily during the games period
 */
const WATCHED = ["clans", "cwl"] as const;

async function main(): Promise<void> {
  const supabase = createAdminClient();
  const health = await alertStaleJobs(supabase, WATCHED);

  // Logged whether or not anything is wrong. A health check whose quiet output
  // is indistinguishable from a health check that never ran has exactly the
  // problem it was built to solve.
  for (const job of health) {
    const age =
      job.ageMs === null
        ? "never succeeded"
        : `${Math.floor(job.ageMs / 60_000)} minutes ago`;
    console.log(`[health] ${job.jobType}: ${age}${job.stale ? "  ** STALE **" : ""}`);
  }

  // Exit 0 even when something is stale. A red run in Actions is how a BROKEN
  // watchdog should look; a working watchdog reporting a broken job is doing its
  // job, and failing here would make the two indistinguishable in the run list.
  process.exitCode = 0;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
