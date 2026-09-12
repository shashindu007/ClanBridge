// T10.7 — Change the username or the password afterwards.
//
// The mirror of /account/setup, which is compulsory and runs once. This one is
// voluntary and runs whenever, and it is also the end of the password-reset
// path: there is no resetPasswordForEmail flow in this project, because the
// magic link already is one. Forgot your password -> sign in with a link ->
// come here -> set a new one. One email template, no extra route, and the link
// is a mechanism that already has to work.
//
// THE CURRENT PASSWORD IS NOT REQUIRED, and that is a decision rather than an
// omission. Requiring it would close the reset path above for exactly the people
// who need it — someone who has forgotten their password cannot type it. The
// session is the proof of identity here, which is the same proof every other
// write in this product accepts. If that trade stops being acceptable, the thing
// to turn on is Supabase's "secure password change" reauthentication setting,
// which enforces a recent sign-in at the auth layer where it belongs; do not
// reimplement it here.
//
// Not under [clanTag]: an account is per member, not per clan.

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
import { SignOutButton } from "@/components/sign-out-button";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

const PATH = "/settings/account";

function fail(message: string): never {
  redirect(`${PATH}?error=${encodeURIComponent(message)}`);
}

function done(message: string): never {
  // `?ok=`, and the value is a whole sentence rather than a code. That is
  // the pass-through lib/feedback.ts documents: messageFor() returns an
  // unrecognised value unchanged, which is exactly right for a message this
  // project wrote.
  redirect(`${PATH}?ok=${encodeURIComponent(message)}`);
}

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const profile = await accountProfile(supabase, userId);

  async function saveUsername(formData: FormData) {
    "use server";

    const supabase = await createClient();
    const userId = await currentUserId(supabase);
    if (!userId) redirect("/login");

    const username = normaliseUsername(String(formData.get("username") ?? ""));
    const problem = usernameProblem(username);
    if (problem) fail(problem);

    const { error } = await supabase.from("users").update({ username }).eq("id", userId);

    if (error) {
      if (isUniqueViolation(error, "users_username_key")) {
        fail("That username is taken. Pick another.");
      }
      fail(safeMessage("settings username", error, "Could not save that username."));
    }

    // "layout", because the shell shows the username on every page — a rename
    // that only takes effect on this one looks like it did not save.
    revalidatePath("/", "layout");
    done("Username changed.");
  }

  async function savePassword(formData: FormData) {
    "use server";

    const supabase = await createClient();
    const userId = await currentUserId(supabase);
    if (!userId) redirect("/login");

    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");

    const problem = passwordProblem(password, confirmation);
    if (problem) fail(problem);

    const { error } = await supabase.auth.updateUser({ password });
    // Passed through: Supabase's own minimum-length and leaked-password messages
    // tell the member what to change, and there is no account to enumerate — they
    // are already signed in as themselves.
    if (error) fail(error.message);

    // Also stamps password_set_at, which matters for an account that reached
    // this page through the reset path before ever completing setup.
    const { error: flagError } = await supabase
      .from("users")
      .update({ password_set_at: new Date().toISOString() })
      .eq("id", userId);

    if (flagError) {
      safeMessage("settings password flag", flagError, "");
    }

    revalidatePath("/", "layout");
    done("Password changed. Your other devices stay signed in.");
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-muted-foreground text-sm">
          Signed in as {profile?.email}. Your email is what you sign in with and
          it cannot be changed here — ask a leader if it is wrong.
        </p>
      </div>

      {/* Both alerts that were here are now the toast — see
          components/toaster.tsx. This page redirects a whole SENTENCE rather
          than a code, which messageFor() passes through unchanged. */}

      <section className="space-y-4 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="font-medium">Username</h2>
          <p className="text-muted-foreground text-sm">
            How you appear here. Not what you sign in with.
          </p>
        </div>

        <form action={saveUsername} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              required
              autoComplete="username"
              defaultValue={profile?.username ?? ""}
            />
            <p className="text-muted-foreground text-xs">
              3–20 characters: lowercase letters, numbers and underscores.
            </p>
          </div>
          <SubmitButton>Save username</SubmitButton>
        </form>
      </section>

      <section className="space-y-4 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="font-medium">Password</h2>
          <p className="text-muted-foreground text-sm">
            Used with your email on the Sign in form. If you have forgotten it,
            you are already past that — signing in with an emailed link brought
            you here, and setting a new one below is the whole of the reset.
          </p>
        </div>

        <form action={savePassword} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
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
            <Label htmlFor="confirmation">Confirm new password</Label>
            <Input
              id="confirmation"
              name="confirmation"
              type="password"
              required
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
            />
          </div>
          <SubmitButton>Change password</SubmitButton>
        </form>
      </section>

      <section className="space-y-3 rounded-lg border p-6">
        <div className="space-y-1">
          <h2 className="font-medium">This device</h2>
          <p className="text-muted-foreground text-sm">
            Signing out clears this browser and lets you sign in as somebody
            else — a second account, or a clanmate borrowing your phone.
          </p>
        </div>
        <SignOutButton className="text-sm font-medium" />
      </section>
    </main>
  );
}
