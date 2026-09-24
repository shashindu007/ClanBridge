// Stars as the game shows them — ★★☆ — with the number spoken to screen readers.
// Shared by the war board and the CWL pages so an attack result reads the same
// everywhere.
//
// GOLD TRIM, NOT --warning. Stars were amber, the reserved "look at this" hue,
// on every attack in the product — so a three-star hit wore the same colour as
// a sync failure. They are decoration, and --trim is the decoration gold: the
// deeper shade on the light page (about 3.5:1), the bright one at night.
//
// The Stat summary block that lived here is gone: its last callers now put
// their numbers in a kit FactRow, which is what a number without an action is.

export function Stars({ stars, max = 3 }: { stars: number; max?: number }) {
  const filled = Math.max(0, Math.min(max, stars));
  return (
    <span
      role="img"
      aria-label={`${filled} star${filled === 1 ? "" : "s"}`}
      className="text-trim-shade dark:text-trim whitespace-nowrap"
    >
      {"★".repeat(filled)}
      <span className="text-muted-foreground">{"☆".repeat(max - filled)}</span>
    </span>
  );
}
