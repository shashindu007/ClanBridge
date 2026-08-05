"use client";

// T5.5 — the browser half of push subscription.
//
// PERMISSION IS ASKED ON A CLICK, NEVER ON LOAD. A prompt that appears
// unprompted is denied by most people in about a second, and a denial is close
// to permanent: browsers remember it, and the only way back is through settings
// most members will never find. So the button explains what it is for, and the
// prompt only appears once someone has said yes to the explanation.
//
// The whole component degrades to a plain sentence where push cannot work —
// which today is every iPhone that has not installed the app to the Home Screen
// (T5.7), and every browser without the APIs.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type State = "checking" | "unsupported" | "denied" | "off" | "on" | "working";

/**
 * VAPID public keys travel as base64url; PushManager wants raw bytes.
 *
 * Returned as Uint8Array<ArrayBuffer> rather than plain Uint8Array: since
 * TypeScript 5.7 the array is generic over its buffer, and applicationServerKey
 * requires a real ArrayBuffer — a SharedArrayBuffer-backed view does not satisfy
 * it. Allocating the buffer explicitly is what pins the parameter.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(normalised);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // iOS only exposes these once the app is installed to the Home Screen, so
      // this branch is the normal state on iPhone rather than an edge case.
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !vapidPublicKey
      ) {
        if (!cancelled) setState("unsupported");
        return;
      }

      if (Notification.permission === "denied") {
        if (!cancelled) setState("denied");
        return;
      }

      // Registering is safe to repeat and is what makes the worker available for
      // the subscribe call below.
      const registration = await navigator.serviceWorker.register("/sw.js");
      const existing = await registration.pushManager.getSubscription();

      if (!cancelled) setState(existing ? "on" : "off");
    })().catch(() => {
      if (!cancelled) setState("unsupported");
    });

    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    setError(null);
    setState("working");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        // Required by Chrome, and required by the spec's intent: every push must
        // result in something the member can see. Silent push is not available
        // and should not be wanted here.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!response.ok) {
        // Roll the browser subscription back. Leaving it in place would mean the
        // browser thinks it is subscribed while the server has no endpoint to
        // send to, and nothing would ever arrive with no way to tell why.
        await subscription.unsubscribe().catch(() => {});
        setError("Could not save the subscription. Try again.");
        setState("off");
        return;
      }

      setState("on");
    } catch {
      setError("Something went wrong turning notifications on.");
      setState("off");
    }
  }

  async function disable() {
    setError(null);
    setState("working");

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Server first. If this order were reversed and the unsubscribe
        // succeeded but the request failed, the row would stay live and the
        // member would keep receiving pushes they had just switched off.
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        await subscription.unsubscribe();
      }

      setState("off");
    } catch {
      setError("Could not turn notifications off.");
      setState("on");
    }
  }

  if (state === "checking") {
    return <p className="text-muted-foreground text-sm">Checking…</p>;
  }

  if (state === "unsupported") {
    return (
      <p className="text-muted-foreground text-sm">
        This browser cannot show notifications yet. On iPhone, add ClanBridge to
        your Home Screen first — see the{" "}
        <Link href="/guide" className="underline">
          guide
        </Link>
        .
      </p>
    );
  }

  if (state === "denied") {
    return (
      <p className="text-muted-foreground text-sm">
        Notifications are blocked for this site. Turn them back on in your
        browser&rsquo;s site settings — this page cannot ask again once they have
        been blocked.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <Button
          onClick={state === "on" ? disable : enable}
          disabled={state === "working"}
          variant={state === "on" ? "outline" : "default"}
        >
          {state === "working"
            ? "Working…"
            : state === "on"
              ? "Turn off on this device"
              : "Turn on for this device"}
        </Button>
        {state === "on" && (
          <span className="text-muted-foreground text-sm">On for this device</span>
        )}
      </div>

      {/* Per device, and said out loud: a member who turns it on on their phone
          and then opens the site on a laptop will otherwise assume it is on
          there too, and quietly miss everything. */}
      <p className="text-muted-foreground text-xs">
        This setting applies to this device only.
      </p>

      {error && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
}
