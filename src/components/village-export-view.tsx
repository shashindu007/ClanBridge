// T11B.12 — what a village export shows: buildings, walls, traps, running
// upgrades, and who is busy.
//
// LAID OUT LIKE THE GAME, NOT LIKE A SPREADSHEET. It used to be a table per
// building group — "Cannon · 6 · 21 ×5 · 20 · 21" — which a player had to read
// row by row to find anything. Now every building is its picture with its level
// on the corner plate, the way the army screen draws troops (base-details.tsx),
// and the summary on top answers what a player checks first: how far along,
// how are the walls, how many builders are free.
//
// ONE VILLAGE AT A TIME, CHOSEN BY THE PAGE. The Home village / Builder Base
// switch is the page's own (`?village=`, base-details.tsx's VillageSwitch), so
// this view and the API-sync grid below it always show the same village.
//
// Presentational only — no hooks, no state — so village-export-view.test.ts can
// render it statically. The state (the building filter, replacing and removing)
// lives in village-export-saved.tsx.
//
// The export is SAVED (076) and read again days later, so time left is worked
// out from each upgrade's finish time against `now`, never from the seconds
// stored when it was parsed.

import {
  BrickWall,
  Castle,
  Check,
  CheckCircle2,
  ChevronDown,
  FileJson,
  FlaskConical,
  Hourglass,
  PawPrint,
  Swords,
} from "lucide-react";
import { BuilderHutIcon, BuilderSlots, type Glyph } from "@/components/game/builder-hut-icon";
import { BuildingIcon } from "@/components/game/building-icon";
import { TownHall } from "@/components/game/town-hall";
import { UnitIcon } from "@/components/game/unit-icon";
import { StatTile } from "@/components/kit";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { formatDisplay } from "@/lib/display-time";
import { cn } from "@/lib/utils";
import { overallProgress } from "@/services/progress";
import {
  STALE_EXPORT_DAYS,
  buildingGroups,
  buildingTally,
  capTrusted,
  formatDuration,
  highestLevel,
  secondsLeft,
  upgradeSubject,
  wallBreakdown,
  workshops,
  type BuildingGroup,
  type BuildingGroupKey,
  type UpgradeSubject,
  type WallBreakdown,
  type WorkshopState,
} from "@/services/village";
import type { Village } from "@/types/domain";
import type { ExportedBuilding, ExportedVillage } from "@/types/village";

/** Which building groups the grid shows. Walls have their own card. */
export type BuildingFilter = "all" | Exclude<BuildingGroupKey, "walls">;

export const BUILDING_FILTERS: Array<{ key: BuildingFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "defenses", label: "Defenses" },
  { key: "traps", label: "Traps" },
  { key: "resources", label: "Resources" },
  { key: "army", label: "Army" },
  { key: "workers", label: "Builders" },
];

export interface VillageExportViewProps {
  village: ExportedVillage;
  which: Village;
  /** For time left. The page passes its own, so server and browser agree. */
  now: Date;
  /** Replace and Remove, beside the heading. */
  actions?: React.ReactNode;
  filter?: BuildingFilter;
  onFilter?: (filter: BuildingFilter) => void;
  /** Hide the buildings already at their cap. */
  notMaxedOnly?: boolean;
  onNotMaxedOnly?: (on: boolean) => void;
  /**
   * The upgrade tracker (079), shown after the banner in place of the static
   * "Upgrading now" list: its workshop board shows the same timers, live.
   */
  tracker?: React.ReactNode;
}

/** "21 ×5 · 20 ×1", highest level first. */
function levelSummary(building: ExportedBuilding): string {
  return Object.entries(building.levels)
    .map(([level, count]) => [Number(level), count] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([level, count]) => (count > 1 ? `${level} ×${count}` : String(level)))
    .join(" · ");
}

function isMaxedBuilding(b: ExportedBuilding): boolean {
  return capTrusted(b) && Object.keys(b.levels).every((l) => Number(l) >= b.cap);
}

