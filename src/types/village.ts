// T11B.11 — a pasted village export, after mapping (src/integration/village-export.ts).
//
// Its own file rather than domain.ts because it depends on src/data/game's
// ResolvedUnit, and domain.ts is imported BY src/data/game — a type-only cycle
// is harmless at runtime but makes the dependency direction unreadable.
//
// NEVER STORED. These objects live in the member's browser tab and nowhere else;
// see the header of the integration file for why.

import type { ResolvedUnit } from "@/data/game";
import type { Village } from "@/types/domain";

/** Every instance of one building type in one village, aggregated. */
export interface ExportedBuilding {
  name: string;
  village: Village;
  /** "Defense", "Resource", "Army", "Wall", "Worker", "trap", … */
  kind: string;
  /** Max level at this village's hall, or null when the data does not know the building. */
  cap: number | null;
  count: number;
  /** Instances at each level, e.g. walls { 16: 120, 17: 205 }. */
  levels: Record<number, number>;
  upgrading: number;
  /** Geared-up instances (Cannon → Double Cannon, Archer Tower → Fast mode, …). */
  geared: number;
  supercharged: number;
}

export interface ExportedUpgrade {
  name: string;
  village: Village;
  /** The level being upgraded FROM — the export reports the old level until it finishes. */
  fromLevel: number;
  /** Seconds left as of when the export was parsed, clamped at 0. */
  remainingSeconds: number;
  finishesAt: string;
}

export interface ExportedVillage {
  tag: string;
  exportedAt: string;
  thLevel: number | null;
  bhLevel: number | null;
  buildings: ExportedBuilding[];
  units: ResolvedUnit[];
  upgrades: ExportedUpgrade[];
  /** Ids the pinned game data does not know — newer than the data. */
  unknownIds: number;
}
