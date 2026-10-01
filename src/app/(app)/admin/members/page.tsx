// T3.8 / T12.2 — the accounts on this platform.
//
// This page used to read `status = 'pending'` and nothing else, so an account
// vanished from the only screen that ever showed it at the moment it was
// approved. Approving somebody was a one-way door: no list of who held an
// account, no way to open one, no way to reach the person, and no way to take
// access away again. T12.2 is the handle on the other side, and this file is
// the list half of it — /admin/members/[userId] is the account itself.
//
// WHAT DECIDES WHO APPEARS HERE is admin_accounts() (039), not this file. A
// platform admin sees every account; a leader sees accounts in the clans they
// lead plus the applicants to them. A leader of clan A physically cannot read
// clan B's, so there is nothing to filter here — the same argument the old
// version of this file made about RLS, now made about the function that
// replaced those policies for this screen.
//
// Both approval actions are still RPCs from 015, not table writes.
// approve_account() checks the caller's authority, sets the status, and writes
// audit_log in one indivisible act — which is why `users` has no general update
// policy and why doing this with a form that PATCHes the row would be wrong.
//
// R4 — a declined account is marked 'rejected' and a removed one keeps its row.
// Nothing on this page deletes anything.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Search, UserCheck, UserX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { safeMessage } from "@/lib/errors";
import { adminAccounts, clansLeftInGame, type AdminAccount } from "@/repositories/accounts";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AdminNav } from "@/components/admin-nav";

export const dynamic = "force-dynamic";

async function decide(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const target = String(formData.get("userId") ?? "");
  const action = String(formData.get("action") ?? "");

  if (!target || (action !== "approve" && action !== "reject")) {
    redirect("/admin/members?error=bad-request");
  }

  const { data, error } = await supabase.rpc(
    action === "approve" ? "approve_account" : "reject_account",
    { target },
  );

  // T10.8d — a code, not the raw text. approve_account() raises by name for
  // "accounts cannot approve themselves", and the rest are Postgres internals
  // that describe the definer function to whoever is poking at it.
  if (error) {
    safeMessage(`admin-members ${action}`, error, "");
    redirect("/admin/members?error=failed");
  }

  // The RPCs return false rather than raising when the caller lacks authority or
  // the account is no longer pending. Surfacing that matters: a silent no-op
  // looks identical to success, and the leader would believe someone was let in.
  if (data === false) {
    redirect("/admin/members?error=refused");
  }

  revalidatePath("/admin/members");
  redirect("/admin/members?ok=member-updated");
}

/** How a status reads to somebody who did not write the schema. */
function StatusBadge({ account }: { account: AdminAccount }) {
  if (account.removedAt) return <Badge variant="destructive">Removed</Badge>;
  if (account.status === "pending") return <Badge variant="info">Waiting</Badge>;
  if (account.status === "rejected") return <Badge variant="secondary">Declined</Badge>;
  return <Badge variant="success">Active</Badge>;
}

/**
 * The line under the name: which clans, or why there are none.
 *
 * An account with no clan is the state this whole screen exists to make
 * visible, and there are three different reasons for it — waiting to be
 * approved, removed, or approved but never added to anything. Collapsing them
 * into an empty cell is what made the old page unable to explain itself.
 */
function accountSubtitle(account: AdminAccount): string {
  if (account.memberships.length > 0) {
    return account.memberships.map((m) => `${m.clan} — ${m.role}`).join(", ");
  }
  if (account.removedAt) return "No clans — access was removed";
  if (account.status === "pending") {
    return account.requestedClan
      ? `Verified in ${account.requestedClan}, waiting for approval`
      : "Not verified — has not linked a player account yet";
  }
  return "Approved, but not in any clan yet";
}

