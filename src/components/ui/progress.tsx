// T11B.9 — a progress bar. A plain div, not @radix-ui/react-progress: there is
// nothing interactive about it, and a dependency for a width percentage is not
// worth adding. The ARIA attributes are what the radix one would have set.

import { cn } from "@/lib/utils";

export function Progress({
  value,
  label,
  className,
}: {
  /** 0–100. Clamped. */
  value: number;
  /** Read by screen readers, since the bar alone carries no text. */
  label: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className={cn("bg-muted h-2 w-full overflow-hidden rounded-full", className)}
    >
      <div
        // Full bars go green: "done" is a status, and globals.css reserves
        // --success for exactly that. Everything short of it stays the primary
        // colour, so a bar never reads as a warning just for being incomplete.
        className={cn("h-full rounded-full", pct >= 100 ? "bg-success" : "bg-primary")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
