// T3.8 — Approve or decline pending accounts.
//
// (T9.2 adds role adjustment and member management to this page later.)
//
// Both actions are RPCs from 015, not table writes. approve_account() checks the
// caller's authority, sets the status, and writes audit_log in one indivisible
// act — which is why `users` has no general update policy and why doing this with
// a form that PATCHes the row would be wrong.
//
// R4 — a declined account is marked 'rejected', never deleted. The row and the
// record of who declined it survive.
//
// Who appears here is decided by RLS, not by this file: 013's "leaders read
// pending applicants to their clans" filters on requested_clan_id, and 015's
// "platform admin reads all users" shows an admin everyone. A leader of clan A
// physically cannot read clan B's applicants, so there is nothing to filter here.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { safeMessage } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

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
  redirect("/admin/members");
}

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const { data } = await supabase
    .from("users")
    .select("id, email, display_name, status, requested_clan_id, created_at")
    .eq("status", "pending")
    .is("deleted_at", null)
    .order("created_at");

  const pending = (data ?? []).filter((u) => (u as { id: string }).id !== userId) as Array<{
    id: string;
    email: string;
    display_name: string | null;
    requested_clan_id: string | null;
    created_at: string;
  }>;

  // Names for the clan column. Only clans this caller may read come back, which
  // is the correct set by construction.
  const clanIds = [...new Set(pending.map((u) => u.requested_clan_id).filter(Boolean))];
  const { data: clanRows } = clanIds.length
    ? await supabase.from("clans").select("id, name").in("id", clanIds as string[])
    : { data: [] };

  const clanName = new Map(
    ((clanRows ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]),
  );

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Pending accounts</h1>
        <p className="text-muted-foreground text-sm">
          People who have signed in and are waiting to be let in.
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>
            {error === "refused"
              ? "The database refused that. Either you do not lead the clan this person applied to, they have not linked a player account yet, or their account is no longer pending."
              : error === "bad-request"
                ? "Something was missing from that request."
                : // T10.8d — every code this page produces is handled above, so
                  // this branch is now unreachable rather than a place raw
                  // Postgres text arrives.
                  "That did not work. Check the server log for why."}
          </AlertDescription>
        </Alert>
      )}

      {pending.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Nobody is waiting. Accounts appear here once someone signs in and links a
          player account in one of your clans.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {pending.map((user) => (
            <li key={user.id} className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {user.display_name ?? user.email}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  {user.requested_clan_id
                    ? `Verified in ${clanName.get(user.requested_clan_id) ?? "a clan"}`
                    : "Not verified — has not linked a player account yet"}
                </p>
              </div>

              <div className="flex gap-2">
                <form action={decide}>
                  <input type="hidden" name="userId" value={user.id} />
                  <input type="hidden" name="action" value="approve" />
                  <Button type="submit" size="sm" disabled={!user.requested_clan_id}>
                    Approve
                  </Button>
                </form>
                <form action={decide}>
                  <input type="hidden" name="userId" value={user.id} />
                  <input type="hidden" name="action" value="reject" />
                  <Button type="submit" size="sm" variant="outline">
                    Decline
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-muted-foreground text-xs">
        Approving lets someone in as a <strong>member</strong> of the clan they
        verified in. Promoting them to elder or co-leader is separate and
        deliberate — an in-game promotion never changes what they can do here.
      </p>
    </main>
  );
}
