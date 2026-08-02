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
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default async function PendingApprovalPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);

  // "read own profile" (006) makes this the user's own row and nothing else.
  const { data } = await supabase
    .from("users")
    .select("status, requested_clan_id")
    .eq("id", userId ?? "")
    .is("deleted_at", null);

  const row = data?.[0] as
    | { status: string; requested_clan_id: string | null }
    | undefined;

  const rejected = row?.status === "rejected";
  const verified = Boolean(row?.requested_clan_id);

  if (rejected) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">
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
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
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
