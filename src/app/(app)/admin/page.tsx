// Admin — first-run bootstrap, clan management, and sync health (T9.2).
//
// THE BOOTSTRAP PROBLEM this solves, from migration 015:
//
//   seeing anything -> needs a clan_roles row
//   clan_roles      -> needs a clan to exist
//   a clan          -> needs a leader to add it
//   a leader        -> needs to see something
//
// 015 broke the cycle with claim_platform_ownership() and nothing has ever called
// it. This page does. The order is: sign in, claim, add clans, grant yourself
// leader — after which every later permission is per clan again, as designed.
//
// R3 — every mutation here is authorised by the database, not by this file. The
// claim is a definer function that refuses if an admin already exists; the clan
// insert is gated by 015's "platform admin adds clans" policy; the role insert by
// "admin or leader grants roles". The checks below decide what to RENDER. They
// are not the security boundary and must never be the only check.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { currentUserId, isPlatformAdmin } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { isLeader } from "@/lib/visibility";
import { InvalidTagError, normaliseTag } from "@/lib/tags";
import { isUniqueViolation, safeMessage } from "@/lib/errors";
import { failedRuns, recentRuns, type SyncRunRecord } from "@/repositories/sync-log";
import { ago, freshness } from "@/services/freshness";
import { groupFailures } from "@/services/sync-failures";
import { clanAccent } from "@/lib/clan-accent";
import { DISPATCHABLE, dispatchConfig, dispatchWorkflow, isDispatchable } from "@/lib/github";
import { SYNC_TRIGGER_LIMIT, sharedRateLimiter } from "@/lib/rate-limit";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { FactRow, Panel, SectionHeader } from "@/components/kit";
import { AdminNav } from "@/components/admin-nav";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import {
  Castle,
  CheckCircle2,
  CircleAlert,
  History,
  Plus,
  RefreshCw,
  TriangleAlert,
  Wrench,
} from "lucide-react";

export const dynamic = "force-dynamic";

async function claimOwnership() {
  "use server";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // The second of the two independent checks 015 asks for. The function itself
  // enforces "only if no admin exists yet"; this enforces "only this address".
  const owner = process.env.OWNER_EMAIL?.trim().toLowerCase();
  if (!owner || user.email?.trim().toLowerCase() !== owner) {
    redirect("/admin?error=not-owner");
  }

  // T10.8d — a code, not the raw message. Postgres text here would name the
  // definer function and its constraints to whoever is probing the bootstrap,
  // which is the one URL an unapproved account can reach (lib/gate.ts).
  const { error } = await supabase.rpc("claim_platform_ownership");
  if (error) {
    safeMessage("claim-ownership", error, "");
    redirect("/admin?error=claim-failed");
  }

  revalidatePath("/admin");
  redirect("/admin?ok=clan-added");
}

async function addClan(formData: FormData) {
  "use server";

  const supabase = await createClient();

  let tag: string;
  try {
    // Normalised before it reaches the database so the stored form is canonical
    // (section 4: uppercase, with the hash). 001's clans_tag_format constraint
    // is the backstop, but a rejected insert is a worse error message than this.
    tag = normaliseTag(String(formData.get("tag") ?? ""));
  } catch (error) {
    if (error instanceof InvalidTagError) {
      redirect("/admin?error=bad-tag");
    }
    throw error;
  }

  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/admin?error=no-name");

  // Only name and tag. badge_url and everything else about a clan is a game fact
  // filled in by scripts/sync/clans.ts on its first run (R11) — typing it here
  // would be inventing data the API owns.
  const { error } = await supabase.from("clans").insert({ tag, name });

  if (error) {
    if (isUniqueViolation(error)) redirect("/admin?error=duplicate");
    safeMessage("add-clan", error, "");
    redirect("/admin?error=add-clan-failed");
  }

  revalidatePath("/admin");
  redirect("/admin");
}

async function grantSelfLeader(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clanId = String(formData.get("clanId") ?? "");
  if (!clanId) redirect("/admin?error=no-clan");

  // A function, not an insert, since 046: clan_roles has no session write path
  // at all, and grant_self_leader() is the one self-grant — platform admin
  // only, audited like every other role change.
  const { data: granted, error } = await supabase.rpc("grant_self_leader", {
    p_clan: clanId,
  });

  if (error || granted !== true) {
    // Saying why by name would describe the rule to whoever tried it.
    if (error) safeMessage("grant-self-leader", error, "");
    redirect("/admin?error=grant-failed");
  }

  revalidatePath("/admin");
  redirect("/admin");
}

