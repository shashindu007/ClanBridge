// T3.4 — Player verification.
//
// Settings -> More Settings -> API Token, with the warning that a Supercell ID
// password is never required by any website.
//
// That warning is the point of the page, not decoration. Asking a member to paste
// a code from inside the game is the exact shape of every Clash of Clans account
// phishing attempt, and a member who learns the habit "paste game credentials
// into a website that asks" from us is a member we have made easier to rob. So
// the page says plainly which secret is safe and which is never asked for.
//
// R8 — the token is submitted and discarded. It is never put in the URL (a query
// string would land in browser history and server logs), never stored, and the
// field is cleared once the answer comes back.

"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { isValidTag } from "@/lib/tags";
import { SignOutButton } from "@/components/sign-out-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type Status = "idle" | "sending" | "done" | "error";

function VerifyForm() {
  const params = useSearchParams();

  // T11.13 — where Continue goes once a tag is linked.
  //
  // /pending is right for the member this page was written for: a first-time
  // account, mid-signup, whose next step is waiting for a leader. It is wrong for
  // an approved member adding a second village, who would land on a page titled
  // "Waiting for approval" — so /account sends them back with ?next=.
  //
  // Through safeNext() because this arrives in a URL anyone can write, and the
  // same guard the magic link uses applies here. Note it returns "/" rather than
  // null for anything it rejects, so the fallback has to be spelled out: a bare
  // `safeNext(...) ?? "/pending"` would silently send every first-time member to
  // the dashboard, which the gate then bounces to /pending anyway — right
  // destination, two redirects and a wrong-looking URL on the way.
  const requested = safeNext(params.get("next"));
  const continueTo = requested === "/" ? "/pending" : requested;

  const [tag, setTag] = useState("");
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  // Advisory only — the server normalises and validates the tag again. This just
  // saves a round trip and one of the five hourly attempts.
  const tagLooksWrong = tag.length > 0 && !isValidTag(tag);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setMessage("");

    const response = await fetch("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerTag: tag.trim(), token: token.trim() }),
    }).catch(() => null);

    // Cleared on every outcome, success or not. A stale token in a form field is
    // a token sitting in memory for no reason, and it is invalid by now anyway.
    setToken("");

    if (!response) {
      setStatus("error");
      setMessage("Could not reach the server. Check your connection and try again.");
      return;
    }

    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      message?: string;
    };

    if (!response.ok || !body.ok) {
      setStatus("error");
      setMessage(body.error ?? "Verification failed. Try again.");
      return;
    }

    setStatus("done");
    setMessage(body.message ?? "Verified.");
  }

  if (status === "done") {
    return (
      <div className="space-y-4">
        <h1 className="cb-title text-3xl">Verified</h1>
        <Alert>
          <AlertTitle>Your account is linked</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
        <Button asChild variant="outline" className="w-full">
          <Link href={continueTo}>Continue</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="cb-title text-3xl">Verify your account</h1>
        <p className="text-muted-foreground text-sm">
          This proves the Clash of Clans account is yours. It takes about a minute.
        </p>
      </div>

      <Alert>
        <AlertTitle>Your password is never needed</AlertTitle>
        <AlertDescription>
          The API token below is a temporary code that only proves you can open the
          game on this account. It is safe to share and it changes every time you
          view it. <strong>No website ever needs your Supercell ID password.</strong>{" "}
          If any site asks for it, including one that looks like this one, it is a
          scam.
        </AlertDescription>
      </Alert>

      <ol className="text-sm space-y-3 list-decimal pl-5">
        <li>Open Clash of Clans.</li>
        <li>
          Tap the <strong>settings gear</strong>, then <strong>More Settings</strong>.
        </li>
        <li>
          Scroll to the bottom and find <strong>API Token</strong>. Tap{" "}
          <strong>Show</strong>.
        </li>
        <li>Copy the code and paste it below, along with your player tag.</li>
      </ol>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="tag">Player tag</Label>
          <Input
            id="tag"
            required
            autoCapitalize="characters"
            placeholder="#2PP0JCCL"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            disabled={status === "sending"}
          />
          {tagLooksWrong ? (
            <p className="text-destructive text-xs">
              That does not look like a player tag. It starts with # and never
              contains the letter O — what looks like an O is a zero.
            </p>
          ) : (
            <p className="text-muted-foreground text-xs">
              Shown under your name on your profile in game.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="token">API token</Label>
          <Input
            id="token"
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste the code from the game"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={status === "sending"}
          />
          <p className="text-muted-foreground text-xs">
            Used once to check with Supercell, then discarded. We never store it.
          </p>
        </div>

        {status === "error" && (
          <Alert variant="destructive">
            <AlertTitle>Not verified</AlertTitle>
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}

        <Button
          type="submit"
          className="w-full"
          disabled={status === "sending" || tagLooksWrong}
        >
          {status === "sending" ? "Checking…" : "Verify"}
        </Button>
      </form>

      <p className="text-muted-foreground text-xs">
        You can try five times an hour. If the token keeps being rejected, view it
        again in game — it changes each time you look at it.
      </p>

      {/* T10.3 — this is the only authenticated page outside the app shell, so
          without a button here it is the only page with no way out. A member who
          opened a magic link on the wrong account lands exactly here, is asked
          to prove they own a player tag, and needs to be able to say "not this
          account" instead.

          On the page rather than in (auth)/layout.tsx: the layout also wraps
          /login, where deciding whether to show this needs a getUser() call, and
          that is a network round trip added to the page members judge the whole
          product's speed by. See the note in that file. */}
      <div className="text-muted-foreground border-t pt-4 text-sm">
        Wrong account? <SignOutButton />
      </div>
    </div>
  );
}

// useSearchParams() opts the subtree into client-side rendering, which Next
// requires a Suspense boundary for during prerender — the same wrapper
// (auth)/login/page.tsx needs, for the same reason.
export default function VerifyPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground text-sm">Loading…</p>}>
      <VerifyForm />
    </Suspense>
  );
}
