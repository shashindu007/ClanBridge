"use client";

// Every village a member owns, one at a time, on Home.
//
// A member with a main and two alts used to see only the main here, and had to
// go through Profile to reach the others. Now the card shows each in turn:
// arrows on both sides, a dot per base, and it moves on by itself every 20
// seconds — the main base first, because it is the one most people check.
//
// ─────────────────────────────────────────────────────────────────────────────
// MOVING BY ITSELF, WITHOUT TAKING THE PAGE FROM ANYONE (WCAG 2.2.2)
//
//   - It stops while the pointer is over it or focus is inside it, so a member
//     reaching for "Base details" never has the base change under their click.
//   - A pause button beside the dots stops it for good; it says what it does.
//   - It does not turn while the tab is hidden, so a member coming back finds
//     the base they left rather than one a dozen turns later.
//   - The thin bar along the bottom fills over the 20 seconds, so the change
//     never comes as a surprise.
//   - aria-live is "off" while it turns on its own and "polite" once paused, so
//     a screen reader is not interrupted every 20 seconds but does hear a
//     change the member asked for.
//
// One village: no arrows, no dots, no timer — just the card.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Tile } from "@/components/kit";
import { BaseSlide, type MainBaseView } from "@/components/main-base-card";
import { cn } from "@/lib/utils";

export const ROTATE_MS = 20_000;

export function BaseCarousel({
  bases,
  interval = ROTATE_MS,
}: {
  /** The main base first. Never empty — the page shows NoBaseCard instead. */
  bases: MainBaseView[];
  interval?: number;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [holding, setHolding] = useState(false);
  const total = bases.length;
  const many = total > 1;
  const turning = many && !paused && !holding;

  const go = useCallback((step: number) => setIndex((i) => (i + step + total) % total), [total]);

  // `index` is a dependency on purpose: a manual move restarts the 20 seconds,
  // so the next automatic turn never lands a moment after the member's own.
  useEffect(() => {
    if (!turning) return;
    const id = window.setTimeout(() => {
      if (!document.hidden) go(1);
    }, interval);
    return () => window.clearTimeout(id);
  }, [turning, interval, index, go]);

  const base = bases[Math.min(index, total - 1)]!;

  return (
    <Tile
      as="section"
      accent="var(--trim)"
      banner
      className={cn("overflow-hidden", many && "pb-4 sm:px-14")}
    >
      <div
        role={many ? "region" : undefined}
        aria-roledescription={many ? "carousel" : undefined}
        aria-label={many ? "Your bases" : undefined}
        onMouseEnter={() => setHolding(true)}
        onMouseLeave={() => setHolding(false)}
        onFocus={() => setHolding(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHolding(false);
        }}
        onKeyDown={(e) => {
          if (!many) return;
          if (e.key === "ArrowLeft") go(-1);
          if (e.key === "ArrowRight") go(1);
        }}
      >
        {many && (
          <>
            <ArrowButton side="left" label="Previous base" onClick={() => go(-1)} />
            <ArrowButton side="right" label="Next base" onClick={() => go(1)} />
          </>
        )}

        <div
          key={index}
          role={many ? "group" : undefined}
          aria-roledescription={many ? "slide" : undefined}
          aria-label={many ? `${index + 1} of ${total}: ${base.label}` : undefined}
          aria-live={many ? (turning ? "off" : "polite") : undefined}
          className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-right-3 motion-safe:duration-300"
        >
          <BaseSlide base={base} position={index + 1} total={total} />
        </div>

        {many && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <SmallArrow side="left" label="Previous base" onClick={() => go(-1)} />
            <div className="flex items-center gap-1.5">
              {bases.map((b, i) => (
                <button
                  key={b.tag}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Show ${b.label}`}
                  aria-current={i === index ? "true" : undefined}
                  className={cn(
                    "focus-visible:ring-ring/50 h-2 rounded-full transition-all outline-none focus-visible:ring-[3px]",
                    i === index ? "bg-primary w-6" : "bg-muted-foreground/35 hover:bg-muted-foreground/60 w-2",
                  )}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              aria-label={paused ? "Turn through bases automatically" : "Stop turning through bases"}
              title={paused ? "Play" : "Pause"}
              className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-[3px]"
            >
              {paused ? <Play aria-hidden className="size-3.5" /> : <Pause aria-hidden className="size-3.5" />}
            </button>
            <SmallArrow side="right" label="Next base" onClick={() => go(1)} />
          </div>
        )}
      </div>

      {many && (
        // Fills over the interval; restarts on every turn (keyed by index)
        // and holds still whenever the carousel does.
        <span
          key={`timer-${index}`}
          aria-hidden
          className="cb-carousel-timer"
          style={{
            animationDuration: `${interval}ms`,
            animationPlayState: turning ? "running" : "paused",
          }}
        />
      )}
    </Tile>
  );
}

function ArrowButton({
  side,
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "bg-card/80 hover:bg-accent text-foreground focus-visible:ring-ring/50 absolute top-1/2 z-10 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm backdrop-blur-sm transition-colors outline-none focus-visible:ring-[3px]",
        // In the gutters the card leaves for them; on a phone there is no
        // gutter, and the same two buttons sit beside the dots instead.
        "max-sm:hidden",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Icon aria-hidden className="size-5" />
    </button>
  );
}

/** The phone's arrows, in the dots row. Hidden from sm up, where the side ones show. */
function SmallArrow({
  side,
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="hover:bg-accent focus-visible:ring-ring/50 inline-flex size-8 items-center justify-center rounded-full border outline-none focus-visible:ring-[3px] sm:hidden"
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}
