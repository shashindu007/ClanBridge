"use client";

// The pop-up that says what just happened.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY IT READS THE URL RATHER THAN A STORE
//
// Every mutation here is a <form> posting to a Server Action, which ends in a
// redirect and a fresh server render. Nothing survives that — no component
// state, no context, no event emitter — so a toast queued in memory when the
// button was pressed is gone before the page that should show it exists.
//
// The URL does survive it, and this project already had the convention: actions
// redirect to `?error=<code>`, and /admin had grown a `?ok=` too. So the action
// keeps doing exactly what it did, and this reads the result off the query
// string on the other side. No store, no provider, no library.
//
// THEN IT REMOVES THE PARAM, ON DISMISSAL. A result is an event, not a state:
// leaving `?ok=roster-added` in the address bar means the Back button
// re-announces a save from an hour ago and a pasted link congratulates whoever
// opens it. router.replace strips it without adding a history entry, so Back
// still goes where the member expects.
//
// On dismissal specifically, and not on arrival, because the toast is derived
// from those params during render — stripping them the moment they land would
// delete the thing being displayed in the same frame it appeared.
//
// SubmitButton (components/submit-button.tsx) covers the other half of the same
// problem: it shows the press is doing something while the round trip is in
// flight, and this says how it ended.
// ─────────────────────────────────────────────────────────────────────────────

import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { messageFor } from "@/lib/feedback";

/** How long a success sits there. Long enough to read twice, short enough not to nag. */
const DISMISS_AFTER_MS = 5000;

export function Toaster() {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const ok = params.get("ok");
  const error = params.get("error");
  // The identity of THIS result. Two identical saves in a row — which the
  // roster builder produces constantly — are the same code, so the timestamp in
  // the URL is not available to tell them apart; what makes them distinct is
  // that the first is dismissed and its param stripped before the second lands.
  const code = error ?? ok;

  // DERIVED DURING RENDER, NOT SET IN AN EFFECT.
  //
  // The first version assigned this in useEffect, and the render test caught
  // what that costs: the component returns an empty region on the first paint
  // and the toast appears one tick later. For a message whose whole job is to
  // be seen the moment the page arrives, a guaranteed frame of nothing is the
  // wrong default — and it is also untestable without a DOM, since effects do
  // not run under renderToStaticMarkup.
  //
  // An error wins over a success: both params cannot be true of one action, and
  // showing the wrong one is worse than showing neither.
  const [dismissed, setDismissed] = useState<string | null>(null);

  // Forget the dismissal once the URL has let go of it. The Toaster lives in
  // the (app) layout and survives navigation, so without this `dismissed` kept
  // the last code for ever — and the SECOND identical result (a leader adding
  // two players to the roster, or hitting the same error twice) rendered
  // nothing at all, success or failure. Adjusting state during render is the
  // React-sanctioned form of this, for the reason the note above gives.
  if (code === null && dismissed !== null) setDismissed(null);

  const visible = code !== null && dismissed !== code;
  const kind: "ok" | "error" = error ? "error" : "ok";
  const text = code ? messageFor(kind, code) : "";

  // Dismissal is what strips the param, rather than a separate effect on
  // arrival. Stripping it immediately would delete the very thing the toast is
  // derived from and the message would vanish in the same frame it appeared.
  //
  // Only our two params go. A page whose filters live in the URL — /layouts
  // documents "a filtered library is a link" — must not lose them to a toast.
  const dismiss = useCallback(() => {
    if (code === null) return;
    setDismissed(code);

    const next = new URLSearchParams(params);
    next.delete("ok");
    next.delete("error");
    const query = next.toString();
    // replace, not push: Back should go where the member expects, not back to
    // the same page carrying a stale result that announces itself again.
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [code, params, pathname, router]);

  // Successes fade; failures stay until dismissed. A member who missed "Saved"
  // loses nothing, and one who missed "Already in the DH v2 roster" is left
  // wondering why the player they just assigned is not where they put them.
  useEffect(() => {
    if (!visible || kind === "error") return;
    const timer = setTimeout(dismiss, DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [visible, kind, dismiss]);

  return (
    // Always mounted, even when empty: an aria-live region has to exist BEFORE
    // the text lands in it, or a screen reader has nothing to watch and
    // announces nothing. This is the single most common way live regions are
    // built wrong.
    //
    // polite for a success, assertive for a failure — a save that worked is not
    // worth interrupting whatever is being read, and one that did not is.
    <div
      aria-live={kind === "error" && visible ? "assertive" : "polite"}
      aria-atomic="true"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 sm:inset-x-auto sm:right-0 sm:justify-end"
    >
      {visible && (
        <div
          role={kind === "error" ? "alert" : "status"}
          className={
            "cb-popover pointer-events-auto flex max-w-sm items-start gap-3 rounded-panel p-4 " +
            // The reserved status palette, and an icon AND a word beside the
            // colour — globals.css requires that of every status colour in this
            // product, because one in eight men reads red and green alike.
            (kind === "error"
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-success/25 bg-success-tint text-success-ink")
          }
        >
          {kind === "error" ? (
            <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          ) : (
            <CircleCheck aria-hidden className="mt-0.5 size-5 shrink-0" />
          )}

          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium">
              {kind === "error" ? "That did not work" : "Done"}
            </p>
            <p className="mt-0.5 opacity-90">{text}</p>
          </div>

          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="-mt-1 -mr-1 shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
