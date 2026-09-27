// A hero, troop, spell or pet, drawn the same way everywhere: its picture in a
// square, with its level on a plate in the corner — the army screen's shape,
// which every Clash player reads without thinking.
//
// WITH ART, the Fan Kit's picture. WITHOUT ART (a fresh clone, or a unit newer
// than the kit), a token: one common icon per kind of unit — a crown for a
// hero, swords for a troop, a flask for a spell — on the kind's colour, so a
// grid of fifty units is never a column of empty boxes. Base details used to draw NOTHING when the art was
// missing, which on a deployment without the Fan Kit meant no icons at all.
//
// The token's colour is DECORATION — the name beside or under it is always the
// label — so it may use hues the status tokens reserve for meaning elsewhere.

import {
  Crown,
  FlaskConical,
  Flame,
  Gem,
  Hammer,
  PawPrint,
  Shield,
  Swords,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { artKeyForUnit, type ArtManifest } from "@/lib/game-art";
import { GameArt } from "@/components/game/game-art";
import type { UnitGroup } from "@/data/game";

/** Each group's token colour. Same in both themes: white ink on a mid tone. */
const GROUP_TONE: Record<UnitGroup, string> = {
  // Not gold: gold is the "maxed" plate, and a gold hero wearing a gold plate
  // would hide the one signal the plate exists for.
  hero: "oklch(0.5 0.15 25)",
  builderHero: "oklch(0.5 0.15 25)",
  equipment: "oklch(0.55 0.1 190)",
  pet: "oklch(0.56 0.14 145)",
  elixirTroop: "oklch(0.56 0.18 340)",
  darkTroop: "oklch(0.42 0.12 300)",
  superTroop: "oklch(0.6 0.17 45)",
  siege: "oklch(0.48 0.05 80)",
  elixirSpell: "oklch(0.56 0.16 260)",
  darkSpell: "oklch(0.4 0.12 285)",
  guardian: "oklch(0.55 0.1 220)",
  builderTroop: "oklch(0.5 0.06 240)",
};

/**
 * The common icon for a group with no picture: one shape per KIND of unit, so
 * a missing Wizard reads as "a troop" and a missing Frosty as "a pet". The
 * unit's own name is always beside or under it — the icon only says the kind.
 */
const GROUP_GLYPH: Record<UnitGroup, LucideIcon> = {
  hero: Crown,
  builderHero: Crown,
  equipment: Gem,
  pet: PawPrint,
  elixirTroop: Swords,
  darkTroop: Swords,
  superTroop: Flame,
  siege: Hammer,
  elixirSpell: FlaskConical,
  darkSpell: FlaskConical,
  guardian: Shield,
  builderTroop: Swords,
};

export function UnitIcon({
  name,
  group,
  size = 48,
  level,
  maxed = false,
  locked = false,
  className,
  manifest,
}: {
  name: string;
  group: UnitGroup;
  /** The square, in px. */
  size?: number;
  /** Shown on the corner plate. Omit for no plate. */
  level?: number;
  /** Gold plate: at the cap for this hall. */
  maxed?: boolean;
  /** Not unlocked yet: greyed, and no plate. */
  locked?: boolean;
  className?: string;
  /** For tests. Pages use the committed manifest. */
  manifest?: ArtManifest;
}) {
  const Glyph = GROUP_GLYPH[group];
  const token = (
    <span
      aria-hidden
      className="cb-unit-token"
      style={
        {
          "--unit": GROUP_TONE[group],
          width: size,
          height: size,
        } as React.CSSProperties
      }
    >
      <Glyph style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5) }} />
    </span>
  );

  return (
    <span
      className={cn("relative inline-flex shrink-0", locked && "opacity-45 grayscale", className)}
      style={{ width: size, height: size }}
    >
      <GameArt
        art={artKeyForUnit(name, group)}
        size={size}
        alt=""
        fallback={token}
        manifest={manifest}
      />
      {level !== undefined && !locked && (
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
