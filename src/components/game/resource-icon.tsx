// The resource an upgrade costs, as a small glyph: a coin for gold, a drop for
// elixir and dark elixir, a gem for gems and the three ores.
//
// Drawn here rather than taken from the Fan Kit, which has no resource art
// (art-manifest.json). The colours are the game's own identity colours — a
// player reads "pink drop" as elixir before reading any word — so they are
// fixed rather than themed, with a dark outline that holds in both themes.
// Never colour alone: every use sits beside a number, and `label` names it for
// screen readers.

import type { Resource } from "@/data/game/costs";
import { cn } from "@/lib/utils";

type Shape = "coin" | "drop" | "gem";

const STYLE: Record<Resource, { shape: Shape; fill: string; label: string }> = {
  gold: { shape: "coin", fill: "oklch(0.84 0.16 88)", label: "Gold" },
  elixir: { shape: "drop", fill: "oklch(0.66 0.24 330)", label: "Elixir" },
  dark: { shape: "drop", fill: "oklch(0.36 0.06 300)", label: "Dark elixir" },
  builderGold: { shape: "coin", fill: "oklch(0.8 0.12 75)", label: "Builder gold" },
  builderElixir: { shape: "drop", fill: "oklch(0.68 0.17 290)", label: "Builder elixir" },
  gems: { shape: "gem", fill: "oklch(0.72 0.19 150)", label: "Gems" },
  shiny: { shape: "gem", fill: "oklch(0.78 0.08 230)", label: "Shiny ore" },
  glowy: { shape: "gem", fill: "oklch(0.62 0.2 305)", label: "Glowy ore" },
  starry: { shape: "gem", fill: "oklch(0.82 0.15 75)", label: "Starry ore" },
};

export function resourceLabel(resource: Resource): string {
  return STYLE[resource].label;
}

export function ResourceIcon({
  resource,
  size = 16,
  className,
  decorative = true,
}: {
  resource: Resource;
  size?: number;
  className?: string;
  /** False when no text beside it names the resource. */
  decorative?: boolean;
}) {
  const { shape, fill, label } = STYLE[resource];
  const a11y = decorative ? { "aria-hidden": true } : { role: "img", "aria-label": label };
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      className={cn("inline-block shrink-0", className)}
      {...a11y}
    >
      {shape === "coin" && (
        <>
          <circle cx="8" cy="8" r="6.6" fill={fill} stroke="oklch(0.35 0.06 60)" strokeWidth="1.2" />
          <circle cx="8" cy="8" r="3.6" fill="none" stroke="oklch(0.45 0.08 65 / 0.55)" strokeWidth="1" />
        </>
      )}
      {shape === "drop" && (
        <>
          <path
            d="M8 1.4C8 1.4 3 7 3 10.1A5 5 0 0 0 13 10.1C13 7 8 1.4 8 1.4Z"
            fill={fill}
            stroke="oklch(0.25 0.05 300)"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
          <ellipse cx="6.3" cy="9.6" rx="1.1" ry="1.7" fill="oklch(1 0 0 / 0.45)" />
        </>
      )}
      {shape === "gem" && (
        <>
          <path
            d="M4.2 2.5H11.8L14.4 6.2L8 14L1.6 6.2Z"
            fill={fill}
            stroke="oklch(0.28 0.04 260)"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
          <path d="M1.6 6.2H14.4M6 2.5L8 6.2L10 2.5M8 6.2V14" fill="none" stroke="oklch(1 0 0 / 0.4)" strokeWidth="0.8" />
        </>
      )}
    </svg>
  );
}
