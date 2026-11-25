// A building, trap or wall, drawn the way UnitIcon draws a troop: its picture
// in a square, with its level on a plate in the corner.
//
// WITH ART, the Fan Kit's picture (scripts/game-art.ts, `building-…` and
// `trap-…` keys). WITHOUT ART — and a deployment has none until the kit is run
// again with building matching — a token: one icon per KIND, so a grid of
// forty buildings reads "defense, defense, trap, resource" at a glance instead
// of a column of names. The name beside or under it is always the label.

import {
  Bomb,
  Box,
  BrickWall,
  Castle,
  Coins,
  Tent,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { artKeyForBuilding, artKeyForTownHall, type ArtManifest } from "@/lib/game-art";
import { BuilderHutIcon, type Glyph } from "@/components/game/builder-hut-icon";
import { GameArt, PlatedArt } from "@/components/game/game-art";
import type { Village } from "@/types/domain";

interface KindStyle {
  glyph: Glyph;
  tone: string;
}

/** Each export `kind`'s token. Decoration, like UnitIcon's: same in both themes. */
const KIND_STYLE: Record<string, KindStyle> = {
  Defense: { glyph: Castle, tone: "oklch(0.5 0.15 25)" },
  trap: { glyph: Bomb, tone: "oklch(0.42 0.06 60)" },
  Wall: { glyph: BrickWall, tone: "oklch(0.5 0.04 260)" },
  Resource: { glyph: Coins, tone: "oklch(0.6 0.13 85)" },
  Army: { glyph: Tent, tone: "oklch(0.5 0.13 300)" },
  // Builder's Hut; Worker2 is the Builder Base's Master Builder and B.O.B.
  Worker: { glyph: BuilderHutIcon, tone: "oklch(0.55 0.12 50)" },
  Worker2: { glyph: BuilderHutIcon, tone: "oklch(0.55 0.12 50)" },
  Helper: { glyph: Wrench, tone: "oklch(0.55 0.1 190)" },
  "Town Hall": { glyph: Castle, tone: "oklch(0.55 0.2 25)" },
  "Town Hall2": { glyph: Castle, tone: "oklch(0.5 0.06 240)" },
};

const OTHER: KindStyle = { glyph: Box, tone: "oklch(0.5 0.03 260)" };

export function buildingStyle(kind: string): KindStyle {
  return KIND_STYLE[kind] ?? OTHER;
}

export function BuildingIcon({
  name,
  village,
  kind,
  size = 48,
  level,
  maxed = false,
  hallLevel,
  plate = false,
  className,
  manifest,
}: {
  name: string;
  village: Village;
  /** The export's kind: "Defense", "trap", "Wall", … */
  kind: string;
  /** The square, in px. */
  size?: number;
  /** Shown on the corner plate. Omit for no plate. */
  level?: number;
  /** Gold plate: at the cap for this hall. */
  maxed?: boolean;
  /** For the Town Hall itself, whose picture changes with its level. */
  hallLevel?: number | null;
  /** On a water-bubble plate (PlatedArt): for tiles and rows, 28px and up. */
  plate?: boolean;
  className?: string;
  /** For tests. Pages use the committed manifest. */
  manifest?: ArtManifest;
}) {
  const { glyph: Glyph, tone } = buildingStyle(kind);
  const art = kind === "Town Hall" ? artKeyForTownHall(hallLevel ?? level) : artKeyForBuilding(name, village, kind);
  const token = (
    <span
      aria-hidden
      className="cb-unit-token"
      data-kind={kind}
      style={{ "--unit": tone, width: size, height: size } as React.CSSProperties}
    >
      <Glyph style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }} />
    </span>
  );

  return (
    <span className={cn("relative inline-flex shrink-0", className)} style={{ width: size, height: size }}>
      {plate ? (
        <PlatedArt art={art} size={size} fallback={token} maxed={maxed} manifest={manifest} />
      ) : (
        <GameArt art={art} size={size} alt="" fallback={token} manifest={manifest} />
      )}
      {level !== undefined && level > 0 && (
        <span
          aria-hidden
          className={cn("cb-unit-level", maxed && "cb-unit-level-max")}
          data-maxed={maxed || undefined}
        >
          {level}
        </span>
      )}
    </span>
  );
}