/**
 * T9.2 — ask GitHub to run one sync workflow now.
 *
 * R2 — this DISPATCHES, it does not sync. Running the job here would put it on
 * Vercel, where a ten-second function timeout kills a CWL sync partway through
 * and leaves half-written data. See lib/github.ts.
 *
 * Authority is checked here rather than by RLS, because dispatching a workflow
 * is not a database write and no policy can see it. Platform admin or a leader
 * of some clan — the same audience the page itself is gated to, restated at the
 * action because a Server Action is independently addressable and must never
 * rely on the page around it having done the check.
 */
async function triggerSync(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const admin = await isPlatformAdmin(supabase, userId);
  const clans = await visibleClans(supabase, userId);
  if (!admin && !clans.some((c) => isLeader(c.role))) {
    redirect("/admin?error=forbidden");
  }

  const job = String(formData.get("job") ?? "");
  if (!isDispatchable(job)) redirect("/admin?error=unknown-job");

  // T9.7 — a workflow run costs Actions minutes and hits a rate-limited game
  // API. Keyed by user so one impatient leader cannot exhaust the budget for
  // everyone, and 3/hour because a manual sync is a repair, not a workflow.
  const limiter = await sharedRateLimiter(SYNC_TRIGGER_LIMIT);
  const { success } = await limiter.limit(`sync-trigger:${userId}`);
  if (!success) redirect("/admin?error=rate-limited");

  const outcome = await dispatchWorkflow(job);
  revalidatePath("/admin");
  redirect(outcome.ok ? "/admin?ok=dispatched" : `/admin?error=${encodeURIComponent(outcome.detail)}`);
}

/** Job types as a person would name them. The code stays visible beside it for debugging. */
const JOB_LABELS: Record<string, { label: string; schedule: string }> = {
  clans: { label: "Clan members", schedule: "Every hour" },
  cwl: { label: "Clan War League", schedule: "Every 2 hours" },
  war: { label: "Wars", schedule: "Every hour, with clan members" },
  raids: { label: "Raids and Clan Games", schedule: "Daily" },
  "clan-games": { label: "Clan Games", schedule: "Daily, with raids" },
  players: { label: "Base progress", schedule: "Daily" },
  backup: { label: "Backup", schedule: "Weekly" },
};

/**
 * R10 skip reasons in words. A skip is a NORMAL outcome, and "noCwlGroup" read
 * like a failure to everyone who had not written the sync job.
 */
const SKIP_REASONS: Record<string, string> = {
  notInWar: "Not in a war",
  warEnded: "War already ended",
  noCwlGroup: "No CWL this week",
  noClansSeeded: "No clans added yet",
  notClanGames: "Clan Games not running",
  nothingToSnapshot: "Nothing to record",
  noPlayers: "No players to read yet",
};

function jobLabel(jobType: string): string {
  return JOB_LABELS[jobType]?.label ?? jobType;
}

