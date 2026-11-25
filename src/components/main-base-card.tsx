"use client";

// One of the member's villages on Home — the card a member opens Home for.
//
// Before this, Base details was three clicks deep — account menu, Profile, the
// base, then its button — for the page a member opens most after a war. Then the
// card answered "how far along am I" in one line. Now it answers the four things
// a member tracks about their own base, top to bottom:
//
//   1. Who and where do I stand   the village, and its family rank
//   2. My numbers                 trophies, war stars, wins, Builder Base, capital
//   3. How far along              % to max, each unit group, the heroes
//   4. What is building           from the member's saved game export (076):
//                                 buildings %, walls, every running timer
//
// The export is the one part the API cannot give, so the card says how to add
// it when it is missing, and how old it is when it is there.
//
// PRESENTATION ONLY, and safe in the browser: components/base-carousel.tsx
// rotates these when a member owns more than one village, so nothing here may
// import a repository or anything server-only. Which base is "main" is
// services/home.ts's mainBase(); the page puts it first.

import { useState } from "react";
import Link from "next/link";
import {
  BrickWall,
  Castle,
  ChevronRight,
  Coins,
  FileJson,
  Link2,
  ScrollText,
  ShieldCheck,
  Star,
  Swords,
  Trophy,
  Upload,
  Zap,
} from "lucide-react";
import { StatTile, Tile } from "@/components/kit";
import { HomeRank } from "@/components/player-rank";
import { VillageExportDialog } from "@/components/village-export-upload";
import { BuilderHutIcon, BuilderSlots, type Glyph } from "@/components/game/builder-hut-icon";
import { BuilderHutArt, LaboratoryArt } from "@/components/game/workshop-icon";
import { BuildingIcon } from "@/components/game/building-icon";
import { TownHall } from "@/components/game/town-hall";
import { UnitIcon } from "@/components/game/unit-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDisplay } from "@/lib/display-time";
import type { Standing } from "@/services/player-rank";
import type { StoredUnit } from "@/services/progress";
import { formatDuration, type ExportSummary } from "@/services/village";

/** A village's career numbers, from the player sync. Null where it has none. */
export interface BaseCareer {
  expLevel: number | null;
  /** Current trophies, from the clan's latest snapshot. Null outside a clan here. */
  trophies: number | null;
  bestTrophies: number | null;
  warStars: number | null;
  attackWins: number | null;
  defenseWins: number | null;
  builderBaseTrophies: number | null;
  capitalContributions: number | null;
}

export interface MainBaseView {
  label: string;
  /** The in-game name, shown when a label overrides it. */
  name: string;
  tag: string;
  thLevel: number | null;
  /** Town Hall 12 and up. */
  thWeaponLevel: number | null;
  bhLevel: number | null;
  verified: boolean;
  /** This is the member's main base (services/home.ts mainBase()). */
  isMain: boolean;
  clanName: string | null;
  clanRole: string | null;
  detailsHref: string;
  reportHref: string;
  /** Null before the player sync has read it. */
  career: BaseCareer | null;
  /** From the latest daily reading, or null before the first one. */
  progress: {
    pct: number;
    maxed: number;
    counted: number;
    capturedAt: string;
    heroes: StoredUnit[];
    /** Each unit group's % to max, in the game's order. */
    groups: Array<{ label: string; pct: number }>;
  } | null;
  standing: Standing;
  /** False for a clan this viewer holds no role in, whose name is not theirs to read. */
  showClanRank: boolean;
  /** The member's saved game export (076), summarised. Null when none is saved. */
  saved: ExportSummary | null;
}

const count = (value: number) => value.toLocaleString("en-GB");

/** Shown when the member has linked no village yet. */
export function NoBaseCard() {
  return (
    <Tile as="section" accent="var(--bubble)" banner className="flex flex-wrap items-center gap-4">
      <span
        className="cb-emblem size-11 shrink-0 rounded-control"
        style={{ "--emblem": "var(--primary)" } as React.CSSProperties}
      >
        <Castle aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">Link your village</h2>
        <p className="text-muted-foreground text-sm">
          Add your base by its tag to see its Town Hall, heroes, rank and progress here.
        </p>
      </div>
      <Button asChild>
        <Link href="/account">
          <Link2 aria-hidden />
          Add a base
        </Link>
      </Button>
    </Tile>
  );
}