function exportedWhen(days: number): string {
  if (!Number.isFinite(days) || days === 0) return "exported today";
  if (days === 1) return "exported yesterday";
  return `exported ${days} days ago`;
}

function buildersLine(builders: WorkshopState | undefined): string {
  if (!builders) return "no huts in the export";
  if (builders.busy >= builders.total) return "all builders working";
  return `${builders.total - builders.busy} free`;
}

/** Upgrades shown before "Show all". */
const UPGRADES_SHOWN = 6;

export function VillageExportView({
  village,
  which,
  now,
  actions,
  filter = "all",
  onFilter,
  notMaxedOnly = false,
  onNotMaxedOnly,
  tracker,
}: VillageExportViewProps) {
  const hall = which === "home" ? village.thLevel : village.bhLevel;
  const hallName = which === "home" ? "Town Hall" : "Builder Hall";
  const groups = buildingGroups(village, which);
  const buildingsOverall = buildingTally(groups.flatMap((g) => g.buildings));
  const unitsOverall = overallProgress(village.units, which);
  const walls = wallBreakdown(village, which);
  const busy = workshops(village, which, now);
  const builders = busy.find((w) => w.key === "builders");
  const ageDays = Math.floor(Math.max(0, now.getTime() - Date.parse(village.exportedAt)) / 86_400_000);
  const upgrades = village.upgrades
    .filter((u) => u.village === which)
    .map((u) => ({ ...u, left: secondsLeft(u, now), subject: upgradeSubject(village, u) }))
    .sort((a, b) => a.left - b.left);

  return (
    <div className="space-y-6">
      {/* ── Where this village stands ─────────────────────────────────── */}
      <section data-scene="banner" className="cb-panel space-y-5 rounded-panel border p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {which === "home" ? (
              <TownHall level={hall} size="md" />
            ) : (
              <BuildingIcon name="Builder Hall" village="builder" kind="Town Hall2" size={44} />
            )}
            <div className="min-w-0 space-y-0.5">
              <h2 className="cb-title text-2xl leading-tight">
                {hall ? `${hallName} ${hall}` : hallName}
              </h2>
              <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-xs">
                <FileJson aria-hidden className="text-primary size-3.5" />
                <span>From your village export</span>
                <span aria-hidden>·</span>
                <span title={formatDisplay(village.exportedAt, "datetime")}>
                  {exportedWhen(ageDays)}
                </span>
                {(village.appliedSince ?? 0) > 0 && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      {village.appliedSince} upgrade{village.appliedSince === 1 ? "" : "s"} finished since
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatTile
            variant="plate"
            className="cb-rise"
            label="Buildings"
            icon={Castle}
            value={`${buildingsOverall.pct}%`}
            sub={`against the ${hallName} ${hall ?? "?"} caps`}
          >
            <Progress value={buildingsOverall.pct} label="Buildings progress" className="mt-1.5 h-1.5" />
          </StatTile>
          <StatTile
            variant="plate"
            className="cb-rise"
            style={{ "--i": 1 } as React.CSSProperties}
            label="Walls"
            icon={BrickWall}
            value={walls ? `Lv ${walls.levels[0]!.level}` : "—"}
            sub={walls ? `${walls.levels[0]!.count} of ${walls.total} at this level` : "none in the export"}
          />
          <StatTile
            variant="plate"
            className="cb-rise"
            style={{ "--i": 2 } as React.CSSProperties}
            label="Builders busy"
            icon={BuilderHutIcon}
            value={builders ? `${builders.busy}/${builders.total}` : "—"}
            sub={buildersLine(builders)}
          >
            {builders && <BuilderSlots busy={builders.busy} total={builders.total} className="pt-0.5" />}
          </StatTile>
          <StatTile
            variant="plate"
            className="cb-rise"
            style={{ "--i": 3 } as React.CSSProperties}
            label="Heroes and army"
            icon={Swords}
            value={`${unitsOverall.pct}%`}
            sub="heroes, troops, spells"
          >
            <Progress value={unitsOverall.pct} label="Heroes and army progress" className="mt-1.5 h-1.5" />
          </StatTile>
        </div>

        {busy.length > 1 && <WorkshopRow states={busy.filter((w) => w.key !== "builders")} />}

        <p className="text-muted-foreground text-xs">
          Saved to your account and visible only to you.
          {ageDays >= STALE_EXPORT_DAYS && (
            <span className="text-warning-ink">
              {" "}
              This export is {ageDays} days old: levels and timers are as of then.
            </span>
          )}
        </p>
      </section>

      {/* ── Upgrading now, or the live tracker in its place ──────────── */}
      {tracker ?? (
      <section className="cb-panel space-y-3 rounded-panel border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Hourglass aria-hidden className="text-muted-foreground size-4.5" />
            Upgrading now
          </h2>
          <span className="text-muted-foreground text-sm tabular-nums">{upgrades.length}</span>
        </div>
        {upgrades.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nothing was upgrading when you exported.</p>
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2">
              {upgrades.slice(0, UPGRADES_SHOWN).map((u, i) => (
                <UpgradeRow key={`${u.name}-${i}`} upgrade={u} which={which} />
              ))}
            </ul>
            {upgrades.length > UPGRADES_SHOWN && (
              <details className="group">
                <summary className="text-muted-foreground hover:bg-accent hover:text-accent-foreground flex cursor-pointer list-none items-center justify-center gap-1.5 rounded-control border border-dashed py-2 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Show all {upgrades.length}</span>
                  <span className="hidden group-open:inline">Show fewer</span>
                  <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
                </summary>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {upgrades.slice(UPGRADES_SHOWN).map((u, i) => (
                    <UpgradeRow key={`${u.name}-${i + UPGRADES_SHOWN}`} upgrade={u} which={which} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        <p className="text-muted-foreground text-xs">
          Time left is counted from when you exported. Anything started since needs a fresh export.
        </p>
      </section>
      )}

      {/* ── Buildings ─────────────────────────────────────────────────── */}
      <BuildingsSection
        groups={groups.filter((g) => g.key !== "walls")}
        pct={buildingsOverall.pct}
        filter={filter}
        onFilter={onFilter}
        notMaxedOnly={notMaxedOnly}
        onNotMaxedOnly={onNotMaxedOnly}
        which={which}
      />

      {walls && <WallsCard walls={walls} which={which} />}

      {village.unknownIds > 0 && (
        <p className="text-muted-foreground text-xs">
          {village.unknownIds} item{village.unknownIds === 1 ? " is" : "s are"} newer than
          this site&apos;s game data. They are listed by number and not counted.
        </p>
      )}
    </div>
  );
}

const WORKSHOP_ICON: Record<WorkshopState["key"], Glyph> = {
  builders: BuilderHutIcon,
  lab: FlaskConical,
  pets: PawPrint,
};

function WorkshopRow({ states }: { states: WorkshopState[] }) {
  return (
    <ul aria-label="Workshops" className="flex flex-wrap gap-2">
      {states.map((w) => {
        const Icon = WORKSHOP_ICON[w.key];
        const working = w.busy > 0;
        return (
          <li
            key={w.key}
            className={cn(
              "flex items-center gap-1.5 rounded-chip border px-2.5 py-1 text-xs font-medium",
              working ? "bg-info-tint text-info-ink border-transparent" : "text-muted-foreground",
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            {w.label}
            <span className="font-normal">· {working ? "upgrading" : "idle"}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function SubjectIcon({
  name,
  subject,
  which,
  size,
}: {
  name: string;
  subject: UpgradeSubject;
  which: Village;
  size: number;
}) {
  if (subject?.type === "unit") return <UnitIcon name={name} group={subject.group} size={size} />;
  return <BuildingIcon name={name} village={which} kind={subject?.kind ?? "Other"} size={size} />;
}

function UpgradeRow({
  upgrade: u,
  which,
}: {
  upgrade: { name: string; fromLevel: number; finishesAt: string; left: number; subject: UpgradeSubject };
  which: Village;
}) {
  const done = u.left === 0;
  return (
    <li className="cb-sunken flex items-center gap-3 rounded-control p-2.5">
      <SubjectIcon name={u.name} subject={u.subject} which={which} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{u.name}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          Level {u.fromLevel} → {u.fromLevel + 1}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {done ? (
          <Badge variant="success">
            <CheckCircle2 aria-hidden />
            done
          </Badge>
        ) : (
          <>
            <p className="text-sm font-semibold tabular-nums">{formatDuration(u.left)} left</p>
            <p className="text-muted-foreground text-[0.6875rem] tabular-nums">
              {formatDisplay(u.finishesAt, "datetime")}
            </p>
          </>
        )}
      </div>
    </li>
  );
}

function BuildingsSection({
  groups,
  pct,
  filter,
  onFilter,
  notMaxedOnly,
  onNotMaxedOnly,
  which,
}: {
  groups: BuildingGroup[];
  pct: number;
  filter: BuildingFilter;
  onFilter?: (filter: BuildingFilter) => void;
  notMaxedOnly: boolean;
  onNotMaxedOnly?: (on: boolean) => void;
  which: Village;
}) {
  const present = new Set(groups.map((g) => g.key));
  const chips = BUILDING_FILTERS.filter((f) => f.key === "all" || present.has(f.key));
  const shown = groups
    .filter((g) => filter === "all" || g.key === filter)
    .map((g) => ({
      ...g,
      buildings: notMaxedOnly ? g.buildings.filter((b) => !isMaxedBuilding(b)) : g.buildings,
    }))
    .filter((g) => g.buildings.length > 0);

  return (
    <section aria-labelledby="buildings-title" className="cb-panel space-y-5 rounded-panel border p-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="buildings-title" className="text-lg font-semibold">
            Buildings and traps
          </h2>
          <span className="text-muted-foreground text-sm tabular-nums">{pct}%</span>
        </div>
        {(onFilter || onNotMaxedOnly) && (
          <div className="flex flex-wrap items-center gap-2">
            {onFilter && (
              <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
                {chips.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    aria-pressed={f.key === filter}
                    data-active={f.key === filter || undefined}
                    onClick={() => onFilter(f.key)}
                    className="cb-choice min-h-10"
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
            {onNotMaxedOnly && (
              // A toggle chip like the filters beside it, not a native checkbox:
              // one control style for one row of controls, and a tap target the
              // same size as its neighbours.
              <button
                type="button"
                aria-pressed={notMaxedOnly}
                data-active={notMaxedOnly || undefined}
                onClick={() => onNotMaxedOnly(!notMaxedOnly)}
                className="cb-choice min-h-10 sm:ml-auto"
              >
                {notMaxedOnly && <Check aria-hidden className="size-4" />}
                Not maxed only
              </button>
            )}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CheckCircle2 aria-hidden className="text-success-ink size-4" />
          Everything here is at its cap for this hall.
        </p>
      ) : (
        shown.map((g) => <BuildingGroupGrid key={g.key} group={g} which={which} />)
      )}
    </section>
  );
}

function BuildingGroupGrid({ group, which }: { group: BuildingGroup; which: Village }) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">{group.label}</h3>
          <span className="text-muted-foreground text-xs tabular-nums">{group.pct}%</span>
        </div>
        <Progress value={group.pct} label={`${group.label} progress`} className="h-1.5" />
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2.5">
        {group.buildings.map((b) => (
          <BuildingTile key={`${b.village}:${b.name}`} building={b} which={which} />
        ))}
      </ul>
      {group.uncounted > 0 && (
        <p className="text-muted-foreground text-xs">
          A dash for the cap means there is no level cap on record for that building at this
          hall, so it is not counted in the percentage.
        </p>
      )}
    </div>
  );
}

function BuildingTile({ building: b, which }: { building: ExportedBuilding; which: Village }) {
  const trusted = capTrusted(b);
  const maxed = isMaxedBuilding(b);
  const top = highestLevel(b);
  const tally = buildingTally([b]);

  return (
    <li
      className={cn(
        "cb-sunken relative flex min-w-0 flex-col items-center gap-1.5 rounded-control px-2 pt-3 pb-2.5 text-center",
        maxed && "ring-gold/60 ring-1",
      )}
    >
      {b.count > 1 && (
        <span className="bg-background/70 text-muted-foreground absolute top-1.5 right-1.5 rounded-chip px-1.5 text-[0.6875rem] font-semibold tabular-nums">
          ×{b.count}
        </span>
      )}
      <BuildingIcon name={b.name} village={which} kind={b.kind} size={52} level={top} maxed={maxed} />
      <p className="mt-1 line-clamp-2 w-full text-xs leading-tight font-medium">{b.name}</p>
      <p className={cn("text-xs tabular-nums", maxed ? "text-foreground font-semibold" : "text-muted-foreground")}>
        {levelSummary(b)}
        <span className="text-muted-foreground font-normal"> / {trusted ? b.cap : "—"}</span>
        {maxed && <span className="sr-only"> — maxed</span>}
      </p>
      {(b.upgrading > 0 || b.geared > 0 || b.supercharged > 0) && (
        <div className="flex flex-wrap justify-center gap-1">
          {b.upgrading > 0 && (
            <Badge variant="info" title={`${b.upgrading} upgrading`}>
              <Hourglass aria-hidden />
              {b.upgrading}
            </Badge>
          )}
          {b.geared > 0 && <Badge variant="outline">geared {b.geared}</Badge>}
          {b.supercharged > 0 && <Badge variant="outline">supercharged {b.supercharged}</Badge>}
        </div>
      )}
      {trusted && (
        <Progress value={tally.pct} label={`${b.name} ${tally.pct}%`} className="mt-auto h-1" />
      )}
    </li>
  );
}

/** Every wall piece by level: one stacked bar, then the count at each level. */
function WallsCard({ walls, which }: { walls: WallBreakdown; which: Village }) {
  const top = walls.levels[0]!.level;
  const toCap = walls.cap === null ? null : walls.total - walls.atCap;

  return (
    <section aria-labelledby="walls-title" className="cb-panel space-y-4 rounded-panel border p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <BuildingIcon name="Wall" village={which} kind="Wall" size={40} level={top} maxed={toCap === 0} />
          <div>
            <h2 id="walls-title" className="text-lg font-semibold">
              Walls
            </h2>
            <p className="text-muted-foreground text-xs tabular-nums">
              {walls.total} pieces{walls.cap !== null ? ` · cap ${walls.cap}` : ""}
            </p>
          </div>
        </div>
        {toCap !== null && (
          <span className={cn("text-sm font-medium tabular-nums", toCap === 0 ? "text-success-ink" : "text-muted-foreground")}>
            {toCap === 0 ? "All at the cap" : `${toCap} to the cap`}
          </span>
        )}
      </div>

      <div
        role="img"
        aria-label={walls.levels.map((l) => `${l.count} at level ${l.level}`).join(", ")}
        className="flex h-3 overflow-hidden rounded-full bg-muted"
      >
        {walls.levels.map((l, i) => (
          <span
            key={l.level}
            className={cn("h-full", walls.cap !== null && l.level >= walls.cap ? "bg-gold" : "bg-primary")}
            style={{
              width: `${(l.count / walls.total) * 100}%`,
              opacity: walls.cap !== null && l.level >= walls.cap ? 1 : Math.max(0.3, 1 - i * 0.2),
            }}
          />
        ))}
      </div>

      <ul className="flex flex-wrap gap-2">
        {walls.levels.map((l) => (
          <li key={l.level} className="cb-sunken flex items-baseline gap-1.5 rounded-chip px-2.5 py-1 text-sm">
            <span className="font-semibold tabular-nums">Lv {l.level}</span>
            <span className="text-muted-foreground tabular-nums">×{l.count}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
