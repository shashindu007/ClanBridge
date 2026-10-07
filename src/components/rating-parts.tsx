// The pieces the rating pages share — CWL and regular war — so a mark reads the
// same way wherever it is shown: its sign, its colour, and the line it came from.
//
// Server components, no state.

import { cn } from "@/lib/utils";
import { signed, type MarkLine } from "@/services/cwl-rating";

/** Marks in their colour: gained, lost, or nothing. The sign carries it too. */
export function Marks({ value, className }: { value: number; className?: string }) {
  return (
    <span
      className={cn(
        "tabular-nums",
        value > 0 ? "text-success-ink" : value < 0 ? "text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      {signed(value)}
    </span>
  );
}

/** The sum behind a number: "3 stars +5 · 6 bases up +6". */
export function Lines({ lines, empty }: { lines: readonly MarkLine[]; empty?: string }) {
  if (lines.length === 0) {
    return empty ? <span className="text-muted-foreground text-xs">{empty}</span> : null;
  }
  return (
    <ul className="space-y-0.5 text-xs">
      {lines.map((line) => (
        <li key={line.label} className="flex items-baseline justify-between gap-3">
          <span className="text-muted-foreground">{line.label}</span>
          <Marks value={line.marks} className="font-medium" />
        </li>
      ))}
    </ul>
  );
}

/** The rules, as a list of what each thing is worth. */
export function RuleList({ rules }: { rules: ReadonlyArray<readonly [label: string, marks: number]> }) {
  return (
    <ul className="divide-y rounded-control border">
      {rules.map(([label, marks]) => (
        <li key={label} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
          <span>{label}</span>
          <Marks value={marks} className="font-semibold" />
        </li>
      ))}
    </ul>
  );
}