/** One village: who, where it ranks, its numbers, how far along, what is building. */
export function BaseSlide({
  base,
  position,
  total,
  onHold,
}: {
  base: MainBaseView;
  /** 1-based, for "2 of 4". */
  position: number;
  total: number;
  /** Told when the upload dialog opens and closes, so the carousel holds still. */
  onHold?: (holding: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const named = base.label !== base.name;

  const openUpload = (open: boolean) => {
    setUploading(open);
    onHold?.(open);
  };

  return (
    <div className="space-y-5">
      {/* ── 1. Who, and where they stand ───────────────────────────────── */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-center">
        <div className="flex min-w-0 items-center gap-4">
          <span className="cb-hall">
            <TownHall level={base.thLevel} size="lg" />
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {base.isMain ? "Your main base" : "Your base"}
              {total > 1 && (
                <span className="normal-case tracking-normal tabular-nums">
                  {" "}
                  · {position} of {total}
                </span>
              )}
            </p>
            <h2 className="cb-title truncate text-3xl leading-tight">{base.label}</h2>
            <p className="text-muted-foreground truncate text-xs">
              {named && <>{base.name} · </>}
              <span className="font-mono">{base.tag}</span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {base.clanName ? (
                <Badge variant="secondary" className="max-w-[12rem]">
                  <span className="truncate">{base.clanName}</span>
                  {base.clanRole && <span className="capitalize opacity-75">· {base.clanRole}</span>}
                </Badge>
              ) : (
                <Badge variant="outline">Not in a clan here</Badge>
              )}
              {base.career?.expLevel != null && (
                <Badge variant="outline" title="Experience level">
                  XP {base.career.expLevel}
                </Badge>
              )}
              {base.verified && (
                <Badge variant="outline">
                  <ShieldCheck aria-hidden />
                  verified
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div
          className="cb-plate cb-lift p-4"
          style={{ "--i": 1 } as React.CSSProperties}
        >
          <HomeRank standing={base.standing} tag={base.tag} showClan={base.showClanRank} />
        </div>
      </div>

      {/* ── 2. Their numbers ───────────────────────────────────────────── */}
      <Stats base={base} />

      {/* ── 3 and 4. How far along, and what is building ───────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <ProgressBlock base={base} />
        <ExportBlock base={base} onUpload={() => openUpload(true)} />
      </div>

      {/* ── Where next. Base details is the reason this card exists. ───── */}
      <div className="flex flex-wrap items-center gap-2">
        <Button asChild>
          <Link href={base.detailsHref}>
            <Castle aria-hidden />
            Base details
          </Link>
        </Button>
        <Button type="button" variant="outline" onClick={() => openUpload(true)}>
          <Upload aria-hidden />
          {base.saved ? "Update JSON" : "Upload JSON"}
        </Button>
        <Button asChild variant="outline">
          <Link href={base.reportHref}>
            <ScrollText aria-hidden />
            Report
          </Link>
        </Button>
        {total > 1 && (
          <Link
            href="/account"
            className="text-primary ml-auto inline-flex min-h-11 items-center gap-0.5 text-sm font-medium hover:underline"
          >
            All {total} bases
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>

      <VillageExportDialog tag={base.tag} label={base.label} open={uploading} onOpenChange={openUpload} />
    </div>
  );
}

/** The career numbers, as tiles. A number the sync has not read is left out, not shown as 0. */
function Stats({ base }: { base: MainBaseView }) {
  const c = base.career;
  const tiles: Array<{ label: string; value: string; sub?: string; icon: Glyph }> = [];

  const trophies = c?.trophies ?? c?.bestTrophies ?? null;
  if (trophies !== null) {
    tiles.push({
      label: c?.trophies != null ? "Trophies" : "Best trophies",
      value: count(trophies),
      sub: c?.trophies != null && c.bestTrophies != null ? `best ${count(c.bestTrophies)}` : undefined,
      icon: Trophy,
    });
  }
  if (c?.warStars != null) {
    tiles.push({ label: "War stars", value: count(c.warStars), icon: Star });
  }
  if (c?.attackWins != null) {
    tiles.push({
      label: "Attack wins",
      value: count(c.attackWins),
      sub: c.defenseWins != null ? `${count(c.defenseWins)} defences won` : undefined,
      icon: Swords,
    });
  }
  if (c?.builderBaseTrophies != null) {
    tiles.push({
      label: "Builder Base",
      value: count(c.builderBaseTrophies),
      sub: base.bhLevel ? `Builder Hall ${base.bhLevel}` : "trophies",
      icon: BuilderHutIcon,
    });
  }
  if (c?.capitalContributions != null) {
    tiles.push({
      label: "Capital gold",
      value: count(c.capitalContributions),
      sub: "contributed",
      icon: Coins,
    });
  }
  if (base.thWeaponLevel) {
    tiles.push({ label: "Town Hall weapon", value: `Lv ${base.thWeaponLevel}`, icon: Zap });
  }

  if (tiles.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Trophies, war stars and wins appear here after the next daily read of this village.
      </p>
    );
  }

  return (
    // auto-fit, not a fixed 6: a village without a capital or a weapon has 4
    // or 5 tiles, and a fixed grid left a hole at the end of the row.
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
      {tiles.map((t, i) => (
        <StatTile
          key={t.label}
          variant="plate"
          label={t.label}
          value={t.value}
          sub={t.sub}
          icon={t.icon}
          className="cb-rise"
          style={{ "--i": i } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/** % to max, each group, and the heroes that make it up. */
function ProgressBlock({ base }: { base: MainBaseView }) {
  const { progress } = base;

  if (!progress) {
    return (
      <div className="cb-plate p-4">
        <p className="text-muted-foreground text-sm">
          Hero, troop and spell levels appear here after the next daily read of this village.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Progress"
      className="cb-plate cb-lift cb-rise space-y-4 p-4"
      style={{ "--i": 6 } as React.CSSProperties}
    >
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium">
            {base.thLevel ? `Town Hall ${base.thLevel} progress` : "Progress"}
          </h3>
          <span className="cb-title cb-pop text-3xl tabular-nums">{progress.pct}%</span>
        </div>
        <Progress value={progress.pct} label={`${base.label} progress`} tone="maxed" />
        <p className="text-muted-foreground text-xs">
          {progress.maxed} of {progress.counted} units maxed · read {formatDisplay(progress.capturedAt, "date")}
        </p>
      </div>

      {progress.heroes.length > 0 && (
        <ul aria-label="Heroes" className="flex flex-wrap gap-4">
          {progress.heroes.map((h) => (
            <li key={h.name} className="cb-hop" title={`${h.name} — ${h.level === 0 ? "locked" : `level ${h.level} of ${h.cap}`}`}>
              <UnitIcon
                plate
                name={h.name}
                group={h.group}
                size={48}
                level={h.level}
                maxed={h.capKnown !== false && h.cap > 0 && h.level >= h.cap}
                locked={h.level === 0}
              />
              <span className="sr-only">
                {h.name} {h.level === 0 ? "locked" : `level ${h.level} of ${h.cap}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {progress.groups.length > 0 && (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {progress.groups.map((g) => (
            <li key={g.label} className="min-w-0 space-y-1">
              <div className="flex justify-between gap-2 text-xs">
                <span className="truncate">{g.label}</span>
                <span className="text-muted-foreground tabular-nums">{g.pct}%</span>
              </div>
              <Progress value={g.pct} label={`${g.label} progress`} tone="maxed" className="h-1.5" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function exportedWhen(ageDays: number): string {
  if (ageDays === 0) return "exported today";
  if (ageDays === 1) return "exported yesterday";
  return `exported ${ageDays} days ago`;
}

/** Shown upgrades on the card. Base details lists every one. */
const UPGRADES_SHOWN = 3;

/** What the saved game export says, or how to add one. */
function ExportBlock({ base, onUpload }: { base: MainBaseView; onUpload: () => void }) {
  const { saved } = base;

  if (!saved) {
    return (
      <section
        aria-label="Game export"
        className="flex flex-col items-start justify-center gap-3 rounded-control border border-dashed p-4"
      >
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <FileJson aria-hidden className="text-primary size-4.5" />
          Track buildings, walls and upgrades
        </h3>
        <p className="text-muted-foreground text-sm">
          The game shares these only through its own export. Upload it once and this card shows your
          building progress, wall levels and every upgrade timer.
        </p>
        <Button type="button" size="sm" onClick={onUpload}>
          <Upload aria-hidden />
          Upload JSON
        </Button>
      </section>
    );
  }

  const shown = saved.running.slice(0, UPGRADES_SHOWN);

  return (
    <section
      aria-label="Game export"
      className="cb-plate cb-lift cb-rise space-y-4 p-4"
      style={{ "--i": 7 } as React.CSSProperties}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <FileJson aria-hidden className="text-primary size-4" />
          From your game export
        </h3>
        <span className="text-muted-foreground text-xs" title={formatDisplay(saved.exportedAt, "datetime")}>
          {exportedWhen(saved.ageDays)}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <Castle aria-hidden className="size-3.5" />
            Buildings
          </p>
          {saved.buildingsPct === null ? (
            <>
              <p className="cb-title text-2xl leading-none" title="This Town Hall's caps are not in the site's game data yet">
                —
              </p>
              <p className="text-muted-foreground text-xs">Caps not known yet</p>
            </>
          ) : (
            <>
              <p className="cb-title cb-pop text-2xl leading-none tabular-nums">{saved.buildingsPct}%</p>
              <Progress value={saved.buildingsPct} label="Buildings progress" tone="maxed" className="h-1.5" />
            </>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <BrickWall aria-hidden className="size-3.5" />
            Walls
          </p>
          {saved.walls ? (
            <>
              <p className="cb-title text-2xl leading-none tabular-nums">Lv {saved.walls.level}</p>
              <p className="text-muted-foreground text-xs tabular-nums">
                {count(saved.walls.atLevel)} of {count(saved.walls.total)} at this level
              </p>
            </>
          ) : (
            <p className="text-muted-foreground text-sm">None in the export</p>
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-muted-foreground flex items-center gap-1 text-xs">
            <BuilderHutArt className="size-4" />
            Builders busy
          </p>
          {saved.builders ? (
            <>
              <p className="cb-title text-2xl leading-none tabular-nums">
                {saved.builders.busy}/{saved.builders.total}
              </p>
              <BuilderSlots busy={saved.builders.busy} total={saved.builders.total} />
              <p className="text-muted-foreground text-xs">
                {saved.builders.busy >= saved.builders.total
                  ? "all working"
                  : `${saved.builders.total - saved.builders.busy} free`}
              </p>
              {saved.nextBuilderFree && (
                <p className="text-muted-foreground text-xs">
                  Next free in{" "}
                  <span className="text-foreground font-medium tabular-nums">
                    {formatDuration(saved.nextBuilderFree.secondsLeft)}
                  </span>
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">—</p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium">
          {saved.running.length === 0
            ? "Nothing upgrading"
            : `${saved.running.length} ${saved.running.length === 1 ? "upgrade" : "upgrades"} running`}
          {saved.finishedSince > 0 && (
            <span className="text-bubble-ink"> · {saved.finishedSince} finished since the export</span>
          )}
        </p>
        {saved.lab && (
          <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
            <LaboratoryArt className="size-4" />
            {saved.lab.busy
              ? `Lab busy${saved.lab.name ? ` with ${saved.lab.name}` : ""}, free in ${formatDuration(saved.lab.secondsLeft)}`
              : "Lab is free"}
          </p>
        )}
        {shown.length > 0 && (
          <ul className="space-y-1.5 text-sm">
            {shown.map((u, i) => (
              <li
                key={`${u.village}:${u.name}:${i}`}
                className="hover:bg-foreground/5 -mx-1.5 flex items-center justify-between gap-3 rounded-chip px-1.5 py-0.5 transition-colors"
              >
                {u.subject?.type === "unit" ? (
                  <UnitIcon name={u.name} group={u.subject.group} size={24} />
                ) : (
                  <BuildingIcon name={u.name} village={u.village} kind={u.subject?.kind ?? "Other"} size={24} />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {u.name}{" "}
                  <span className="text-muted-foreground tabular-nums">
                    {u.fromLevel} → {u.fromLevel + 1}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">{formatDuration(u.secondsLeft)}</span>
              </li>
            ))}
          </ul>
        )}
        {saved.running.length > shown.length && (
          <Link href={base.detailsHref} className="text-primary text-xs font-medium hover:underline">
            +{saved.running.length - shown.length} more in Base details
          </Link>
        )}
      </div>

      {saved.stale && (
        <p className="text-warning-ink text-xs">
          Timers and levels are as of the export. Upload a fresh one after you upgrade.
        </p>
      )}
    </section>
  );
}
