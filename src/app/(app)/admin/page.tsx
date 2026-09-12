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
import { InvalidTagError, normaliseTag } from "@/lib/tags";
import { isUniqueViolation, safeMessage } from "@/lib/errors";
import { failedRuns, recentRuns, type SyncRunRecord } from "@/repositories/sync-log";
import { ago, freshness } from "@/services/freshness";
import { DISPATCHABLE, dispatchConfig, dispatchWorkflow, isDispatchable } from "@/lib/github";
import { SYNC_TRIGGER_LIMIT, sharedRateLimiter } from "@/lib/rate-limit";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

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
  redirect("/admin");
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

  const { error } = await supabase
    .from("clan_roles")
    .insert({ user_id: userId, clan_id: clanId, role: "leader" });

  if (error) {
    // Almost always 015's "admin or leader grants roles" policy refusing, and
    // saying so by name would describe the policy to whoever tried it.
    safeMessage("grant-self-leader", error, "");
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
  if (!admin && !clans.some((c) => c.role === "leader")) {
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

/** One row of the history table. */
function RunRow({ run, clanNames }: { run: SyncRunRecord; clanNames: Map<string, string> }) {
  const state = freshness(run);
  const minutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(run.startedAt).getTime()) / 60_000),
  );

  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-4 font-mono text-xs">{run.jobType}</td>
      <td className="py-2 pr-4">
        <Badge
          variant={
            run.status === "failed"
              ? "destructive"
              : run.status === "running"
                ? "outline"
                : "secondary"
          }
        >
          {run.status}
        </Badge>
      </td>
      <td className="text-muted-foreground py-2 pr-4 text-sm">
        {run.clanId ? (clanNames.get(run.clanId) ?? "—") : "all clans"}
      </td>
      <td className="text-muted-foreground py-2 pr-4 text-sm">{ago(minutes)}</td>
      <td className="text-muted-foreground py-2 pr-4 text-sm">
        {/* A skip is a NORMAL outcome (R10), so it shows its reason rather than
            a row count — "noCwlGroup" is the answer three weeks a month. */}
        {run.status === "skipped"
          ? (run.skipReason ?? "skipped")
          : run.recordsWritten !== null
            ? `${run.recordsWritten} rows`
            : state.level === "never"
              ? "did not finish"
              : "—"}
      </td>
    </tr>
  );
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { error, ok } = await searchParams;
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const admin = await isPlatformAdmin(supabase, userId);
  const clans = await visibleClans(supabase, userId);
  const isLeaderSomewhere = clans.some((c) => c.role === "leader");

  // "platform admin reads all clans" (015) means an admin sees every clan;
  // everyone else sees only their own. Either way this is the list they may act
  // on, and RLS decided it — not this page.
  const { data: allClans } = await supabase
    .from("clans")
    .select("id, tag, name")
    .is("deleted_at", null)
    .order("tag");

  const clanRows = (allClans ?? []) as Array<{ id: string; tag: string; name: string }>;
  const myClanIds = new Set(clans.map((c) => c.id));

  // Whether the platform has an owner at all. A non-admin can see zero rows here
  // either because there is no admin or because RLS hid one — which is exactly
  // why the claim is guarded by the function and OWNER_EMAIL rather than by this.
  const { count: adminCount } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("is_platform_admin", true)
    .is("deleted_at", null);

  const unclaimed = !admin && (adminCount ?? 0) === 0;

  // T9.2 — read once and derive the failed list from it, rather than querying
  // twice. Two reads of a table a live sync job is writing to can disagree, and
  // a "failed jobs" panel contradicting the history table directly below it is
  // worse than either on its own. RLS scopes these rows; see recentRuns().
  const runs = await recentRuns(supabase, 50);
  const failed = failedRuns(runs);
  const clanNames = new Map(clanRows.map((c) => [c.id, c.name]));
  const canDispatch = dispatchConfig() !== null;

  if (!admin && !isLeaderSomewhere && !unclaimed) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Nothing here yet</h1>
        {clans.length === 0 ? (
          // Approved, but belonging to no clan. Only reachable when a platform
          // admin approves an account before there is a clan to put it in (018),
          // so say what actually needs to happen rather than "access denied".
          <p className="text-muted-foreground text-sm">
            Your account is approved but you are not in any clan yet. A leader
            needs to add you to one — ask them in game.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            You do not have administrative access.
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <p className="text-muted-foreground text-sm">
          Clans, accounts and sync health.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>
            {error === "bad-tag"
              ? "That is not a valid clan tag. Tags start with # and never contain the letter O — what looks like an O is a zero."
              : error === "duplicate"
                ? "That clan has already been added."
                : error === "not-owner"
                  ? "This account is not the configured owner. Set OWNER_EMAIL to the address you sign in with."
                  : error === "no-name"
                    ? "Give the clan a name."
                    : error === "forbidden"
                      ? "You do not have permission to do that."
                      : error === "unknown-job"
                        ? "That is not a job that can be started by hand."
                        : error === "rate-limited"
                          ? "Too many manual runs. A sync is a repair, not a routine — wait an hour."
                          : error === "claim-failed"
                            ? "The ownership claim was refused. Either this platform already has an admin, or something went wrong — check the server log."
                            : error === "add-clan-failed"
                              ? "Could not add that clan. Check the server log for why."
                              : error === "grant-failed"
                                ? "Could not grant you leader of that clan. You need to be the platform admin or already lead it."
                                : // T10.8d — the remaining case is dispatchWorkflow's
                                  // `detail`, which is text this project writes
                                  // (lib/github.ts), not a database message.
                                  error}
          </AlertDescription>
        </Alert>
      )}

      {ok === "dispatched" && (
        <Alert>
          {/* Deliberately not "sync complete". GitHub returns 204 to say it
              ACCEPTED the request, not that the job ran — the real answer lands
              in the history below, minutes later. */}
          <AlertTitle>Asked GitHub to run it</AlertTitle>
          <AlertDescription>
            The run takes a minute or two to start. It will appear in the history
            below when it finishes.
          </AlertDescription>
        </Alert>
      )}

      {failed.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>
            {failed.length === 1 ? "1 sync job failed" : `${failed.length} sync jobs failed`}
          </AlertTitle>
          <AlertDescription>
            <ul className="mt-1 space-y-1">
              {failed.slice(0, 5).map((run) => (
                <li key={run.id} className="text-sm">
                  <span className="font-mono text-xs">{run.jobType}</span>
                  {run.error ? ` — ${run.error.slice(0, 160)}` : ""}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {unclaimed && (
        <section className="space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">Claim this platform</h2>
          <p className="text-muted-foreground text-sm">
            Nobody owns this installation yet. Claiming it makes you the platform
            admin, approves your account, and lets you add the clans. This can only
            happen once, and only from the address in <code>OWNER_EMAIL</code>.
          </p>
          <form action={claimOwnership}>
            <SubmitButton>Claim ownership</SubmitButton>
          </form>
        </section>
      )}

      {admin && (
        <section className="space-y-4 rounded-lg border p-6">
          <div className="space-y-1">
            <h2 className="font-medium">Add a clan</h2>
            <p className="text-muted-foreground text-sm">
              The tag is all you provide. Name, badge and the member list are filled
              in by the hourly sync — they belong to the game, not to you.
            </p>
          </div>

          <form action={addClan} className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="tag">Clan tag</Label>
              <Input
                id="tag"
                name="tag"
                required
                placeholder="#2PP0JCCL"
                autoCapitalize="characters"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name (placeholder)</Label>
              <Input id="name" name="name" required placeholder="Clan name" />
            </div>
            <SubmitButton>Add</SubmitButton>
          </form>
        </section>
      )}

      <section className="space-y-4 rounded-lg border p-6">
        <h2 className="font-medium">Clans</h2>

        {clanRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No clans yet. Add the first one above, then run{" "}
            <code>npm run sync:clans</code> to pull in its members.
          </p>
        ) : (
          <ul className="divide-y">
            {clanRows.map((clan) => (
              <li key={clan.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{clan.name}</p>
                  <p className="text-muted-foreground font-mono text-xs">{clan.tag}</p>
                </div>

                {myClanIds.has(clan.id) ? (
                  <Link
                    href={`/${encodeURIComponent(clan.tag)}`}
                    className="text-sm hover:underline"
                  >
                    Open
                  </Link>
                ) : (
                  admin && (
                    <form action={grantSelfLeader}>
                      <input type="hidden" name="clanId" value={clan.id} />
                      <SubmitButton variant="outline" size="sm">
                        Make me leader
                      </SubmitButton>
                    </form>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* T9.2 — run a sync now. R2: this asks GitHub Actions to run the job; it
          never runs one here, because a Vercel function is killed at ten seconds
          and would leave a CWL sync half written. */}
      <section className="space-y-4 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="font-medium">Run a sync now</h2>
          <p className="text-muted-foreground text-sm">
            Starts the same GitHub Actions workflow the schedule uses. Results
            appear in the history below, not immediately.
          </p>
        </div>

        {canDispatch ? (
          <div className="flex flex-wrap gap-2">
            {(Object.keys(DISPATCHABLE) as Array<keyof typeof DISPATCHABLE>).map((job) => (
              <form key={job} action={triggerSync}>
                <input type="hidden" name="job" value={job} />
                <SubmitButton variant="outline" size="sm">
                  {job}
                </SubmitButton>
              </form>
            ))}
          </div>
        ) : (
          // Unconfigured is a state, not an error — the same shape as
          // pushConfigured(). Offering a button that always fails teaches an
          // operator that the page is broken.
          <p className="text-muted-foreground text-sm">
            Manual runs are not configured. Set <code>GITHUB_DISPATCH_TOKEN</code>{" "}
            and <code>GITHUB_DISPATCH_REPO</code> to enable them. Until then, use
            the <strong>Run workflow</strong> button on the Actions tab in GitHub.
          </p>
        )}
      </section>

      {/* T9.2 — the history. R9 says every job writes to sync_log; this is what
          makes that record visible, and without it the log catches nothing. */}
      <section className="space-y-4 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="font-medium">Sync history</h2>
          <p className="text-muted-foreground text-sm">
            The last {runs.length} runs, newest first.
          </p>
        </div>

        {runs.length === 0 ? (
          // T9.10 — "a sync that has never run" is the state of a fresh install,
          // not an edge case, and it needs to say what to do next.
          <p className="text-muted-foreground text-sm">
            No sync has ever run. Once a workflow runs — on its schedule, or from
            the buttons above — every attempt is recorded here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="text-muted-foreground border-b text-xs">
                  <th className="py-2 pr-4 font-medium">Job</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Clan</th>
                  <th className="py-2 pr-4 font-medium">Started</th>
                  <th className="py-2 pr-4 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <RunRow key={run.id} run={run} clanNames={clanNames} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2 rounded-lg border p-6">
        <h2 className="font-medium">Accounts</h2>
        <p className="text-muted-foreground text-sm">
          Approve or decline people waiting to join.
        </p>
        <Button asChild variant="outline">
          <Link href="/admin/members">Pending accounts</Link>
        </Button>
      </section>

      {/* T9.6 — R4 records every write, and this is what makes that record
          visible. Shown to everyone who reaches /admin; the page itself explains
          that only a clan's leader can read entries, because the log holds
          entries about co-leaders too. */}
      <section className="space-y-2 rounded-lg border p-6">
        <h2 className="font-medium">Audit log</h2>
        <p className="text-muted-foreground text-sm">
          Who changed what, and when. Leaders only — nothing in it can be edited
          or removed.
        </p>
        <Button asChild variant="outline">
          <Link href="/admin/audit">View audit log</Link>
        </Button>
      </section>
    </main>
  );
}
