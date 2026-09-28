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
//
// LAID OUT LIKE THE ARMY SCREEN. Every unit is its picture with its level on a
// corner plate, in a grid — a player finds "Archer Queen" by her face faster
// than by reading a column of names. The summary above the grid answers the
// three questions asked first: how far along, what is behind, what moved.

import Link from "next/link";
import { ArrowUpRight, CheckCircle2, Hourglass, TrendingUp } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { StatTile } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { UnitIcon } from "@/components/game/unit-icon";
import { dayLabel } from "@/components/player-report-sections";
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
import { cn } from "@/lib/utils";
import type { Village } from "@/types/domain";
import { CardScene } from "@/components/game/scene-backdrop";

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

/** At the cap for this hall. A unit with no cap here has nothing to reach. */
export function isMaxed(unit: StoredUnit): boolean {
  return unit.cap > 0 && unit.level >= unit.cap;
}

export function BaseDetails({ progress, village, path }: BaseDetailsProps) {
  const { latest, baseline } = progress;

  if (!latest) {
    // The common state for a day after this ships, and for a village linked
    // since the last run. Names the job, the way every report panel names its
    // own, so "empty" never reads as "broken".
    return (
      <section className="cb-panel space-y-2 rounded-panel border p-5">
        <h2 className="text-lg font-semibold">No details for this base yet</h2>
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
  const hallShort = village === "home" ? "TH" : "BH";
  const groups = groupProgress(latest.units, village);
  const overall = overallProgress(latest.units, village);
  const behind = behindPreviousHall(latest.units, village, hall ?? undefined);
  const upgrades = baseline
    ? upgradesBetween(baseline.units, latest.units).filter((u) => u.village === village)
    : [];
  const anyCapUnknown = groups.some((g) => g.capUnknown > 0);

  const counted = latest.units.filter((u) => u.village === village && counts(u));
  const maxedCount = counted.filter(isMaxed).length;
  const behindCount = behind.reduce((n, g) => n + g.units.length, 0);
  const hasPrevious = Boolean(hall && hall > 1);
  const heroes = groups.find((g) => g.group === (village === "home" ? "hero" : "builderHero"));

  return (
    <>
      <section className="cb-panel isolate space-y-5 rounded-panel border p-5">
        <CardScene banner />
        <nav aria-label="Village" className="cb-sunken inline-flex gap-1 rounded-control p-1">
          <VillageLink path={path} village="home" current={village}>
            Home village
          </VillageLink>
          <VillageLink path={path} village="builder" current={village}>
            Builder Base
          </VillageLink>
        </nav>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {village === "home" && <TownHall level={hall ?? null} size="md" />}
              <div>
                <h2 className="text-lg font-semibold">
                  {hall ? `${hallName} ${hall}` : hallName}
                  {village === "home" && latest.thWeaponLevel
                    ? ` · weapon ${latest.thWeaponLevel}`
                    : ""}
                </h2>
                <p className="text-muted-foreground text-xs">Read {dayLabel(latest.capturedAt)}</p>
              </div>
            </div>
            <p className="cb-title text-4xl tabular-nums">{overall.pct}%</p>
          </div>
          <Progress value={overall.pct} label={`${hallName} progress`} className="h-2.5" />
          <p className="text-muted-foreground text-xs">
            Levels against the cap for this {hallName}, across every group below
            except super troops.
          </p>
        </div>

        {groups.length > 0 && (
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <StatTile
              label="Maxed"
              icon={CheckCircle2}
              value={maxedCount}
              sub={`of ${counted.length} units`}
            />
            <StatTile
              label="Behind"
              icon={Hourglass}
              value={hasPrevious ? behindCount : "—"}
              sub={hasPrevious ? `under ${hallShort} ${hall! - 1} cap` : "no earlier hall"}
            />
            <StatTile
              label="Upgraded"
              icon={TrendingUp}
              value={baseline ? upgrades.length : "—"}
              sub={baseline ? `since ${dayLabel(baseline.capturedAt)}` : "one reading so far"}
            />
          </div>
        )}

        {heroes && heroes.units.length > 0 && (
          <div className="space-y-2.5">
            <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {heroes.label}
            </h3>
            <ul className="flex flex-wrap gap-x-5 gap-y-3">
              {heroes.units.map((u) => (
                <li key={u.name} className="flex items-center gap-2.5">
                  <UnitIcon
                    name={u.name}
                    group={u.group}
                    size={40}
                    level={u.level}
                    maxed={isMaxed(u)}
                    locked={u.level === 0}
                  />
                  <span className="text-sm leading-tight">
                    <span className="block font-medium">{u.name}</span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {u.level === 0 ? "locked" : `level ${u.level} of ${u.cap}`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {groups.length > 0 && (
          <ul className="grid gap-x-6 gap-y-3 border-t pt-4 sm:grid-cols-2">
            {groups.map((g) => (
              <li key={g.group} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <a className="font-medium underline-offset-2 hover:underline" href={`#${g.group}`}>
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
        <section className="cb-panel rounded-panel border p-5">
          <p className="text-muted-foreground text-sm">
            {village === "builder"
              ? "This village has not unlocked the Builder Base."
              : "No units were reported for this village."}
          </p>
        </section>
      ) : (
        <>
          {groups.map((g) => (
            <GroupPanel key={g.group} group={g} />
          ))}
          <BehindPanel behind={behind} hall={hall} hallName={hallName} />
          <UpgradesPanel upgrades={upgrades} since={baseline?.capturedAt ?? null} />
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
      className={cn(
        "rounded-chip px-3.5 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-tile text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

/**
 * One group as the army screen draws it: a grid of pictures, each with its
 * level on the corner plate and its progress under its name.
 */
function GroupPanel({ group }: { group: GroupProgress }) {
  const isSuper = group.group === "superTroop";
  const counted = group.units.filter(counts).length;

  return (
    <section id={group.group} className="cb-panel scroll-mt-4 space-y-4 rounded-panel border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">{group.label}</h2>
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

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2.5">
        {group.units.map((u) => (
          <UnitCard key={`${u.village}:${u.name}`} unit={u} showBar={!isSuper} />
        ))}
      </ul>
    </section>
  );
}

function UnitCard({ unit, showBar }: { unit: StoredUnit; showBar: boolean }) {
  const maxed = isMaxed(unit);
  const locked = unit.level === 0;
  const pct = unit.cap > 0 ? Math.floor((Math.min(unit.level, unit.cap) / unit.cap) * 100) : 0;

  return (
    <li
      className={cn(
        "cb-sunken flex min-w-0 flex-col items-center gap-1.5 rounded-control px-2 pt-3 pb-2.5 text-center",
        maxed && "ring-gold/60 ring-1",
      )}
    >
      <UnitIcon
        name={unit.name}
        group={unit.group}
        size={52}
        level={unit.level}
        maxed={maxed}
        locked={locked}
      />
      <p className="mt-1 line-clamp-2 w-full text-xs leading-tight font-medium">
        {unit.name}
        {!unit.capKnown && (
          <span title="Cap for this hall not known — measured against the game maximum">*</span>
        )}
      </p>
      {unit.hero && (
        <p className="text-muted-foreground -mt-1 w-full truncate text-[0.6875rem]">{unit.hero}</p>
      )}
      <p
        className={cn(
          "text-xs tabular-nums",
          maxed ? "text-foreground font-semibold" : "text-muted-foreground",
        )}
      >
        {locked ? "locked" : `${unit.level} / ${unit.cap}`}
        {maxed && <span className="sr-only"> — maxed</span>}
      </p>
      {showBar && !locked && (
        <Progress
          value={pct}
          label={`${unit.name} ${unit.level} of ${unit.cap}`}
          className="mt-auto h-1"
        />
      )}
    </li>
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
    <section className="cb-panel space-y-3 rounded-panel border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Below the {hallName} {hall - 1} cap</h2>
        <span className="text-muted-foreground text-sm tabular-nums">
          {total === 0 ? "none" : `${total} unit${total === 1 ? "" : "s"}`}
        </span>
      </div>
      {total === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CheckCircle2 aria-hidden className="text-success-ink size-4" />
          Everything is at least at the level {hallName} {hall - 1} allows.
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">
            These have not reached the maximum for the previous {hallName}.
            Equipment is left out, because it is collected rather than unlocked.
          </p>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {behind.map((g) => (
              <div key={g.group} className="space-y-2">
                <dt className="text-sm font-medium">{g.label}</dt>
                {g.units.map((u) => (
                  <dd key={u.name} className="flex items-center gap-2.5 text-sm">
                    <UnitIcon name={u.name} group={g.group} size={28} locked={u.level === 0} />
                    <span className="min-w-0 flex-1 truncate">{u.name}</span>
                    <span className="text-muted-foreground tabular-nums">
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
    <section className="cb-panel space-y-3 rounded-panel border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Upgraded lately</h2>
        {since && <span className="text-muted-foreground text-sm">since {dayLabel(since)}</span>}
      </div>
      {!since ? (
        <p className="text-muted-foreground text-sm">
          Only one reading so far. Upgrades show up here once a second daily reading
          exists to compare with, covering up to the last {UPGRADE_WINDOW_DAYS} days.
        </p>
      ) : upgrades.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing was upgraded in this period.</p>
      ) : (
        <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {upgrades.map((u) => (
            <li key={`${u.village}:${u.name}`} className="flex items-center gap-2.5 text-sm">
              <UnitIcon name={u.name} group={u.group} size={28} />
              <span className="min-w-0 flex-1 truncate">{u.name}</span>
              <span className="text-muted-foreground inline-flex items-center gap-1 tabular-nums">
                <ArrowUpRight aria-hidden className="text-success-ink size-3.5" />
                {u.from === 0 ? "unlocked" : u.from} → {u.to}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
