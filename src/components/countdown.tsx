"use client";

// A deadline that counts down while you watch.
//
// The war ribbon used to say "Battle day · 6h", computed once on the server and
// then frozen: a member who left the tab open for an hour was still told six
// hours. This ticks once a second, and when it reaches zero it asks the server
// for the page again — the war has changed state, and the board should say so
// without anybody pressing reload.
//
// Always paired with a <LocalTime> of the same instant on the page. "3h 12m
// left" answers "how long"; "Sat 14:30" answers "when", and a member planning
// around sleep needs the second one.
//
// suppressHydrationWarning for the same reason as LocalTime: the server's "now"
// and the browser's are a few hundred milliseconds apart, so the seconds digit
// legitimately differs between the two renders.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatRemaining } from "@/lib/war-status";

export interface CountdownProps {
  /** The instant being counted down to, as a UTC ISO string. */
  iso: string | null | undefined;
  /** Shown once the moment has passed. */
  doneLabel?: string;
  /** Re-fetch the server page once the countdown reaches zero. */
  refreshOnDone?: boolean;
  className?: string;
}

export function Countdown({
  iso,
  doneLabel = "any moment now",
  refreshOnDone = true,
  className,
}: CountdownProps) {
  const router = useRouter();
  const target = iso ? new Date(iso).getTime() : Number.NaN;
  const [now, setNow] = useState(() => Date.now());
  const refreshed = useRef(false);
  // Refresh only when the deadline passes WHILE this is on screen. A deadline
  // already past on arrival (the war ended, the hourly sync has not run yet)
  // used to refresh on every visit — a second server render for nothing, twice
  // on the war board, which shows the same deadline in two places.
  const pendingAtMount = useRef(Number.isFinite(target) ? target > Date.now() : false);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [target]);

  const left = target - now;

  useEffect(() => {
    if (!refreshOnDone || !pendingAtMount.current || refreshed.current || !Number.isFinite(left) || left > 0) {
      return;
    }
    // Once. The state change lands at the next sync, not at the stroke of the
    // deadline, so refreshing every second until then would be a loop.
    refreshed.current = true;
    router.refresh();
  }, [left, refreshOnDone, router]);

  if (!Number.isFinite(target)) return <span className={className}>—</span>;

  return (
    <span
      className={`tabular-nums ${className ?? ""}`}
      role="timer"
      aria-live="off"
      suppressHydrationWarning
    >
      {left > 0 ? formatRemaining(left) : doneLabel}
    </span>
  );
}
