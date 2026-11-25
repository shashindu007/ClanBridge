// Who does an upgrade, as the building it happens in: a Builder's Hut for the
// builders, the Laboratory for the lab, the Pet House for pets.
//
// Fan Kit art where the manifest has it (scripts/game-art.ts), and the drawn
// glyph where it does not — the Builder Base's huts and Star Laboratory are not
// in any kit yet, so they keep the hut and flask lines. GameArt decides, so a
// later kit fills them in with no change here.
//
// Server-safe: no hooks.

import { FlaskConical, PawPrint } from "lucide-react";
import { BuilderHutIcon, type Glyph, type GlyphProps } from "@/components/game/builder-hut-icon";
import { GameArt, PlatedArt } from "@/components/game/game-art";
import { artKeyForBuilding, type ArtManifest } from "@/lib/game-art";
import type { Workshop } from "@/services/village";
import type { Village } from "@/types/domain";

/** The building each workshop is, per village. Null where a village has none. */
const BUILDING: Record<Village, Record<Workshop, string | null>> = {
  home: { builders: "Builder's Hut", lab: "Laboratory", pets: "Pet House" },
  builder: { builders: "Master Builder's Hut", lab: "Star Laboratory", pets: null },
};

const FALLBACK: Record<Workshop, Glyph> = {
  builders: BuilderHutIcon,
  lab: FlaskConical,
  pets: PawPrint,
};

/** The art key for a workshop's building, or null. Exported for tests. */
export function workshopArtKey(workshop: Workshop, village: Village = "home"): string | null {
  const name = BUILDING[village][workshop];
  return name ? artKeyForBuilding(name, village, workshop === "builders" ? "Worker" : "Army") : null;
}

export function WorkshopIcon({
  workshop,
  village = "home",
  size,
  plate = false,
  className,
  manifest,
}: {
  workshop: Workshop;
  village?: Village;
  /** The square, in px. */
  size: number;
  /** On a water-bubble plate (PlatedArt), as in the tracker's slot cards. */
  plate?: boolean;
  className?: string;
  /** For tests. Pages use the committed manifest. */
  manifest?: ArtManifest;
}) {
  const Fallback = FALLBACK[workshop];
  if (plate) {
    return (
      <PlatedArt
        art={workshopArtKey(workshop, village)}
        size={size}
        manifest={manifest}
        fallback={<Fallback aria-hidden className={className} style={{ width: size, height: size }} />}
      />
    );
  }
  return (
    <GameArt
      art={workshopArtKey(workshop, village)}
      size={size}
      alt=""
      className={className}
      manifest={manifest}
      fallback={<Fallback aria-hidden className={className} style={{ width: size, height: size }} />}
    />
  );
}

/** "size-3.5" → 14. The px a Tailwind size class draws, for art that needs a number. */
function pxOf(className: string | undefined, fallback: number): number {
  const m = /(?:^|\s)size-(\d+(?:\.\d+)?)(?:\s|$)/.exec(className ?? "");
  return m ? Number(m[1]) * 4 : fallback;
}

/**
 * A workshop's icon shaped like a lucide icon — sized by its `size-*` class —
 * so it drops into anything that takes a Glyph (StatTile's `icon`, a row of
 * workshop chips) without that component knowing it is a picture.
 */
function workshopGlyph(workshop: Workshop): Glyph {
  function WorkshopGlyph({ className }: GlyphProps) {
    return <WorkshopIcon workshop={workshop} size={pxOf(className, 24)} className={className} />;
  }
  WorkshopGlyph.displayName = `WorkshopGlyph(${workshop})`;
  return WorkshopGlyph;
}

export const BuilderHutArt = workshopGlyph("builders");
export const LaboratoryArt = workshopGlyph("lab");
export const PetHouseArt = workshopGlyph("pets");

/** The Glyph for each workshop, home village. */
export const WORKSHOP_ART: Record<Workshop, Glyph> = {
  builders: BuilderHutArt,
  lab: LaboratoryArt,
  pets: PetHouseArt,
};
