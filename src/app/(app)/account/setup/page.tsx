// T10.5 — Finish making the account.
//
// Every account arrives here exactly once, straight off its first magic link,
// and cannot go anywhere else until it leaves. That is enforced in
// (app)/layout.tsx, which runs this check BEFORE the T3.8 approval gate — see
// the comment there on why that order is the whole thing working.
//
// WHY IT IS COMPULSORY. The alternative was an optional page in settings, and
// the failure mode is silent: members skip it, the Sign in button does not work
// for them, and the only way they discover that is by trying to sign in without
// their inbox and failing. A door that works for some accounts and not others is
// worse than one door.
//
// The username is NOT the sign-in identifier — that is the email. It is the
// handle shown in the shell so a member with two accounts can tell them apart,
// which is the problem T10 exists to solve. Migration 030 says the same thing at
// more length.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { accountProfile, currentUserId } from "@/lib/auth";
import {
  normaliseUsername,
  passwordProblem,
  PASSWORD_MIN_LENGTH,
  usernameProblem,
} from "@/lib/account";
import { isUniqueViolation, safeMessage } from "@/lib/errors";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

const PATH = "/account/setup";

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

export default async function AccountSetupPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const profile = await accountProfile(supabase, userId);

  // Reachable directly, so it has to check rather than assume the layout sent
  // them. A member who has already finished has no business re-entering the
  // compulsory version of this form; changing either value afterwards is what
  // /settings/account is for.
  if (profile?.username && profile.passwordSetAt) redirect("/");

  async function save(formData: FormData) {
    "use server";

    const supabase = await createClient();
    const userId = await currentUserId(supabase);
    if (!userId) redirect("/login");

    const username = normaliseUsername(String(formData.get("username") ?? ""));
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");

    // Validated here as well as by the check constraint in 030, so the member
    // reads a sentence instead of `violates check constraint`.
    const problem = usernameProblem(username) ?? passwordProblem(password, confirmation);
    if (problem) fail(problem);

    // ORDER MATTERS, and it is username -> password -> password_set_at.
    //
    // The username is the write that can fail on someone else's data (the
    // unique index), so it goes first — failing after the password was set would
    // leave an account that is half made with no sign of it. password_set_at is
    // last because it is the flag the gate reads: while it is null the member
    // re-enters this page, which is the correct place to be if any step above it
    // did not finish. The page is re-entrant, and rewriting your own username to
    // the value it already has does not trip the index.
    const { error: usernameError } = await supabase
      .from("users")
      .update({ username })
      .eq("id", userId);

    if (usernameError) {
      if (isUniqueViolation(usernameError, "users_username_key")) {
        fail("That username is taken. Pick another.");
      }
      fail(safeMessage("account-setup username", usernameError, "Could not save that username."));
    }

    // The password itself goes to Supabase, never to this database. There is no
    // password column in public.users and there must never be one — see 030.
    const { error: passwordError } = await supabase.auth.updateUser({ password });
    if (passwordError) {
      // Supabase applies the project's own minimum length and its leaked-password
      // check here, and both produce messages worth showing: they tell the member
      // what to change. This is the one place a Supabase message is passed
      // through, because there is no account to enumerate — they are already
      // signed in as themselves.
      fail(passwordError.message);
    }

    const { error: flagError } = await supabase
      .from("users")
      .update({ password_set_at: new Date().toISOString() })
      .eq("id", userId);

    if (flagError) {
      // The password IS set at this point; only the flag failed. Saying "try
      // again" is right — the retry re-sets the same password and rewrites the
      // flag, and nothing is left inconsistent.
      fail(safeMessage("account-setup flag", flagError, "Almost there — try that once more."));
    }

    revalidatePath("/", "layout");
    redirect("/");
  }

  return (
    <main className="mx-auto max-w-md space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <h1 className="cb-title text-3xl">Finish your account</h1>
        <p className="text-muted-foreground text-sm">
          Signed in as {profile?.email}. Choose a username and a password, and you
          can sign in from now on without waiting for an email.
        </p>
      </div>

      {/* No inline "Not saved" Alert: the toast mounted by the (app) layout
          already shows every ?error=, and the page said it twice. */}
      <form action={save} className="cb-panel space-y-4 rounded-panel border p-5">
        <div className="space-y-2">
          <Label htmlFor="username">Username</Label>
          <Input
            id="username"
            name="username"
            required
            autoFocus
            autoComplete="username"
            defaultValue={profile?.username ?? ""}
            placeholder="shashi"
          />
          <p className="text-muted-foreground text-xs">
            3–20 characters: lowercase letters, numbers and underscores. This is
            how your clan sees you here — you still sign in with your email.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
          />
          <p className="text-muted-foreground text-xs">
            At least {PASSWORD_MIN_LENGTH} characters.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmation">Confirm password</Label>
          <Input
            id="confirmation"
            name="confirmation"
            type="password"
            required
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
          />
        </div>

        <SubmitButton className="w-full">
          Save and continue
        </SubmitButton>
      </form>

      <p className="text-muted-foreground text-xs">
        This does not approve your account. A leader still reviews every new
        member before any clan data is visible.
      </p>
    </main>
  );
}
