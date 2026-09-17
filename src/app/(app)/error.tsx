"use client";

// The recovery page for anything that throws inside the authenticated shell.
//
// WHAT IT IS ACTUALLY FOR. Architecture §11 names three failure modes with
// permanent consequences — a silent sync, a deletion, a lost database — and
// gives each a mechanism. This file covers the fourth, which has no permanent
// consequence at all and used to have no mechanism either: the database being
// briefly unreachable while somebody is holding their phone.
//
// That is the realistic failure here. Every page in this group is
// force-dynamic and queries Supabase on a free tier in another region, so a
// dropped connection mid-render is not exotic. Without this file it rendered as
// Next's built-in error page — an unstyled sentence and a digest hash, with no
// retry and no navigation — during CWL, on a phone, to a member checking whether
// they still have an attack.
//
// reset() is the whole point. A transient failure is fixed by trying again, and
// the member should not have to work out that reloading is what they want. The
// shell is still around this page, so the clan switcher and the account menu are
// already there; this only has to explain and offer the retry.
//
// Must be a Client Component — Next requires it, because error boundaries are a
// React runtime feature and reset() is a callback.
//
// R8-ADJACENT: `error.message` IS NOT SHOWN. A server error message can carry a
// Postgres constraint name, a policy name, or a fragment of a query, and this
// page is reachable by anyone signed in. The digest is shown instead, because it
// is a hash Vercel's logs can be searched by and it reveals nothing on its own —
// which is the same trade lib/errors.ts's safeMessage() already makes everywhere
// a database error reaches a member.

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server has already logged this; this is the browser half, so a
    // member who reports "it broke" can be asked what the console said.
    // console.error, not a silent swallow: an error boundary that hides the
    // error is how a recurring fault stays invisible for a month.
    console.error("app error boundary:", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 sm:p-8">
      <div className="cb-panel space-y-4 rounded-xl border p-6 sm:p-8">
        {/* --destructive, and it is the correct reserved meaning here: this is
            the "something is broken" case the palette reserves red for. */}
        <span
          className="cb-emblem size-11 rounded-xl"
          style={{ "--emblem": "var(--destructive)" } as React.CSSProperties}
        >
          <TriangleAlert aria-hidden className="size-5" />
        </span>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">
            This page did not load
          </h1>
          <p className="text-muted-foreground text-sm">
            Something went wrong while building it. This is almost always
            temporary — usually the app could not reach its database for a moment.
            Nothing you did caused it, and nothing has been lost.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={reset} size="sm">
            <RotateCw aria-hidden />
            Try again
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/">Go to my dashboard</Link>
          </Button>
        </div>

        <div className="text-muted-foreground space-y-2 border-t pt-4 text-sm">
          <p>
            If it keeps happening, tell your clan leader. Game data here is
            refreshed on a schedule rather than the instant something happens, so
            a page being briefly unavailable does not mean any war or league
            history has been missed.
          </p>
          {error.digest && (
            <p>
              Reference:{" "}
              <code className="bg-muted rounded px-1.5 py-0.5 text-xs">
                {error.digest}
              </code>{" "}
              — quote this if you report it.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
