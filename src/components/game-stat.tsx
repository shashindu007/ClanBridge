// T12.8 — one stat, as a plate with a medallion. Used wherever a page leads
// with its numbers: the clan overview and the home dashboard.
//
// The medallion (.cb-medal) is the tile's identity and the number is set in
// the display face. The TONE is decoration and says which tile this is — it
// is never a status. Pass a clan hue, --trim or --primary; the status tokens
// (--success, --warning, --info, --destructive) mean something elsewhere and
// must not be spent on a tile colour (see the header of globals.css).

import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export function GameStat({
  label,
  value,
  hint,
  tone,
  Icon,
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  /** A decoration hue: var(--clan-N), var(--trim) or var(--primary). */
  tone: string;
  Icon: LucideIcon;
  /** Optional. The whole plate becomes a link when there is somewhere to go. */
  href?: string;
}) {
  // A league name ("Master League I") is three words where every other tile
  // holds one short number — the same size would wrap it to two lines and
  // throw the row out of line.
  const long = value.length > 7;

  const body = (
    <>
      <span
        className="cb-medal size-12 shrink-0 rounded-full sm:size-14"
        style={{ "--medal": tone } as React.CSSProperties}
      >
        <Icon aria-hidden className="size-5.5 sm:size-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-muted-foreground block text-[0.7rem] font-semibold tracking-[0.14em] uppercase">
          {label}
        </span>
        <span
          className={`cb-title mt-0.5 block leading-tight tabular-nums ${
            long ? "text-xl sm:text-2xl" : "text-3xl"
          }`}
        >
          {value}
        </span>
        {hint && (
          <span className="text-muted-foreground mt-1 block text-xs leading-snug">{hint}</span>
        )}
      </span>
    </>
  );

  const className = "cb-panel flex items-center gap-4 rounded-2xl border p-4";

  return href ? (
    <Link href={href} className={`${className} cb-panel-interactive`}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
