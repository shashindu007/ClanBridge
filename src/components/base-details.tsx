// T11B.9 — "Base details": how far along one village is, for its Town Hall.
//
// A SERVER COMPONENT, like player-report-sections.tsx, and shared the same way:
// the owner's page (/account/bases/[tag]/details) and a leader's page
// ([clanTag]/player/[tag]/details) render this with the same reading, so the two
// can never disagree about what 87% means.
//
// The Home village / Builder Base switch is two LINKS with a query parameter,
// not client state. The page is fully rendered on the server either way, and a
// link survives a reload and can be shared.
//
// Every number shown comes from one stored reading (036). Nothing here decides
// what a cap is: the reading carries the cap applied when it was captured, and
// services/progress.ts does the arithmetic.

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { dayLabel } from "@/components/player-report-sections";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BaseProgress } from "@/repositories/player-progress";
import { UPGRADE_WINDOW_DAYS } from "@/repositories/player-progress";
import {
  behindPreviousHall,
  counts,
  groupProgress,
  overallProgress,
  upgradesBetween,
  type GroupProgress,
  type StoredUnit,
} from "@/services/progress";
import type { Village } from "@/types/domain";

export interface BaseDetailsProps {
  progress: BaseProgress;
  village: Village;
  /** This page's own path, for the village switch. Already encoded. */
  path: string;
}

/** Parse the `?village=` search parameter. Anything but "builder" is home. */
export function villageParam(value: string | string[] | undefined): Village {
  return value === "builder" ? "builder" : "home";
}

export function BaseDetails({ progress, village, path }: BaseDetailsProps) {
  const { latest, baseline } = progress;

  if (!latest) {
    // The common state for a day after this ships, and for a village linked
    // since the last run. Names the job, the way every report panel names its
    // own, so "empty" never reads as "broken".
    return (
      <section className="cb-panel space-y-2 rounded-lg border p-6">
        <h2 className="font-medium">No details for this base yet</h2>
        <p className="text-muted-foreground text-sm">
          Hero, troop and spell levels are read once a day by the{" "}
          <code className="text-xs">sync:players</code> job. This village has not
          been read yet, so check back after the next run.
        </p>
      </section>
    );
  }

  const hall = village === "home" ? latest.thLevel : latest.bhLevel;
  const hallName = village === "home" ? "Town Hall" : "Builder Hall";
  const groups = groupProgress(latest.units, village);
  const overall = overallProgress(latest.units, village);
  const behind = behindPreviousHall(latest.units, village, hall ?? undefined);
  const upgrades = baseline
    ? upgradesBetween(baseline.units, latest.units).filter((u) => u.village === village)
    : [];
  const anyCapUnknown = groups.some((g) => g.capUnknown > 0);

  return (
    <>
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <nav aria-label="Village" className="flex flex-wrap gap-2">
          <VillageLink path={path} village="home" current={village}>
            Home village
          </VillageLink>
          <VillageLink path={path} village="builder" current={village}>
            Builder Base
          </VillageLink>
        </nav>

        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">
              {hall ? `${hallName} ${hall}` : hallName}
              {village === "home" && latest.thWeaponLevel
                ? ` · weapon ${latest.thWeaponLevel}`
                : ""}
            </h2>
            <p className="text-2xl font-semibold tabular-nums">{overall.pct}%</p>
          </div>
          <Progress value={overall.pct} label={`${hallName} progress`} />
          <p className="text-muted-foreground text-xs">
            Levels against the cap for this {hallName}, across every group below
            except super troops. Read {dayLabel(latest.capturedAt)}.
          </p>
        </div>

        {groups.length > 0 && (
          <ul className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => (
              <li key={g.group} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <a className="underline-offset-2 hover:underline" href={`#${g.group}`}>
                    {g.label}
                  </a>
                  <span className="text-muted-foreground tabular-nums">
                    {g.group === "superTroop" ? "—" : `${g.pct}%`}
                  </span>
                </div>
                {g.group !== "superTroop" && (
                  <Progress value={g.pct} label={`${g.label} progress`} className="h-1.5" />
                )}
              </li>
            ))}
          </ul>
        )}

        {anyCapUnknown && (
          <p className="text-muted-foreground text-xs">
            * The cap for this {hallName} is not known yet for units marked with an
            asterisk, usually because they arrived in a recent game update. They
            are measured against the game&apos;s maximum level instead.
          </p>
        )}
      </section>

      {groups.length === 0 ? (
        <section className="cb-panel rounded-lg border p-6">
          <p className="text-muted-foreground text-sm">
            {village === "builder"
              ? "This village has not unlocked the Builder Base."
              : "No units were reported for this village."}
          </p>
        </section>
      ) : (
        <>
          <BehindPanel behind={behind} hall={hall} hallName={hallName} />
          <UpgradesPanel
            upgrades={upgrades}
            since={baseline?.capturedAt ?? null}
          />
          {groups.map((g) => (
            <GroupPanel key={g.group} group={g} />
          ))}
        </>
      )}
    </>
  );
}

