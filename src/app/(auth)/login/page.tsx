// T3.1 — Magic link login.
//
// Supabase Auth email OTP. No passwords, which means no password storage, no
// reset flow to build, and no password-related vulnerability to have
// (Architecture.md §2.2).
//
// The link lands on /auth/callback, which exchanges it for a session and creates
// the users profile row. Nothing about identity is decided here.

"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Status = "idle" | "sending" | "sent" | "error";

function LoginForm() {
  const params = useSearchParams();

  // /auth/callback bounces back here with ?error= when a link is expired, reused
  // or malformed. Without surfacing it the member sees the plain form again and
  // reasonably concludes the link did nothing.
  const callbackError = params.get("error");

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>(callbackError ? "error" : "idle");
  const [message, setMessage] = useState(callbackError ?? "");

  // Set by the middleware when it bounced an unauthenticated request, so signing
  // in returns the member to the page they actually asked for.
  const next = params.get("next") ?? "/";

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setMessage("");

    const supabase = createClient();
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin;

    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      setStatus("error");
      setMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  if (status === "sent") {
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
        <Button
          variant="outline"
          className="w-full"
          onClick={() => {
            setStatus("idle");
            setMessage("");
          }}
        >
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">ClanBridge</h1>
        <p className="text-muted-foreground text-sm">
          Sign in with your email. We send you a link — there is no password.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
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
            disabled={status === "sending"}
          />
        </div>

        {status === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Could not send the link</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        <Button type="submit" className="w-full" disabled={status === "sending"}>
          {status === "sending" ? "Sending…" : "Send me a link"}
        </Button>
      </form>

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