/** One row of the history table. */
function RunRow({ run, clanNames }: { run: SyncRunRecord; clanNames: Map<string, string> }) {
  const state = freshness(run);
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 60_000));

  return (
    <tr className="border-b align-top last:border-0">
      <td className="py-2.5 pr-4">
        <span className="block text-sm font-medium">{jobLabel(run.jobType)}</span>
        <span className="text-muted-foreground font-mono text-xs">{run.jobType}</span>
      </td>
      <td className="py-2.5 pr-4">
        {run.status === "failed" ? (
          <Badge variant="destructive">Failed</Badge>
        ) : run.status === "running" ? (
          <Badge variant="info">Running</Badge>
        ) : run.status === "skipped" ? (
          <Badge variant="secondary">Skipped</Badge>
        ) : (
          <Badge variant="success">Succeeded</Badge>
        )}
      </td>
      <td className="text-muted-foreground py-2.5 pr-4 text-sm">
        {run.clanId ? (clanNames.get(run.clanId) ?? "—") : "All clans"}
      </td>
      <td className="text-muted-foreground py-2.5 pr-4 text-sm whitespace-nowrap">{ago(minutes)}</td>
      <td className="text-muted-foreground py-2.5 pr-4 text-sm">
        {/* A skip is a NORMAL outcome (R10), so it shows its reason rather than a
            row count. */}
        {run.status === "skipped"
          ? (SKIP_REASONS[run.skipReason ?? ""] ?? run.skipReason ?? "Nothing to do")
          : run.status === "failed"
            ? (run.error?.slice(0, 120) ?? "No error recorded")
            : run.recordsWritten !== null
              ? `${run.recordsWritten} row${run.recordsWritten === 1 ? "" : "s"} saved`
              : state.level === "never"
                ? "Did not finish"
                : "—"}
      </td>
    </tr>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ history?: string }>;
}) {
  const { history } = await searchParams;
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const admin = await isPlatformAdmin(supabase, userId);
  const clans = await visibleClans(supabase, userId);
  const isLeaderSomewhere = clans.some((c) => isLeader(c.role));

  // "platform admin reads all clans" (015) means an admin sees every clan;
  // everyone else sees only their own. RLS decided it — not this page.
  const { data: allClans } = await supabase
    .from("clans")
    .select("id, tag, name")
    .is("deleted_at", null)
    .order("tag");

  const clanRows = (allClans ?? []) as Array<{ id: string; tag: string; name: string }>;
  const myClanIds = new Set(clans.map((c) => c.id));

  // Whether the platform has an owner at all. The claim itself is guarded by the
  // function and OWNER_EMAIL rather than by this.
  const { count: adminCount } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("is_platform_admin", true)
    .is("deleted_at", null);

  const unclaimed = !admin && (adminCount ?? 0) === 0;

  // T9.2 — read once and derive the failed list from it, so the "failed jobs"
  // panel cannot contradict the history table below it.
  const runs = await recentRuns(supabase, 50);
  const failed = failedRuns(runs);
  const clanNames = new Map(clanRows.map((c) => [c.id, c.name]));
  const canDispatch = dispatchConfig() !== null;
  const lastRun = runs[0] ?? null;
  const lastRunMinutes = lastRun
    ? Math.max(0, Math.floor((Date.now() - new Date(lastRun.startedAt).getTime()) / 60_000))
    : null;

  if (!admin && !isLeaderSomewhere && !unclaimed) {
    return (
      <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
        <PageHeader title="Admin" />
        <Alert variant="info">
          <CircleAlert aria-hidden />
          <AlertTitle>{clans.length === 0 ? "You are not in a clan yet" : "This page is for leaders"}</AlertTitle>
          <AlertDescription>
            {clans.length === 0
              ? "Your account is approved, but a leader still needs to add you to a clan. Ask them in game."
              : "Only clan leaders and the platform owner can manage clans and syncing."}
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const problems = groupFailures(runs);
  const tagNames = new Map(clanRows.map((c) => [c.tag, c.name]));
  // The sync writes the clan TAG into its messages; a person knows the name.
  const named = (error: string) =>
    error.replace(/#[0-9A-Z]{4,}/g, (tag) => (tagNames.has(tag) ? `${tagNames.get(tag)} (${tag})` : tag));

  const allHistory = history === "all";
  const HISTORY_FIRST = 10;
  const shownRuns = allHistory ? runs : runs.slice(0, HISTORY_FIRST);

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Admin"
        description="Set up clans, keep game data syncing, and review accounts and changes."
      />
      {/* The admin pages' own tab row. It replaces three link cards that were
          the ONLY way between these pages — from Accounts, the audit log was the
          browser's Back button away. */}
      <AdminNav current="overview" showFeedback={admin} />

      {/* Errors and "sync requested" come through the toast (lib/feedback.ts),
          which every page shares — the page no longer repeats them inline. */}

      {unclaimed && (
        <Panel className="space-y-3 border-2 border-dashed">
          <h2 className="text-lg font-semibold">First step: claim this platform</h2>
          <p className="text-muted-foreground text-sm">
            Nobody owns this installation yet. Claiming it makes you the platform owner,
            approves your account, and lets you add clans. It can only happen once, and only
            from the email address set as <code>OWNER_EMAIL</code>.
          </p>
          <form action={claimOwnership}>
            <SubmitButton pendingLabel="Claiming">Claim ownership</SubmitButton>
          </form>
        </Panel>
      )}

      {/* ── At a glance, in one line ────────────────────────────────────────
          Three big cards were two numbers and a word, and the first — how many
          clans — is the count on the Clans heading further down. Sync health is
          a STATUS, so it is a status badge with an icon and words; the last run
          is a fact beside it. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {failed.length > 0 ? (
          <Link href="#sync-problems">
            <Badge variant="destructive">
              <TriangleAlert aria-hidden />
              {failed.length} failed in the last {runs.length} runs —{" "}
              {problems.length} {problems.length === 1 ? "problem" : "problems"}
            </Badge>
          </Link>
        ) : (
          <Badge variant={runs.length === 0 ? "secondary" : "success"}>
            <CheckCircle2 aria-hidden />
            {runs.length === 0 ? "Sync not started" : `Sync healthy · last ${runs.length} runs`}
          </Badge>
        )}
        <FactRow
          items={[
            {
              label: lastRun ? `· last sync, ${jobLabel(lastRun.jobType)}` : "· no job has run yet",
              value: lastRunMinutes === null ? "Never" : ago(lastRunMinutes),
              icon: RefreshCw,
              title: "Last sync",
            },
          ]}
        />
      </div>

      {/* ── Sync problems: one row per PROBLEM, not per failed run ─────────── */}
      {problems.length > 0 && (
        <Panel id="sync-problems" aria-labelledby="problems-title" className="border-destructive/40 space-y-4">
          <SectionHeader
            id="problems-title"
            title="Sync problems"
            icon={TriangleAlert}
            count={problems.length}
            action={{ href: "/admin?history=all#sync-history", label: "Full history" }}
          />
          <ul className="divide-y">
            {problems.map((problem) => (
              <li
                key={`${problem.jobType}-${problem.clanId ?? "all"}-${problem.error}`}
                className="flex items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <span className="cb-emblem size-9 shrink-0 rounded-control" style={{ "--emblem": "var(--destructive)" } as React.CSSProperties}>
                  <TriangleAlert aria-hidden className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <span className="font-medium">{jobLabel(problem.jobType)}</span>
                    <span className="text-muted-foreground">
                      {problem.clanId ? (clanNames.get(problem.clanId) ?? "A clan") : "All clans"}
                    </span>
                    <Badge variant="destructive" title={`Failed ${problem.count} times in the last ${runs.length} runs`}>
                      ×{problem.count}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      last {ago(Math.max(0, Math.floor((Date.now() - new Date(problem.lastAt).getTime()) / 60_000)))}
                    </span>
                  </p>
                  <p className="text-sm break-words">{named(problem.error).slice(0, 240)}</p>
                  {problem.fix && (
                    <p className="text-muted-foreground flex items-start gap-1.5 text-sm">
                      <Wrench aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      {problem.fix}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* ── Clans ──────────────────────────────────────────────────────── */}
        <Panel aria-labelledby="clans-title" className="space-y-4">
          <div className="space-y-1">
            <SectionHeader id="clans-title" title="Clans" icon={Castle} count={clanRows.length} />
            <p className="text-muted-foreground text-sm">The clans this platform follows.</p>
          </div>

          {clanRows.length === 0 ? (
            <p className="text-muted-foreground rounded-panel border border-dashed p-4 text-sm">
              No clans yet. Add the first one below; its members arrive with the next hourly sync,
              or press <span className="font-medium">Run now</span> on Clan members.
            </p>
          ) : (
            <ul className="divide-y">
              {clanRows.map((clan) => (
                <li key={clan.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: clanAccent(clan.id).color }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{clan.name}</p>
                    <p className="text-muted-foreground font-mono text-xs">{clan.tag}</p>
                  </div>
                  {myClanIds.has(clan.id) ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/${encodeURIComponent(clan.tag)}`}>Open</Link>
                    </Button>
                  ) : (
                    admin && (
                      <form action={grantSelfLeader}>
                        <input type="hidden" name="clanId" value={clan.id} />
                        <SubmitButton variant="outline" size="sm" pendingLabel="Granting">
                          Make me leader
                        </SubmitButton>
                      </form>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}

          {admin && (
            <form action={addClan} className="space-y-3 border-t pt-4">
              <div className="space-y-1">
                <h3 className="font-medium">Add a clan</h3>
                <p className="text-muted-foreground text-sm">
                  Only the tag matters. The real name, badge and members are filled in by the
                  sync — the name you type is just a placeholder until then.
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[9rem] flex-1 space-y-1.5">
                  <Label htmlFor="tag">Clan tag</Label>
                  <Input id="tag" name="tag" required placeholder="#2PP0JCCL" autoCapitalize="characters" />
                </div>
                <div className="min-w-[9rem] flex-1 space-y-1.5">
                  <Label htmlFor="name">Name for now</Label>
                  <Input id="name" name="name" required placeholder="Clan name" />
                </div>
                <SubmitButton pendingLabel="Adding">
                  <Plus aria-hidden />
                  Add clan
                </SubmitButton>
              </div>
            </form>
          )}
        </Panel>

        {/* T9.2 — run a sync now. R2: this asks GitHub Actions to run the job; it
            never runs one here, because a Vercel function is killed at ten seconds. */}
        <Panel aria-labelledby="sync-now-title" className="space-y-4">
          <div className="space-y-1">
            <SectionHeader id="sync-now-title" title="Sync game data now" icon={RefreshCw} />
            <p className="text-muted-foreground text-sm">
              Every job already runs on a schedule. Use these only to repair missing data — each
              starts a GitHub Actions run, and the result appears in the history a few minutes
              later. Limited to a few per hour.
            </p>
          </div>

          {canDispatch ? (
            <ul className="divide-y">
              {(Object.keys(DISPATCHABLE) as Array<keyof typeof DISPATCHABLE>).map((job) => (
                <li key={job} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{jobLabel(job)}</p>
                    <p className="text-muted-foreground text-xs">{JOB_LABELS[job]?.schedule}</p>
                  </div>
                  <form action={triggerSync}>
                    <input type="hidden" name="job" value={job} />
                    <SubmitButton variant="outline" size="sm" pendingLabel="Requesting">
                      Run now
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          ) : (
            // Unconfigured is a state, not an error. A button that always fails teaches
            // an operator that the page is broken.
            <p className="text-muted-foreground text-sm">
              Manual runs are not set up. Set <code>GITHUB_DISPATCH_TOKEN</code> and{" "}
              <code>GITHUB_DISPATCH_REPO</code> to turn them on. Until then, use{" "}
              <strong>Run workflow</strong> on the Actions tab in GitHub.
            </p>
          )}
        </Panel>
      </div>

      {/* T9.2 — the history. R9 says every job writes to sync_log; this makes it visible. */}
      <Panel id="sync-history" aria-labelledby="history-title" className="space-y-4">
        <div className="space-y-1">
          <SectionHeader id="history-title" title="Sync history" icon={History} />
          <p className="text-muted-foreground text-sm">
            The last {runs.length} runs, newest first.{" "}
            <span className="text-foreground">Skipped</span> is normal — it means there was
            nothing to collect, like no war in progress.
          </p>
        </div>

        {runs.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No sync has run yet. Once a job runs — on its schedule or from the buttons above —
            every attempt appears here.
          </p>
        ) : (
          <>
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[40rem] text-left">
                <thead>
                  <tr className="text-muted-foreground border-b text-xs uppercase">
                    <th className="py-2 pr-4 font-medium">Job</th>
                    <th className="py-2 pr-4 font-medium">Result</th>
                    <th className="py-2 pr-4 font-medium">Clan</th>
                    <th className="py-2 pr-4 font-medium">Started</th>
                    <th className="py-2 pr-4 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRuns.map((run) => (
                    <RunRow key={run.id} run={run} clanNames={clanNames} />
                  ))}
                </tbody>
              </table>
            </div>
            {runs.length > HISTORY_FIRST && (
              // A link rather than a client toggle: the page stays a server
              // component, and the anchor brings the member back to the table.
              <Link
                href={allHistory ? "/admin#sync-history" : "/admin?history=all#sync-history"}
                scroll={false}
                className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex items-center justify-center gap-1.5 rounded-panel border border-dashed py-2 text-sm font-medium transition-colors"
              >
                {allHistory ? "Show the latest 10" : `Show all ${runs.length} runs`}
              </Link>
            )}
          </>
        )}
      </Panel>
    </main>
  );
}
