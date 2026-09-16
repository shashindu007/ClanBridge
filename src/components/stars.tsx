// Stars as the game shows them — ★★☆ — with the number spoken to screen readers.
// Shared by the war board and the CWL pages so an attack result reads the same
// everywhere.

export function Stars({ stars, max = 3 }: { stars: number; max?: number }) {
  const filled = Math.max(0, Math.min(max, stars));
  return (
    <span
      role="img"
      aria-label={`${filled} star${filled === 1 ? "" : "s"}`}
      className="text-warning-ink whitespace-nowrap"
    >
      {"★".repeat(filled)}
      <span className="text-muted-foreground">{"☆".repeat(max - filled)}</span>
    </span>
  );
}

/** A labelled number for a summary row: "Stars / 21 – 18 / us – them". */
export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground text-xs font-medium uppercase">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}
