// T11B.12 — what a pasted village export shows: buildings, walls, traps, running
// upgrades, and the export's own unit levels.
//
// Presentational only — no hooks, no state — so village-export-view.test.ts can
// render it statically. The state (the pasted text, which village is showing)
// lives in village-export-paste.tsx.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDisplay } from "@/lib/display-time";
import { groupProgress, overallProgress } from "@/services/progress";
import {
  buildingGroups,
  buildingTally,
  capTrusted,
  formatDuration,
  type BuildingGroup,
} from "@/services/village";
import type { Village } from "@/types/domain";
import type { ExportedBuilding, ExportedVillage } from "@/types/village";

export interface VillageExportViewProps {
  village: ExportedVillage;
  which: Village;
  onWhich: (which: Village) => void;
  onClear: () => void;
}

/** "21 ×5 · 20 ×1", highest level first. */
function levelSummary(building: ExportedBuilding): string {
  return Object.entries(building.levels)
    .map(([level, count]) => [Number(level), count] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([level, count]) => (count > 1 ? `${level} ×${count}` : String(level)))
    .join(" · ");
}

export function VillageExportView({ village, which, onWhich, onClear }: VillageExportViewProps) {
  const hall = which === "home" ? village.thLevel : village.bhLevel;
  const hallName = which === "home" ? "Town Hall" : "Builder Hall";
  const groups = buildingGroups(village, which);
  const allBuildings = groups.flatMap((g) => g.buildings);
  const buildingsOverall = buildingTally(allBuildings);
  const unitsOverall = overallProgress(village.units, which);
  const unitGroups = groupProgress(village.units, which);
  const upgrades = village.upgrades.filter((u) => u.village === which);

  return (
    <div className="space-y-6">
      <section className="cb-panel space-y-4 rounded-panel border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="font-medium">From your village export</h2>
            <p className="text-muted-foreground text-xs">
              Exported {formatDisplay(village.exportedAt, "datetime")}. Not saved, and
              gone when you leave or reload this page.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>

        <div role="group" aria-label="Village" className="flex flex-wrap gap-2">
          {(["home", "builder"] as const).map((v) => (
            <Button
              key={v}
              type="button"
              size="sm"
              variant={v === which ? "default" : "outline"}
              aria-pressed={v === which}
              onClick={() => onWhich(v)}
            >
              {v === "home" ? "Home village" : "Builder Base"}
            </Button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Figure label={`Buildings for ${hallName} ${hall ?? "?"}`} pct={buildingsOverall.pct} />
          <Figure label="Heroes, troops and spells" pct={unitsOverall.pct} />
        </div>

        {village.unknownIds > 0 && (
          <p className="text-muted-foreground text-xs">
            {village.unknownIds} item{village.unknownIds === 1 ? " is" : "s are"} newer than
            this site&apos;s game data. They are listed by number and not counted.
          </p>
        )}
      </section>

      <section className="cb-panel space-y-3 rounded-panel border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">Upgrading now</h2>
          <span className="text-muted-foreground text-sm tabular-nums">{upgrades.length}</span>
        </div>
        {upgrades.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing was upgrading when you exported.</p>
        ) : (
          <ul className="space-y-1">
            {upgrades.map((u, i) => (
              <li key={`${u.name}-${i}`} className="flex flex-wrap justify-between gap-2 text-sm">
                <span>
                  {u.name}{" "}
                  <span className="text-muted-foreground tabular-nums">
                    {u.fromLevel} → {u.fromLevel + 1}
                  </span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {u.remainingSeconds === 0
                    ? "done"
                    : `${formatDuration(u.remainingSeconds)} left · ${formatDisplay(u.finishesAt, "datetime")}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-xs">
          Time left is counted from when you exported, so it is only as fresh as the export.
        </p>
      </section>

      {groups.map((g) => (
        <BuildingPanel key={g.key} group={g} />
      ))}

      {unitGroups.length > 0 && (
        <section className="cb-panel space-y-3 rounded-panel border p-5">
          <h2 className="font-medium">Heroes, troops and spells in the export</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {unitGroups
              .filter((g) => g.group !== "superTroop")
              .map((g) => (
                <li key={g.group} className="space-y-1">
                  <div className="flex justify-between gap-2 text-sm">
                    <span>{g.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {g.pct}% · {g.maxed}/{g.units.length} maxed
                    </span>
                  </div>
                  <Progress value={g.pct} label={`${g.label} progress`} className="h-1.5" />
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Figure({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm">{label}</span>
        <span className="text-xl font-semibold tabular-nums">{pct}%</span>
      </div>
      <Progress value={pct} label={label} />
    </div>
  );
}

function BuildingPanel({ group }: { group: BuildingGroup }) {
  return (
    <section className="cb-panel space-y-3 rounded-panel border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{group.label}</h2>
        <span className="text-muted-foreground text-sm tabular-nums">{group.pct}%</span>
      </div>
      <Progress value={group.pct} label={`${group.label} progress`} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Building</TableHead>
            <TableHead className="text-right">Count</TableHead>
            <TableHead className="text-right">Levels</TableHead>
            <TableHead className="text-right">Max</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.buildings.map((b) => {
            const trusted = capTrusted(b);
            const maxed = trusted && Object.keys(b.levels).every((l) => Number(l) >= b.cap!);
            return (
              <TableRow key={`${b.village}:${b.name}`}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{b.name}</span>
                    {maxed && <Badge variant="success">max</Badge>}
                    {b.upgrading > 0 && <Badge variant="info">upgrading {b.upgrading}</Badge>}
                    {b.geared > 0 && <Badge variant="outline">geared {b.geared}</Badge>}
                    {b.supercharged > 0 && (
                      <Badge variant="outline">supercharged {b.supercharged}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{b.count}</TableCell>
                <TableCell className="text-right tabular-nums">{levelSummary(b)}</TableCell>
                <TableCell className="text-muted-foreground text-right tabular-nums">
                  {trusted ? b.cap : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      {group.uncounted > 0 && (
        <p className="text-muted-foreground text-xs">
          A dash under Max means there is no level cap on record for that building at this
          hall, so it is not counted in the percentage.
        </p>
      )}
    </section>
  );
}
