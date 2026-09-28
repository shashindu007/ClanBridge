// One of the member's villages on Home: Town Hall, progress, heroes, and Base
// details one click away.
//
// Before this, Base details was three clicks deep — account menu, Profile, the
// base, then its button — for the page a member opens most after a war. Now
// Home answers "how far along am I" at a glance.
//
// PRESENTATION ONLY, and safe in the browser: components/base-carousel.tsx
// rotates these when a member owns more than one village, so nothing here may
// import a repository or anything server-only. Which base is "main" is
// services/home.ts's mainBase(); the page puts it first.

import Link from "next/link";
import { Castle, ChevronRight, Link2, ScrollText, ShieldCheck } from "lucide-react";
import { Tile } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { UnitIcon } from "@/components/game/unit-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatDisplay } from "@/lib/display-time";
import type { StoredUnit } from "@/services/progress";

export interface MainBaseView {
  label: string;
  /** The in-game name, shown when a label overrides it. */
  name: string;
  tag: string;
  thLevel: number | null;
  verified: boolean;
  /** This is the member's main base (services/home.ts mainBase()). */
  isMain: boolean;
  clanName: string | null;
  clanRole: string | null;
  detailsHref: string;
  reportHref: string;
  /** From the latest daily reading, or null before the first one. */
  progress: {
    pct: number;
    maxed: number;
    counted: number;
    capturedAt: string;
    heroes: StoredUnit[];
  } | null;
}

/** Shown when the member has linked no village yet. */
export function NoBaseCard() {
  return (
    <Tile as="section" accent="var(--trim)" banner className="flex flex-wrap items-center gap-4">
      <span
        className="cb-emblem size-11 shrink-0 rounded-control"
        style={{ "--emblem": "var(--primary)" } as React.CSSProperties}
      >
        <Castle aria-hidden className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-semibold">Link your village</h2>
        <p className="text-muted-foreground text-sm">
          Add your base by its tag to see its Town Hall, heroes and progress here.
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

/** One village's row: who, how far along, where next. No frame of its own. */
export function BaseSlide({
  base,
  position,
  total,
}: {
  base: MainBaseView;
  /** 1-based, for "2 of 4". */
  position: number;
  total: number;
}) {
  const named = base.label !== base.name;
  const { progress } = base;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_auto] lg:items-center">
      {/* Who: the village itself. */}
      <div className="flex min-w-0 items-center gap-4">
        <TownHall level={base.thLevel} size="lg" />
        <div className="min-w-0 space-y-0.5">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {base.isMain ? "Your main base" : "Your base"}
            {total > 1 && (
              <span className="normal-case tracking-normal tabular-nums">
                {" "}
                · {position} of {total}
              </span>
            )}
          </p>
          <h2 className="cb-title truncate text-2xl leading-tight">{base.label}</h2>
          <p className="text-muted-foreground truncate text-xs">
            {named && <>{base.name} · </>}
            <span className="font-mono">{base.tag}</span>
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {base.clanName ? (
              <Badge variant="secondary" className="max-w-[11rem]">
                <span className="truncate">{base.clanName}</span>
                {base.clanRole && <span className="capitalize opacity-75">· {base.clanRole}</span>}
              </Badge>
            ) : (
              <Badge variant="outline">Not in a clan here</Badge>
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

      {/* How far along: the answer, then the heroes that make it up. */}
      <div className="min-w-0 space-y-3 lg:border-l lg:pl-6">
        {progress ? (
          <>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium">
                  {base.thLevel ? `Town Hall ${base.thLevel} progress` : "Progress"}
                </span>
                <span className="cb-title text-2xl tabular-nums">{progress.pct}%</span>
              </div>
              <Progress value={progress.pct} label={`${base.label} progress`} />
              <p className="text-muted-foreground text-xs">
                {progress.maxed} of {progress.counted} units maxed · read{" "}
                {formatDisplay(progress.capturedAt, "date")}
              </p>
            </div>
            {progress.heroes.length > 0 && (
              <ul aria-label="Heroes" className="flex flex-wrap gap-4">
                {progress.heroes.map((h) => (
                  <li
                    key={h.name}
                    title={`${h.name} — ${h.level === 0 ? "locked" : `level ${h.level} of ${h.cap}`}`}
                  >
                    <UnitIcon
                      name={h.name}
                      group={h.group}
                      size={42}
                      level={h.level}
                      maxed={h.cap > 0 && h.level >= h.cap}
                      locked={h.level === 0}
                    />
                    <span className="sr-only">
                      {h.name} {h.level === 0 ? "locked" : `level ${h.level} of ${h.cap}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-muted-foreground text-sm">
            Hero, troop and spell levels appear here after the next daily read of this village.
          </p>
        )}
      </div>

      {/* Where next. Base details is the reason this card exists. */}
      <div className="flex flex-wrap items-center gap-2 lg:flex-col lg:items-stretch">
        <Button asChild>
          <Link href={base.detailsHref}>
            <Castle aria-hidden />
            Base details
          </Link>
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
            className="text-primary inline-flex items-center justify-center gap-0.5 text-xs font-medium hover:underline"
          >
            All {total} bases
            <ChevronRight aria-hidden className="size-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
