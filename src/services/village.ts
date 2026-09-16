// T11B.11 — arithmetic over a pasted village export. Pure, and browser-safe:
// components/village-export-paste.tsx runs it client-side.
//
// Units from an export go through services/progress.ts unchanged — they carry
// the same ResolvedUnit shape the sync job stores. This file is only what the
// API never had: buildings, walls, traps and running timers.
//
// Same rule as progress.ts: levels against caps, summed per INSTANCE. Two cannons
// at 20 of 21 are 40 of 42, not "two unmaxed cannons". Walls are counted the
// same way, which is why a TH upgrade makes the wall bar drop sharply — that is
// accurate, and every tracker shows it.

import type { ExportedBuilding, ExportedVillage } from "@/types/village";
import type { Village } from "@/types/domain";

export type BuildingGroupKey = "defenses" | "traps" | "walls" | "resources" | "army" | "workers";

const GROUP_OF_KIND: Record<string, BuildingGroupKey | null> = {
  Defense: "defenses",
  trap: "traps",
  Wall: "walls",
  Resource: "resources",
  Army: "army",
  Worker: "workers",
  Worker2: "workers",
  Helper: "workers",
  // The halls are the yardstick every other cap is read against, so they are not
  // "progress" towards themselves. Shown in the header instead.
  "Town Hall": null,
  "Town Hall2": null,
};

export const BUILDING_GROUP_LABELS: Record<BuildingGroupKey, string> = {
  defenses: "Defenses",
  traps: "Traps",
  walls: "Walls",
  resources: "Resources",
  army: "Army buildings",
  workers: "Builders and helpers",
};

const GROUP_ORDER: BuildingGroupKey[] = ["defenses", "traps", "walls", "resources", "army", "workers"];

export interface BuildingTally {
  done: number;
  total: number;
  pct: number;
}

export interface BuildingGroup extends BuildingTally {
  key: BuildingGroupKey;
  label: string;
  buildings: ExportedBuilding[];
  /** Building types with no usable cap — unknown to the data, or above it. */
  uncounted: number;
}

/** The highest level any instance of this building has. */
export function highestLevel(building: ExportedBuilding): number {
  return Math.max(0, ...Object.keys(building.levels).map(Number));
}

/**
 * Whether a building's cap can be trusted. An instance ABOVE the cap proves the
 * pinned data is stale for it, the same rule resolveUnit() applies to units.
 */
export function capTrusted(building: ExportedBuilding): building is ExportedBuilding & { cap: number } {
  return building.cap !== null && highestLevel(building) <= building.cap;
}

function pct(done: number, total: number): number {
  return total <= 0 ? 100 : Math.floor((done / total) * 1000) / 10;
}

export function buildingTally(buildings: ExportedBuilding[]): BuildingTally {
  let done = 0;
  let total = 0;
  for (const b of buildings) {
    if (!capTrusted(b)) continue;
    for (const [level, count] of Object.entries(b.levels)) {
      done += Math.min(Number(level), b.cap) * count;
      total += b.cap * count;
    }
  }
  return { done, total, pct: pct(done, total) };
}

export function buildingGroups(village: ExportedVillage, which: Village): BuildingGroup[] {
  const byGroup = new Map<BuildingGroupKey, ExportedBuilding[]>();

  for (const b of village.buildings) {
    if (b.village !== which) continue;
    // An unknown kind is still shown, under the most generic group, rather than dropped.
    const key = b.kind in GROUP_OF_KIND ? GROUP_OF_KIND[b.kind] : "army";
    if (!key) continue;
    const list = byGroup.get(key) ?? [];
    list.push(b);
    byGroup.set(key, list);
  }

  return GROUP_ORDER.filter((k) => byGroup.has(k)).map((key) => {
    const buildings = byGroup.get(key)!.sort((a, b) => a.name.localeCompare(b.name));
    return {
      key,
      label: BUILDING_GROUP_LABELS[key],
      buildings,
      ...buildingTally(buildings),
      uncounted: buildings.filter((b) => !capTrusted(b)).length,
    };
  });
}

/** "3d 4h", "5h 12m", "45m", "under a minute", or "done". Two units at most. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "done";
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3_600);
  const m = Math.floor((seconds % 3_600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return "under a minute";
}
