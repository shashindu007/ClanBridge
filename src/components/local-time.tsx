"use client";

// T9.9 — a deadline, in the reader's own time.
//
// See lib/display-time.ts for the bug this belongs to and why there are two
// mechanisms. This is the one used where the value is something the reader ACTS
// on — a war ending, a raid weekend closing — and being five and a half hours
// out costs a missed attack.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY suppressHydrationWarning IS CORRECT HERE RATHER THAN SWEPT UNDER
//
// The server cannot know the reader's timezone; it is not in the request. So the
// server renders DISPLAY_ZONE and the browser re-renders in the zone it actually
// has. For a reader outside Sri Lanka those two strings legitimately differ,
// which is precisely the mismatch React warns about — and here the mismatch is
// the entire feature.
//
// The alternative, rendering nothing until mounted, leaves every timestamp blank
// on first paint and shifts the layout when they fill in. The alternative to
// that, formatting on the server only, is the bug this task exists to fix.
// ─────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { DISPLAY_ZONE, formatIn, type TimeStyle } from "@/lib/display-time";

export interface LocalTimeProps {
  /** A UTC ISO timestamp, as stored. Null renders an em dash. */
  iso: string | null | undefined;
  style?: TimeStyle;
}

export function LocalTime({ iso, style = "datetime" }: LocalTimeProps) {
  // Starts at the server's answer so the first paint matches the markup, then
  // swaps to the reader's real zone once mounted. Both name the same instant;
  // only the wall-clock wording differs.
  const [zone, setZone] = useState(DISPLAY_ZONE);

  useEffect(() => {
    const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (local) setZone(local);
  }, []);

  if (!iso) return <span>—</span>;

  return (
    // dateTime carries the machine-readable instant however it is worded, so a
    // screen reader or a copy-paste keeps the unambiguous value.
    <time dateTime={iso} suppressHydrationWarning>
      {formatIn(iso, style, zone)}
    </time>
  );
}
