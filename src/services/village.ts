// T11B.11 — arithmetic over a village export. Pure, and browser-safe: the
// export views run it client-side, Home and Base details on the server.
//
// Units from an export go through services/progress.ts unchanged — they carry
// the same ResolvedUnit shape the sync job stores. This file is only what the
// API never had: buildings, walls, traps and running timers.
//
// Same rule as progress.ts: levels against caps, summed per INSTANCE. Two cannons
// at 20 of 21 are 40 of 42, not "two unmaxed cannons". Walls are counted the
// same way, which is why a TH upgrade makes the wall bar drop sharply — that is
// accurate, and every tracker shows it.

import type { ExportedBuilding, ExportedUpgrade, ExportedVillage } from "@/types/village";
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

// ─────────────────────────────────────────────────────────────────────────────
// A SAVED export (076), read days after it was taken.
//
// An upgrade's remainingSeconds was true when the export was parsed and is
// wrong by the next page load. finishesAt is absolute, so time left is always
// worked out from it here — never read from storage.
// ─────────────────────────────────────────────────────────────────────────────

/** Older than this, Home asks for a fresh export. */
export const STALE_EXPORT_DAYS = 7;

/** Seconds left on one upgrade at `now`, from its absolute finish time. */
export function secondsLeft(upgrade: Pick<ExportedUpgrade, "finishesAt">, now: Date): number {
  const ms = Date.parse(upgrade.finishesAt) - now.getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : 0;
}

export interface RunningUpgrade {
  name: string;
  village: Village;
  fromLevel: number;
  secondsLeft: number;
  finishesAt: string;
}

export interface ExportSummary {
  exportedAt: string;
  /** Whole days since the game took the export. */
  ageDays: number;
  stale: boolean;
  /** Home village buildings against this Town Hall's caps. */
  buildingsPct: number;
  /** The highest wall level and how many walls are at it, of all walls. */
  walls: { level: number; atLevel: number; total: number } | null;
  /** Still running at `now`, soonest first. */
  running: RunningUpgrade[];
  /** Upgrades that were running at export time and have finished since. */
  finishedSince: number;
}

export function exportSummary(village: ExportedVillage, now: Date): ExportSummary {
  const ageMs = Math.max(0, now.getTime() - Date.parse(village.exportedAt));
  const ageDays = Number.isFinite(ageMs) ? Math.floor(ageMs / 86_400_000) : 0;

  const home = village.buildings.filter((b) => b.village === "home");
  const wallRows = home.filter((b) => b.kind === "Wall");
  let walls: ExportSummary["walls"] = null;
  if (wallRows.length > 0) {
    const levels = new Map<number, number>();
    for (const w of wallRows) {
      for (const [level, count] of Object.entries(w.levels)) {
        levels.set(Number(level), (levels.get(Number(level)) ?? 0) + count);
      }
    }
    const top = Math.max(...levels.keys());
    walls = {
      level: top,
      atLevel: levels.get(top) ?? 0,
      total: [...levels.values()].reduce((sum, n) => sum + n, 0),
    };
  }

  const timed = village.upgrades.map((u) => ({
    name: u.name,
    village: u.village,
    fromLevel: u.fromLevel,
    secondsLeft: secondsLeft(u, now),
    finishesAt: u.finishesAt,
  }));

  return {
    exportedAt: village.exportedAt,
    ageDays,
    stale: ageDays >= STALE_EXPORT_DAYS,
    // The same buildings, and so the same %, as Base details' headline figure.
    buildingsPct: buildingTally(buildingGroups(village, "home").flatMap((g) => g.buildings)).pct,
    walls,
    running: timed.filter((u) => u.secondsLeft > 0).sort((a, b) => a.secondsLeft - b.secondsLeft),
    finishedSince: timed.filter((u) => u.secondsLeft === 0).length,
  };
}
