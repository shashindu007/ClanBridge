// The pieces the rating pages share — CWL and regular war — so a mark reads the
// same way wherever it is shown: its sign, its colour, and the line it came from.
//
// Server components, no state.

import { Scale } from "lucide-react";
import { Disclosure } from "@/components/kit";
import { HOME_HALLS } from "@/data/game";
import { cn } from "@/lib/utils";
import { signed, type MarkLine } from "@/services/cwl-rating";
import {
  LEAGUE_STEP,
  LEAGUE_UNKNOWN,
  TH_FLOOR,
  TH_STEP,
  TH_TOP,
  leagueWeight,
  thWeight,
  weightLabel,
} from "@/services/difficulty";

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

/**
 * How difficulty is counted where clans are ranked together, printed from
 * services/difficulty.ts so the tables cannot drift from the sums. `cwl` adds
 * the league table.
 */
export function DifficultyRules({ cwl = false }: { cwl?: boolean }) {
  const ths = [0, 1, 2, 3, 4, 5].map((below) => HOME_HALLS - below);
  const tiers = ["Bronze", "Silver", "Gold", "Crystal", "Master", "Champion", "Titan"];

  return (
    <Disclosure title="How difficulty works" icon={Scale}>
      <div className="space-y-4 text-sm">
        <p className="text-muted-foreground">
          Every mark is worked out against the attacker&apos;s own base, so three stars on your own
          Town Hall is the same mark in an easy war and a hard one. Where players of different clans
          are ranked in one list, each finished {cwl ? "day" : "war"}&apos;s plus marks and share are
          multiplied by how hard it was. Minus marks are not. A clan&apos;s own pages, and one clan
          picked here, are not weighed at all.
        </p>

        <div className="space-y-2">
          <p className="font-medium">Enemy Town Hall</p>
          <p className="text-muted-foreground text-xs">
            The average Town Hall of the enemy lineup: {TH_TOP.toFixed(2)} at Town Hall {HOME_HALLS},{" "}
            {TH_STEP.toFixed(2)} less for each level below, and never under {TH_FLOOR.toFixed(2)}.
          </p>
          <ul className="grid grid-cols-3 gap-1.5 text-xs sm:grid-cols-7">
            {ths.map((th) => (
              <li key={th} className="cb-sunken flex justify-between gap-2 rounded-chip px-2 py-1 tabular-nums">
                <span>TH{th}</span>
                <span className="font-semibold">{weightLabel(thWeight(th))}</span>
              </li>
            ))}
            <li className="cb-sunken flex justify-between gap-2 rounded-chip px-2 py-1 tabular-nums">
              <span>lower</span>
              <span className="font-semibold">{weightLabel(TH_FLOOR)}</span>
            </li>
          </ul>
        </div>

        {cwl && (
          <div className="space-y-2">
            <p className="font-medium">League</p>
            <p className="text-muted-foreground text-xs">
              {LEAGUE_STEP} for Bronze League III and {LEAGUE_STEP} more for each league up. A day counts
              by the league times its enemy Town Hall. A season with no league recorded counts{" "}
              {weightLabel(LEAGUE_UNKNOWN)}.
            </p>
            <ul className="grid grid-cols-2 gap-1.5 text-xs sm:grid-cols-4">
              {tiers.map((tier) => (
                <li key={tier} className="cb-sunken rounded-chip px-2 py-1 tabular-nums">
                  <span className="font-medium">{tier}</span>{" "}
                  <span className="text-muted-foreground">
                    {["III", "II", "I"].map((n) => weightLabel(leagueWeight(`${tier} League ${n}`))).join(" · ")}
                  </span>
                </li>
              ))}
              <li className="cb-sunken rounded-chip px-2 py-1 tabular-nums">
                <span className="font-medium">Legend</span>{" "}
                <span className="text-muted-foreground">{weightLabel(leagueWeight("Legend League"))}</span>
              </li>
            </ul>
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          {cwl
            ? "Example: a Silver League II day (0.5) against an enemy averaging Town Hall 12.4 (1.00) counts 0.50, and a Champion League I day (1.8) against Town Hall 16.9 (1.69) counts 3.04. 10% of the clan's marks is then 5.0% and 30.4%."
            : "Example: a war against an enemy averaging Town Hall 16 counts 1.55, so 10% of the clan's marks counts 15.5%."}
        </p>
      </div>
    </Disclosure>
  );
}