export default async function AdminAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  // The search term goes to the database rather than filtering an array here:
  // a leader's list is small, but 039 matches village tags and names too, and
  // reproducing that join in JavaScript would mean two definitions of what a
  // search finds.
  const accounts = await adminAccounts(supabase, q);
  const waiting = accounts.filter((a) => a.status === "pending" && !a.removedAt);

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Accounts"
        description="Everyone who has signed up, whether they are waiting, active or removed. Open one to change their clan role, message them, or take their access away."
      />
      <AdminNav
        current="accounts"
        showFeedback={accounts.some((a) => a.id === userId && a.isPlatformAdmin)}
      />

      {/* Errors and confirmations come through the shared toast
          (lib/feedback.ts), so this page does not repeat them inline. */}

      {waiting.length > 0 && (
        <div className="bg-muted/50 flex items-center gap-3 rounded-panel border p-4">
          <UserCheck aria-hidden className="size-5 shrink-0" />
          <p className="text-sm">
            <strong>
              {waiting.length === 1
                ? "1 account is waiting"
                : `${waiting.length} accounts are waiting`}
            </strong>{" "}
            <span className="text-muted-foreground">
              — they appear first in the list below.
            </span>
          </p>
        </div>
      )}

      {/* A GET form, so a search is a URL a leader can bookmark or reload, and
          so the back button works. A Server Action here would make the result
          of a search unreachable by address. */}
      <form className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="q">Find an account</Label>
          <Input
            id="q"
            name="q"
            defaultValue={q ?? ""}
            placeholder="Email, username, village name or tag"
          />
        </div>
        <SubmitButton variant="outline" pendingLabel="Searching">
          <Search aria-hidden />
          Search
        </SubmitButton>
        {q && (
          <Button asChild variant="ghost">
            <Link href="/admin/members">Clear</Link>
          </Button>
        )}
      </form>

      {accounts.length === 0 ? (
        <div className="rounded-panel border border-dashed p-6 text-center">
          <UserX aria-hidden className="text-muted-foreground mx-auto size-6" />
          <p className="mt-2 text-sm font-medium">
            {q ? "No account matches that" : "No accounts to show"}
          </p>
          <p className="text-muted-foreground mt-1 text-sm">
            {q
              ? "Try part of an email address, a username, or a village tag."
              : "Accounts appear here once someone signs in. If you lead a clan, you see the accounts in it; the platform owner sees them all."}
          </p>
        </div>
      ) : (
        <ul className="cb-panel divide-y rounded-panel border">
          {accounts.map((account) => (
            <li key={account.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/admin/members/${account.id}`}
                    className="text-primary truncate text-sm font-medium hover:underline"
                  >
                    {account.username ?? account.displayName ?? account.email}
                  </Link>
                  <StatusBadge account={account} />
                  {account.isPlatformAdmin && <Badge variant="secondary">Owner</Badge>}
                  {!account.removedAt &&
                    clansLeftInGame(account).map((m) => (
                      // Still holds a role in this clan, but none of their
                      // villages is in it any more. One badge per clan, so a
                      // member who left one of two clans is still flagged. See
                      // clansLeftInGame() for why this is a flag for a leader
                      // and not an automatic removal.
                      <Badge key={m.clanId} variant="warning">
                        Left {m.clan} in game
                      </Badge>
                    ))}
                  {account.id === userId && <Badge variant="outline">You</Badge>}
                  {account.unreadMessages > 0 && (
                    <Badge variant="outline">
                      {account.unreadMessages} unread
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground truncate text-xs">
                  {accountSubtitle(account)}
                </p>
                {/* The village is how a leader actually recognises somebody —
                    an email address is not a name anyone knows in game. */}
                {account.players.length > 0 && (
                  <p className="text-muted-foreground truncate text-xs">
                    {account.players.map((p) => `${p.name} ${p.tag}`).join(", ")}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                {/* Approve and decline stay on the list, because approving is
                    the one act done in a batch — a leader clearing five
                    applicants should not open five pages to do it. Everything
                    else about an account is on the account. */}
                {account.status === "pending" && !account.removedAt && (
                  <>
                    <form action={decide}>
                      <input type="hidden" name="userId" value={account.id} />
                      <input type="hidden" name="action" value="approve" />
                      <SubmitButton size="sm" disabled={!account.requestedClan}>
                        Approve
                      </SubmitButton>
                    </form>
                    <form action={decide}>
                      <input type="hidden" name="userId" value={account.id} />
                      <input type="hidden" name="action" value="reject" />
                      <SubmitButton size="sm" variant="outline">
                        Decline
                      </SubmitButton>
                    </form>
                  </>
                )}
                {/* No "Open" button: the name is the link, and a second link to
                    the same account on every row was one more thing to read. */}
                <ArrowRight aria-hidden className="text-muted-foreground size-4 self-center" />
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted-foreground text-xs">
        Approving lets someone in as a <strong>member</strong> of the clan they
        verified in. To make them an elder, co-leader or leader, or to add them
        to another clan, <strong>open their account</strong> and use Clan roles.
        An in-game promotion never changes what they can do here.
      </p>
    </main>
  );
}
