// T3.1 / T10.6 — Sign in, and sign up.
//
// Two doors, deliberately different:
//
//   SIGN IN   email + password, POSTed to /api/auth/sign-in. The everyday one.
//             It exists because the magic link alone made a second account
//             practically unreachable — every switch meant opening an inbox, and
//             before T10.3 there was no way to sign out at all.
//   SIGN UP   the original magic link (signInWithOtp), unchanged. Still the only
//             way an account is created, so nothing about who can get in has
//             changed: a link proves the address, and a leader still approves
//             the person.
//
// The password is not set here. It is set at /account/setup, which every new
// account is held on immediately after its first link.
//
// FORGOTTEN PASSWORD is the sign-up door used again. There is no reset flow to
// build because the magic link already is one: get a link, land in the app, set
// a new password in Settings -> Account.

"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/safe-next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

/** Which door is showing. `sent` is the confirmation panel after a link goes out. */
type Mode = "signin" | "signup" | "sent";

function LoginForm() {
  const params = useSearchParams();

  // /auth/callback bounces back here with ?error= when a link is expired, reused
  // or malformed. Without surfacing it the member sees the plain form again and
  // reasonably concludes the link did nothing.
  const callbackError = params.get("error");

  // T10.3 — sign-out lands here. Saying so matters: an unannounced return to the
  // login form is indistinguishable from a session that expired by itself, which
  // is exactly the confusion the sign-out button was added to end.
  const signedOut = params.get("signed-out") === "1";

  // Set by the middleware when it bounced an unauthenticated request, so signing
  // in returns the member to the page they actually asked for. Re-checked here
  // as well as on the server: this value reaches the form as a query parameter
  // anyone can write.
  const next = safeNext(params.get("next"));

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(callbackError ?? "");

  function switchTo(target: Mode) {
    setMode(target);
    setMessage("");
    setPassword("");
  }

  async function onSignIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, next }),
      });

      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; next?: string; error?: string }
        | null;

      if (!response.ok || !body?.ok) {
        setMessage(body?.error ?? "Could not sign in. Try again.");
        return;
      }

      // A full navigation, not router.push. The session cookies arrived on that
      // response, and the middleware has to run against them to decide where
      // this member actually goes — /account/setup, /pending, or the page they
      // originally asked for. A client-side transition would reuse the router
      // cache built while signed out.
      window.location.assign(body.next ?? next);
    } catch {
      setMessage("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function onSendLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    const supabase = createClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    setBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMode("sent");
  }

  if (mode === "sent") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
        <Alert>
          <AlertTitle>Link sent to {email}</AlertTitle>
          <AlertDescription>
            Open it on this device to sign in. The link expires shortly and can only
            be used once.
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="w-full" onClick={() => switchTo("signin")}>
          Back to sign in
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">ClanBridge</h1>
        <p className="text-muted-foreground text-sm">
          {mode === "signin"
            ? "Sign in with your email and password."
            : "New here? Give us your email and we will send you a link. You choose a password once you are in."}
        </p>
      </div>

      {signedOut && mode === "signin" && !message && (
        <Alert>
          <AlertTitle>Signed out</AlertTitle>
          <AlertDescription>
            You can sign in as somebody else now.
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={mode === "signin" ? onSignIn : onSendLink} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={busy}
          />
        </div>

        {mode === "signin" && (
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
            />
          </div>
        )}

        {message && (
          <Alert variant="destructive">
            <AlertTitle>
              {mode === "signin" ? "Could not sign in" : "Could not send the link"}
            </AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={busy}>
          {mode === "signin"
            ? busy
              ? "Signing in…"
              : "Sign in"
            : busy
              ? "Sending…"
              : "Send me a link"}
        </Button>
      </form>

      {/* The second door. A button rather than a link, because both live on this
          one page — there is no /signup route to bookmark, and adding one would
          mean two forms that can disagree about what an email address is. */}
      {mode === "signin" ? (
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              New here? You need an account first.
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => switchTo("signup")}
              disabled={busy}
            >
              Sign up
            </Button>
          </div>
          <button
            type="button"
            className="text-muted-foreground text-xs underline"
            onClick={() => switchTo("signup")}
            disabled={busy}
          >
            Forgotten your password? Get a sign-in link instead.
          </button>
        </div>
      ) : (
        <div className="border-t pt-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => switchTo("signin")}
            disabled={busy}
          >
            Back to sign in
          </Button>
        </div>
      )}

      <p className="text-muted-foreground text-xs">
        Signing in does not grant access on its own. A leader approves each account
        before any clan data is visible.
      </p>
    </div>
  );
}

// useSearchParams() opts the subtree into client-side rendering, which Next
// requires a Suspense boundary for during prerender.
export default function LoginPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <LoginForm />
    </Suspense>
  );
}
