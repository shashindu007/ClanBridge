"use client";

// T10.3 — the way out, shared by both shells.
//
// Lives in components/ rather than in (app)/layout.tsx because /verify renders
// through (auth)/layout.tsx instead, and a member who signed in as the wrong
// account on the verification screen needs the button as much as anyone.
//
// A plain form, not a client component and not a fetch. No JavaScript, no
// hydration, nothing to fail — the one control in the product whose whole job is
// to work when the session is in a bad state should not depend on the session
// being in a good state.
//
// POST, because /auth/sign-out refuses GET. See that route on why.
//
// QA, 2026-10 — IT STILL IS A PLAIN FORM, with one thing added when JavaScript
// is there to do it: this device's push subscription is dropped first. Signing
// out used to leave it registered to the old account, so a member who handed
// the phone to a clanmate, or switched to their second account, kept receiving
// the first account's notifications on it. Without JavaScript the form posts
// exactly as before; with it, the clean-up gets a short budget and the form is
// submitted whatever happens — signing out must never wait on a push service.

import { useRef } from "react";

/** The most a sign-out will wait for the push clean-up. */
const FORGET_DEVICE_BUDGET_MS = 1500;

/** Unregister this browser's push subscription, server side and locally. */
async function forgetThisDevice(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;

  // Server first, while the session that owns the row still exists.
  await fetch("/api/push/subscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => {});
  await subscription.unsubscribe().catch(() => false);
}

export function SignOutButton({
  className = "",
  children,
}: {
  className?: string;
  /**
   * Defaults to the words "Sign out". Passed in by the account menu, which
   * needs an icon beside the label and styles the row itself.
   *
   * The underline is the DEFAULT rather than unconditional, because in the menu
   * this sits in a column of links that are not underlined and an odd one out
   * reads as a different kind of control. Callers passing children own the
   * appearance; callers passing none get what they always got.
   */
  children?: React.ReactNode;
}) {
  const leaving = useRef(false);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    // The second pass is form.submit() below, which does not fire this handler;
    // the guard is for a double click during the budget.
    event.preventDefault();
    if (leaving.current) return;
    leaving.current = true;

    const form = event.currentTarget;
    void Promise.race([
      forgetThisDevice().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, FORGET_DEVICE_BUDGET_MS)),
    ]).finally(() => form.submit());
  }

  return (
    <form action="/auth/sign-out" method="post" className="contents" onSubmit={onSubmit}>
      <button
        type="submit"
        className={(children ? className : `hover:underline ${className}`).trim()}
      >
        {children ?? "Sign out"}
      </button>
    </form>
  );
}
