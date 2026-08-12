// T9.2 — triggering a sync from the admin page.
//
// R2, RESTATED BECAUSE THIS IS EXACTLY WHERE IT GETS BROKEN.
//
// The obvious implementation of "manual sync trigger" is to import syncClans()
// and call it from a Server Action. That would put a sync job on Vercel, whose
// Hobby functions are killed at ten seconds — long enough to fetch a clan, write
// half its members, and be terminated with the other half missing and no error
// anywhere. GitHub Actions allows six hours, which is why every job lives there.
//
// So this does not run a sync. It ASKS GITHUB to run one, via workflow_dispatch,
// and returns immediately. The result appears in sync_log the same way a
// scheduled run does, because it IS a scheduled run — the same workflow, the
// same secrets, the same code path. Nothing about a manual trigger is a special
// case, which is the point: a "run it now" button that exercised a different
// path would prove nothing about the path that runs at 2 AM.
//
// ─────────────────────────────────────────────────────────────────────────────
// R6 — WHICH SECRETS THIS DOES AND DOES NOT NEED
//
// GITHUB_DISPATCH_TOKEN is a fine-grained PAT with ONE permission: Actions
// (read and write) on this repository. It is not the Supabase service key and
// not the Clash of Clans token, so R6's rule is untouched — the web app still
// cannot bypass RLS and still cannot read game data from Supercell.
//
// The blast radius is worth stating plainly: a leak lets someone run this
// repository's workflows. Those workflows are idempotent (R5) and write only
// game facts, so the damage is a throttled API key and wasted Actions minutes,
// not lost or altered data. Scope it to Actions only and to this repo only.
//
// UNCONFIGURED IS A FIRST-CLASS STATE, not an error. Until the token exists the
// admin page shows why the button is disabled rather than offering one that
// fails — the same shape as pushConfigured() in lib/push.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Workflows a leader may start by hand, mapped to their file name. */
export const DISPATCHABLE = {
  clans: "sync-clans.yml",
  cwl: "sync-cwl.yml",
  war: "sync-war.yml",
  raids: "sync-raids.yml",
} as const;

export type DispatchableJob = keyof typeof DISPATCHABLE;

/** Narrow an untrusted string — a form field — to a job this may actually start. */
export function isDispatchable(value: string): value is DispatchableJob {
  return Object.hasOwn(DISPATCHABLE, value);
}

export interface DispatchConfig {
  token: string;
  /** `owner/repo`. */
  repo: string;
  /** Branch the workflow runs from. */
  ref: string;
}

/**
 * The dispatch settings, or null when this has not been set up.
 *
 * GITHUB_DISPATCH_REF defaults to `main` rather than being required: a
 * misremembered branch name is a 404 from GitHub that reads like a broken token,
 * and every other value here is one somebody had to paste anyway.
 */
export function dispatchConfig(): DispatchConfig | null {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_DISPATCH_REPO;
  if (!token || !repo) return null;

  return { token, repo, ref: process.env.GITHUB_DISPATCH_REF ?? "main" };
}

export type DispatchOutcome =
  | { ok: true }
  | { ok: false; reason: "unconfigured" | "unauthorised" | "not-found" | "failed"; detail: string };

/**
 * Ask GitHub to start one workflow.
 *
 * Returns an outcome rather than throwing. The caller is a Server Action whose
 * job is to render a message, and a thrown error there becomes a generic error
 * page that tells an operator nothing about which of the four likely causes
 * they are looking at.
 *
 * A successful dispatch returns 204 with no body — GitHub tells you it accepted
 * the request, NOT that the workflow succeeded or even started. The honest
 * message is "asked GitHub to run it", and the actual answer arrives in
 * sync_log minutes later. Saying "sync complete" here would be a lie that looks
 * like a feature.
 */
export async function dispatchWorkflow(job: DispatchableJob): Promise<DispatchOutcome> {
  const config = dispatchConfig();
  if (!config) {
    return {
      ok: false,
      reason: "unconfigured",
      detail:
        "Set GITHUB_DISPATCH_TOKEN and GITHUB_DISPATCH_REPO to enable manual runs.",
    };
  }

  const workflow = DISPATCHABLE[job];

  let response: Response;
  try {
    response = await fetch(
      `https://api.github.com/repos/${config.repo}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${config.token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: config.ref }),
        // Vercel Hobby kills a function at ten seconds. Failing at eight with a
        // message beats being killed at ten with none.
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch (error) {
    return {
      ok: false,
      reason: "failed",
      detail: error instanceof Error ? error.message : "Could not reach GitHub.",
    };
  }

  if (response.status === 204) return { ok: true };

  // The token is never echoed back, in this message or any log line: it is the
  // one value here that must not reach a page or a log (R8's principle, applied
  // to a different credential).
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      reason: "unauthorised",
      detail:
        "GitHub rejected the token. It needs Actions (read and write) on this repository.",
    };
  }

  if (response.status === 404) {
    return {
      ok: false,
      reason: "not-found",
      detail: `No workflow ${workflow} on ${config.ref}, or the token cannot see this repository.`,
    };
  }

  return {
    ok: false,
    reason: "failed",
    detail: `GitHub returned ${response.status}.`,
  };
}
