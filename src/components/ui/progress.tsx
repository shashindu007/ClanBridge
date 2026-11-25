// T11B.9 — a progress bar. A plain div, not @radix-ui/react-progress: there is
// nothing interactive about it, and a dependency for a width percentage is not
// worth adding. The ARIA attributes are what the radix one would have set.

import { cn } from "@/lib/utils";

/**
 * `default`: primary fill, green when full — "done" is a status, and
 * globals.css reserves --success for exactly that.
 * `maxed`: the base tracker's bars, where full means "at the cap". The water
 * bubble while climbing, gold when full: gold is the maxed colour, the same
 * as the maxed plate and ring beside the bar.
 */
type ProgressTone = "default" | "maxed";

const FILL: Record<ProgressTone, { going: string; full: string }> = {
  default: { going: "bg-primary", full: "bg-success" },
  maxed: { going: "bg-bubble", full: "bg-gold" },
};

export function Progress({
  value,
  label,
  tone = "default",
  className,
}: {
  /** 0–100. Clamped. */
  value: number;
  /** Read by screen readers, since the bar alone carries no text. */
  label: string;
  tone?: ProgressTone;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  const fill = FILL[tone];
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("cb-bar bg-muted h-2 w-full overflow-hidden rounded-full", className)}
    >
      <div
        // Everything short of full stays the climbing colour, so a bar never
        // reads as a warning just for being incomplete. cb-bar-fill is the
        // gloss and the fill-in on first paint.
        className={cn("cb-bar-fill h-full rounded-full", pct >= 100 ? fill.full : fill.going)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
