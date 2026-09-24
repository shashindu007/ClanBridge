// A Town Hall level, drawn the same way everywhere.
//
// It used to be five different things: this chip on the war and CWL pages, a
// bare "17" in the members table, "TH17" text on the CWL lineup, a Badge on the
// layouts page and "Town Hall 17" in prose on the player page. A player learns
// one shape for "how strong is this base" and should see it wherever a base is.
//
// WITH ART, the hall's own picture with its level beside it in the display face
// — the one thing every Clash player recognises at a glance. WITHOUT ART (a
// fresh clone, or a hall newer than the Fan Kit), a chip reading "TH 17" with a
// stripe hinting at the hall's material. "Town Hall 17" is the accessible name
// either way, so a screen reader never hears only "17".
//
// Re-exported from lineup-parts.tsx, where it started, so its callers did not
// have to move.

import { cn } from "@/lib/utils";
import { ART_MANIFEST, artKeyForTownHall, resolveArt, type ArtManifest } from "@/lib/game-art";
import { GameArt } from "@/components/game/game-art";

type Size = "xs" | "sm" | "md" | "lg";

const ART_PX: Record<Size, number> = { xs: 22, sm: 28, md: 44, lg: 72 };
const NUMBER_TEXT: Record<Size, string> = {
  xs: "text-sm",
  sm: "text-base",
  md: "text-xl",
  lg: "text-3xl",
};

/**
 * A hint of each hall's material, as a stripe on the chip — stone for the
 * early halls, then lava, white-and-gold, blue, ice, green, violet, orange and
 * red as the game has painted them. DECORATION: the number carries the meaning,
 * and the stripe only makes a column of them easier to scan.
 */
export function townHallTone(level: number): string {
  if (level <= 6) return "oklch(0.68 0.03 70)";
  if (level <= 8) return "oklch(0.45 0.05 45)";
  if (level === 9) return "oklch(0.38 0.03 270)";
  if (level === 10) return "oklch(0.58 0.2 30)";
  if (level === 11) return "oklch(0.85 0.1 85)";
  if (level === 12) return "oklch(0.6 0.15 250)";
  if (level === 13) return "oklch(0.78 0.1 205)";
  if (level === 14) return "oklch(0.62 0.15 150)";
  if (level === 15) return "oklch(0.52 0.18 300)";
  if (level === 16) return "oklch(0.7 0.14 60)";
  return "oklch(0.55 0.2 25)";
}

export function TownHall({
  level,
  size = "xs",
  className,
  manifest = ART_MANIFEST,
}: {
  level: number | null;
  size?: Size;
  className?: string;
  /** For tests. Pages use the committed manifest. */
  manifest?: ArtManifest;
}) {
  const label = level ? `Town Hall ${level}` : "Town Hall not known yet";
  const key = artKeyForTownHall(level);

  if (level && resolveArt(key, manifest)) {
    return (
      <span
        role="img"
        aria-label={label}
        title={label}
        className={cn("inline-flex shrink-0 items-center gap-1", className)}
      >
        <GameArt art={key} size={ART_PX[size]} alt="" manifest={manifest} />
        <span aria-hidden className={cn("cb-title leading-none tabular-nums", NUMBER_TEXT[size])}>
          {level}
        </span>
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        "bg-muted text-foreground relative inline-flex shrink-0 items-center overflow-hidden rounded-chip font-semibold tabular-nums",
        size === "md" || size === "lg" ? "py-1 pr-2.5 pl-3 text-sm" : "py-0.5 pr-1.5 pl-2.5 text-xs",
        className,
      )}
    >
      {level ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ background: townHallTone(level) }}
        />
      ) : null}
      <span aria-hidden>TH {level ?? "?"}</span>
    </span>
  );
}