function VillageLink({
  path,
  village,
  current,
  children,
}: {
  path: string;
  village: Village;
  current: Village;
  children: React.ReactNode;
}) {
  const active = village === current;
  return (
    <Link
      href={village === "home" ? path : `${path}?village=builder`}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-sm font-medium"
          : "hover:bg-accent rounded-md border px-3 py-1.5 text-sm"
      }
    >
      {children}
    </Link>
  );
}

/**
 * Units below the previous hall's cap. Advisory, and worded that way — see the
 * "RUSHED IS A BREAKDOWN" note in services/progress.ts.
 */
function BehindPanel({
  behind,
  hall,
  hallName,
}: {
  behind: ReturnType<typeof behindPreviousHall>;
  hall: number | null;
  hallName: string;
}) {
  if (!hall || hall < 2) return null;
  const total = behind.reduce((n, g) => n + g.units.length, 0);

  return (
    <section className="cb-panel space-y-3 rounded-lg border p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Below the {hallName} {hall - 1} cap</h2>
        <span className="text-muted-foreground text-sm tabular-nums">
          {total === 0 ? "none" : `${total} unit${total === 1 ? "" : "s"}`}
        </span>
      </div>
      {total === 0 ? (
        <p className="text-muted-foreground text-sm">
          Everything is at least at the level {hallName} {hall - 1} allows.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            These have not reached the maximum for the previous {hallName}.
            Equipment is left out, because it is collected rather than unlocked.
          </p>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {behind.map((g) => (
              <div key={g.group} className="space-y-1">
                <dt className="text-sm font-medium">{g.label}</dt>
                {g.units.map((u) => (
                  <dd
                    key={u.name}
                    className="text-muted-foreground flex justify-between gap-2 text-sm"
                  >
                    <span>{u.name}</span>
                    <span className="tabular-nums">
                      {u.level === 0 ? "locked" : u.level} / {u.previousCap}
                    </span>
                  </dd>
                ))}
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  );
}

function UpgradesPanel({
  upgrades,
  since,
}: {
  upgrades: ReturnType<typeof upgradesBetween>;
  since: string | null;
}) {
  return (
    <section className="cb-panel space-y-3 rounded-lg border p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">Upgraded lately</h2>
        {since && (
          <span className="text-muted-foreground text-sm">since {dayLabel(since)}</span>
        )}
      </div>
      {!since ? (
        <p className="text-muted-foreground text-sm">
          Only one reading so far. Upgrades show up here once a second daily reading
          exists to compare with, covering up to the last {UPGRADE_WINDOW_DAYS} days.
        </p>
      ) : upgrades.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing was upgraded in this period.</p>
      ) : (
        <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {upgrades.map((u) => (
            <li key={`${u.village}:${u.name}`} className="flex justify-between gap-2 text-sm">
              <span>{u.name}</span>
              <span className="text-muted-foreground tabular-nums">
                {u.from === 0 ? "unlocked" : u.from} → {u.to}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GroupPanel({ group }: { group: GroupProgress }) {
  const isSuper = group.group === "superTroop";
  const counted = group.units.filter(counts).length;

  return (
    <section id={group.group} className="cb-panel scroll-mt-4 space-y-3 rounded-lg border p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{group.label}</h2>
        {isSuper ? (
          <span className="text-muted-foreground text-sm">
            not counted — a super troop&apos;s level is its base troop&apos;s
          </span>
        ) : (
          <span className="text-muted-foreground text-sm tabular-nums">
            {group.pct}% · {group.maxed} of {counted} maxed
          </span>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{group.group === "equipment" ? "Equipment" : "Name"}</TableHead>
            <TableHead className="text-right">Level</TableHead>
            <TableHead className="hidden w-1/3 sm:table-cell">
              <span className="sr-only">Progress</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.units.map((u) => (
            <UnitRow key={`${u.village}:${u.name}`} unit={u} showBar={!isSuper} />
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function UnitRow({ unit, showBar }: { unit: StoredUnit; showBar: boolean }) {
  const maxed = unit.cap > 0 && unit.level >= unit.cap;
  const pct = unit.cap > 0 ? Math.floor((Math.min(unit.level, unit.cap) / unit.cap) * 100) : 0;

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">
            {unit.name}
            {!unit.capKnown && (
              <span title="Cap for this hall not known — measured against the game maximum">
                *
              </span>
            )}
          </span>
          {unit.level === 0 && <Badge variant="outline">locked</Badge>}
          {maxed && <Badge variant="success">max</Badge>}
        </div>
        {unit.hero && <p className="text-muted-foreground text-xs">{unit.hero}</p>}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {unit.level} / {unit.cap}
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        {showBar && <Progress value={pct} label={`${unit.name} ${unit.level} of ${unit.cap}`} />}
      </TableCell>
    </TableRow>
  );
}
