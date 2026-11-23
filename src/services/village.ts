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
import type { UnitGroup } from "@/data/game";

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
  /**
   * Done of total, to one decimal. Null when nothing could be counted because
   * the data has not caught up with the game (a TH19 base while the data stops
   * at TH18) — never 100, which would call an unmeasured base finished.
   */
  pct: number | null;
  /** Building types whose cap is still to come (ExportedBuilding.capPending). */
  pending: number;
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

function pct(done: number, total: number, pending: number): number | null {
  if (total <= 0) return pending > 0 ? null : 100;
  return Math.floor((done / total) * 1000) / 10;
}

export function buildingTally(buildings: ExportedBuilding[]): BuildingTally {
  let done = 0;
  let total = 0;
  let pending = 0;
  for (const b of buildings) {
    if (b.capPending) pending++;
    if (!capTrusted(b)) continue;
    for (const [level, count] of Object.entries(b.levels)) {
      done += Math.min(Number(level), b.cap) * count;
      total += b.cap * count;
    }
  }
  return { done, total, pct: pct(done, total, pending), pending };
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

/**
 * What an upgrade is upgrading, for its picture. The export's timer row does not
 * say which section it came from, so it is looked up by name: units first, since
 * "Battle Machine" is both a Builder Base hero and the building it stands on, and
 * the hero is the one being upgraded.
 */
export type UpgradeSubject =
  | { type: "unit"; group: UnitGroup }
  | { type: "building"; kind: string }
  | null;

export function upgradeSubject(
  village: ExportedVillage,
  upgrade: Pick<ExportedUpgrade, "name" | "village">,
): UpgradeSubject {
  const unit = village.units.find((u) => u.name === upgrade.name && u.village === upgrade.village);
  if (unit) return { type: "unit", group: unit.group };
  const building = village.buildings.find((b) => b.name === upgrade.name && b.village === upgrade.village);
  if (building) return { type: "building", kind: building.kind };
  return null;
}

/** Who does an upgrade in the game: a builder, the lab, or the pet house. */
export type Workshop = "builders" | "lab" | "pets";

/**
 * Null for what holds no slot: equipment is upgraded at the Blacksmith
 * instantly, and super troops have no levels of their own.
 */
export function workshopOf(subject: UpgradeSubject): Workshop | null {
  if (!subject) return null;
  if (subject.type === "building") return "builders";
  switch (subject.group) {
    case "hero":
    case "builderHero":
    case "guardian":
      return "builders";
    case "pet":
      return "pets";
    case "elixirTroop":
    case "darkTroop":
    case "siege":
    case "elixirSpell":
    case "darkSpell":
    case "builderTroop":
      return "lab";
    default:
      return null;
  }
}

/** The huts whose count is the number of builders, per village. */
const BUILDER_HUTS: Record<Village, string[]> = {
  home: ["Builder's Hut", "B.O.B's Hut"],
  builder: ["Master Builder's Hut", "O.T.T.O's Outpost"],
};

const WORKSHOP_BUILDING: Record<Village, Record<Exclude<Workshop, "builders">, string | null>> = {
  home: { lab: "Laboratory", pets: "Pet House" },
  builder: { lab: "Star Laboratory", pets: null },
};

export interface WorkshopState {
  key: Workshop;
  /** "Builders", "Laboratory", "Pet House" — the game's names. */
  label: string;
  /** Running at `now`. */
  busy: number;
  /** How many there are: huts for builders, 1 for the lab and pet house. */
  total: number;
}

/**
 * Who is busy, the way the game's top bar says it: builders 5/6, the lab, the
 * pet house. Only what this village has: no Pet House row before it is built.
 */
export function workshops(village: ExportedVillage, which: Village, now: Date): WorkshopState[] {
  const has = (name: string) =>
    village.buildings.some((b) => b.village === which && b.name === name && b.count > 0);
  const huts = village.buildings
    .filter((b) => b.village === which && BUILDER_HUTS[which].includes(b.name))
    .reduce((n, b) => n + b.count, 0);

  const busy: Record<Workshop, number> = { builders: 0, lab: 0, pets: 0 };
  for (const u of village.upgrades) {
    if (u.village !== which || secondsLeft(u, now) === 0) continue;
    // A tracked upgrade says who is doing it; an exported one is looked up.
    const w = u.workshop ?? workshopOf(upgradeSubject(village, u));
    if (w) busy[w] += 1;
  }

  const out: WorkshopState[] = [];
  if (huts > 0) out.push({ key: "builders", label: "Builders", busy: busy.builders, total: huts });
  for (const key of ["lab", "pets"] as const) {
    const name = WORKSHOP_BUILDING[which][key];
    if (name && has(name)) out.push({ key, label: name, busy: busy[key], total: 1 });
  }
  return out;
}

export interface WallBreakdown {
  total: number;
  /** This hall's wall cap, or null when the data has none to trust. */
  cap: number | null;
  /** Highest level first. */
  levels: Array<{ level: number; count: number }>;
  atCap: number;
}

/** Every wall piece by level, for one village. Null when the export has none. */
export function wallBreakdown(village: ExportedVillage, which: Village): WallBreakdown | null {
  const rows = village.buildings.filter((b) => b.village === which && b.kind === "Wall");
  if (rows.length === 0) return null;

  const byLevel = new Map<number, number>();
  for (const w of rows) {
    for (const [level, count] of Object.entries(w.levels)) {
      byLevel.set(Number(level), (byLevel.get(Number(level)) ?? 0) + count);
    }
  }
  const levels = [...byLevel.entries()]
    .map(([level, count]) => ({ level, count }))
    .sort((a, b) => b.level - a.level);
  const trusted = rows.find(capTrusted);
  const cap = trusted ? trusted.cap : null;

  return {
    total: levels.reduce((n, l) => n + l.count, 0),
    cap,
    levels,
    atCap: cap === null ? 0 : levels.filter((l) => l.level >= cap).reduce((n, l) => n + l.count, 0),
  };
}

export interface RunningUpgrade {
  name: string;
  village: Village;
  fromLevel: number;
  secondsLeft: number;
  finishesAt: string;
  subject: UpgradeSubject;
}

export interface ExportSummary {
  exportedAt: string;
  /** Whole days since the game took the export. */
  ageDays: number;
  stale: boolean;
  /**
   * Home village buildings against this Town Hall's caps. Null when the game
   * data cannot measure this hall yet (see buildingsPending).
   */
  buildingsPct: number | null;
  /** Home building types whose cap the data does not know yet: TH19 before coc.py has it. */
  buildingsPending: number;
  /** The highest wall level and how many walls are at it, of all walls. */
  walls: { level: number; atLevel: number; total: number } | null;
  /** Still running at `now`, soonest first. */
  running: RunningUpgrade[];
  /** Upgrades that were running at export time and have finished since. */
  finishedSince: number;
  /** Home village builders busy at `now`, of how many. Null when the export has no huts. */
  builders: { busy: number; total: number } | null;
  /**
   * When every builder is busy: the upgrade that frees one first. Null while
   * any builder is free, or when there are no huts. Home says "next builder
   * free in 2h 13m" from this.
   */
  nextBuilderFree: { name: string; secondsLeft: number; finishesAt: string } | null;
  /** The home Laboratory: null when there is none, else when it is free. */
  lab: { busy: boolean; secondsLeft: number; name: string | null } | null;
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
    subject: upgradeSubject(village, u),
  }));
  const states = workshops(village, "home", now);
  const builders = states.find((w) => w.key === "builders");
  const lab = states.find((w) => w.key === "lab");

  // Running home upgrades, soonest first, by who does them. A tracked timer
  // says so itself; an exported one is looked up.
  const running = timed
    .filter((u) => u.village === "home" && u.secondsLeft > 0)
    .map((u) => {
      const own = village.upgrades.find((x) => x.name === u.name && x.village === u.village && x.finishesAt === u.finishesAt);
      return { ...u, workshop: own?.workshop ?? workshopOf(u.subject) };
    })
    .sort((a, b) => a.secondsLeft - b.secondsLeft);
  const firstBuilder = running.find((u) => u.workshop === "builders");
  const firstLab = running.find((u) => u.workshop === "lab");

  return {
    exportedAt: village.exportedAt,
    ageDays,
    stale: ageDays >= STALE_EXPORT_DAYS,
    // The same buildings, and so the same %, as Base details' headline figure.
    ...(({ pct, pending }) => ({ buildingsPct: pct, buildingsPending: pending }))(
      buildingTally(buildingGroups(village, "home").flatMap((g) => g.buildings)),
    ),
    walls,
    running: timed.filter((u) => u.secondsLeft > 0).sort((a, b) => a.secondsLeft - b.secondsLeft),
    finishedSince: (village.appliedSince ?? 0) + timed.filter((u) => u.secondsLeft === 0).length,
    builders: builders ? { busy: builders.busy, total: builders.total } : null,
    nextBuilderFree:
      builders && builders.busy >= builders.total && firstBuilder
        ? { name: firstBuilder.name, secondsLeft: firstBuilder.secondsLeft, finishesAt: firstBuilder.finishesAt }
        : null,
    lab: lab
      ? { busy: lab.busy > 0, secondsLeft: firstLab?.secondsLeft ?? 0, name: firstLab?.name ?? null }
      : null,
  };
}
