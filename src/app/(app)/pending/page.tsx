// T3.8 — Account approval gate.
//
// Where every new account lands. Magic-link signup alone means anyone with an
// email address can create an account; verification proves they own *a* Clash of
// Clans account, not that they belong to *these* clans. So a new user sees
// nothing until a leader approves them.
//
// This deployment uses manual leader approval only. Verifying a tag never
// approves anyone — it links the account and puts the applicant in front of the
// right leader (016's link_verified_player sets requested_clan_id).
//
// The page's job is to tell the member which of the two steps they are on, so
// that waiting feels like a queue rather than a bug.

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default async function PendingApprovalPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);

  // "read own profile" (006) makes this the user's own row and nothing else.
  // T12.2 — no `deleted_at is null` filter. A removed account is exactly who
  // this page now has to speak to, and filtering the row out would leave it
  // rendering "Waiting for approval" at somebody whose access was taken away.
  const { data } = await supabase
    .from("users")
    .select("status, requested_clan_id, deleted_at")
    .eq("id", userId ?? "");

  const row = data?.[0] as
    | { status: string; requested_clan_id: string | null; deleted_at: string | null }
    | undefined;

  // T11.13 — an approved member has no business here, and before Phase 11 nothing
  // sent one. /verify's Continue button did: an approved member adding a second
  // village landed on a page headed "Waiting for approval", which reads as the
  // second base having un-approved them.
  //
  // A redirect rather than an inline "you are approved" panel. A page whose <h1>
  // is "Waiting for approval" cannot be made to say the opposite without reading
  // as a bug, and /account is where the village they just linked now appears.
  //
  // The gate in (app)/layout.tsx cannot do this: /pending is in GATE_EXEMPT
  // precisely so an unapproved member can reach it, and exemption is not
  // direction-aware.
  if (row?.status === "approved") redirect("/account");

  const removed = Boolean(row?.deleted_at);
  const rejected = row?.status === "rejected";
  const verified = Boolean(row?.requested_clan_id);

  // T12.2 — removed is checked FIRST, because a removed account is also
  // 'rejected' and the two need different sentences. "A leader reviewed this
  // account and declined it" is wrong and confusing for someone who has been
  // using the product for months: nothing was reviewed, something was taken
  // away, and the difference is the whole reason they are reading this.
  if (removed) {
    return (
      <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
        <h1 className="cb-title text-3xl">
          This account has been removed
        </h1>
        <Alert variant="destructive">
          <AlertTitle>Access removed</AlertTitle>
          <AlertDescription>
            A clan leader removed this account, so it can no longer see any clan
            data. Nothing has been deleted — if this was a mistake, a leader can
            restore it. Speak to them in game.
          </AlertDescription>
        </Alert>
        {/* No links out. The layout sends a removed account back here from
            every other path, so a button offering to go somewhere would be a
            button that returns them to this page. Sign out is in the account
            menu above, which is the one thing left to do. */}
      </main>
    );
  }

  if (rejected) {
    return (
      <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
        <h1 className="cb-title text-3xl">
          This account was not approved
        </h1>
        <Alert variant="destructive">
          <AlertTitle>Access declined</AlertTitle>
          <AlertDescription>
            A leader reviewed this account and declined it. If you think that was a
            mistake, speak to your clan leader in game.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <h1 className="cb-title text-3xl">
          Waiting for approval
        </h1>
        <p className="text-muted-foreground text-sm">
          Your account exists but cannot see any clan data yet.
        </p>
      </div>

      <ol className="space-y-4">
        <li className="flex gap-3">
          <span aria-hidden className="text-lg leading-none">
            {verified ? "✓" : "1."}
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {verified
                ? "Your Clash of Clans account is linked"
                : "Link your Clash of Clans account"}
            </p>
            {!verified && (
              <p className="text-muted-foreground text-sm">
                Prove the account is yours with the in-game API token. Until you do,
                no leader can tell who you are.
              </p>
            )}
          </div>
        </li>

        <li className="flex gap-3">
          <span aria-hidden className="text-lg leading-none">
            2.
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium">A leader approves you</p>
            <p className="text-muted-foreground text-sm">
              {verified
                ? "A leader of your clan has been asked. This is a manual step, so it may take a while — nudge them in game if it drags."
                : "Once your account is linked, the leader of that clan can approve you."}
            </p>
          </div>
        </li>
      </ol>

      {!verified && (
        <Button asChild className="w-full sm:w-auto">
          <Link href="/verify">Link my account</Link>
        </Button>
      )}

      <p className="text-muted-foreground text-xs">
        Nothing here updates automatically — reload this page to check.
      </p>
    </main>
  );
}
