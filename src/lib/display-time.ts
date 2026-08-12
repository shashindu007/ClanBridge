// T9.9 — formatting a stored UTC instant for a reader.
//
// THE BUG THIS FILE EXISTS TO FIX, which was invisible because everything
// looked right. Pages formatted timestamps with `new Date(iso).toLocaleString()`
// inside SERVER components. That runs on the server, so the zone is the
// server's — UTC on Vercel — regardless of who is reading. `war/page.tsx` even
// carried the comment "UTC in the database, local in the browser (T9.9)", which
// described the intention rather than the behaviour.
//
// Sri Lanka is UTC+05:30, so a war ending 20:00 UTC on the 29th is 01:30 on the
// 30th locally. Server-rendered it read "29 Jul, 20:00" — the right instant, the
// wrong day, stated with complete confidence. IMPLEMENTATION.md names this
// exactly: "Off-by-one-day errors here are common and quietly make missed-attack
// lists wrong."
//
// Two mechanisms, and the split is deliberate:
//
//   formatDisplay()  server-side, always DISPLAY_ZONE. Correct for every member
//                    of these three clans, needs no JavaScript, and cannot
//                    produce a hydration mismatch. The default.
//
//   <LocalTime>      components/local-time.tsx. Upgrades to the reader's real
//                    zone once mounted. Used where the value is a DEADLINE the
//                    reader acts on — a war ending, a raid weekend closing —
//                    and being an hour out actually costs something.
//
// Both render the same string on the server, so switching a call site between
// them changes nothing until the browser takes over.

/**
 * The zone the server formats in, and the fallback when JavaScript never runs.
 *
 * Every clan on this platform is Sri Lankan. This is a sensible default rather
 * than an assumption anything depends on being true — <LocalTime> corrects it
 * per reader, and nothing here breaks for someone elsewhere, they simply read
 * clan-local time, which is how a clan discusses war timings anyway.
 */
export const DISPLAY_ZONE = "Asia/Colombo";

export type TimeStyle = "datetime" | "date" | "time" | "weekday";

const FORMATS: Record<TimeStyle, Intl.DateTimeFormatOptions> = {
  datetime: {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
  date: { day: "numeric", month: "short", year: "numeric" },
  time: { hour: "2-digit", minute: "2-digit" },
  // War pages lead with the day name — "Sat 14:30" answers "when do I attack"
  // faster than a date does.
  weekday: {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  },
};

/**
 * Format one instant in one zone.
 *
 * Returns an em dash for null and for an unparseable value rather than
 * "Invalid Date", which is what `new Date("nonsense").toLocaleString()` renders
 * into the page.
 */
export function formatIn(
  iso: string | null | undefined,
  style: TimeStyle,
  zone: string,
): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { ...FORMATS[style], timeZone: zone }).format(date);
}

/** Format for display, in the platform's default zone. Safe in a server component. */
export function formatDisplay(
  iso: string | null | undefined,
  style: TimeStyle = "datetime",
): string {
  return formatIn(iso, style, DISPLAY_ZONE);
}
