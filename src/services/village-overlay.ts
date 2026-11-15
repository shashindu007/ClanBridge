// The upgrade tracker's overlay: a saved export (076) plus the timers a member
// started here (079), as the village stands NOW.
//
// Pure and browser-safe. Every page that shows an export runs its village
// through applyTracked() first, so a level goes up the moment its timer ends —
// whether the timer came from the export itself or from "Start" on Base
// details — without anything being written. The rest of the code (the banner,
// workshops(), exportSummary(), Home's card) reads the result as an ordinary
// ExportedVillage and never needs to know an overlay happened.
//
// TWO VILLAGES COME BACK, AND THE DIFFERENCE MATTERS
//
//   village   what the page shows: finished upgrades applied, and the running
//             tracked ones added as timers.
//   stored    finished upgrades applied, and nothing else. This is what a fold
//             writes back to the export (079's apply_tracked_upgrades), so the
//             export never holds a tracked timer — a tracked row is the only
//             record of one, and the export is never asked to agree with it.
//
// A TRACKED ROW THE EXPORT CONTRADICTS IS DROPPED, NOT FORCED. "Cannon 19 → 20"
// with no Cannon left at 19 means a fresh export or another tracked row has
// already moved it, so applying it would invent a level. Those rows come back in
// `ignored`, and the next fold retires them.

import { buildingByName, capAt } from "@/data/game";
import { secondsLeft, upgradeSubject, type Workshop } from "@/services/village";
import type { Village } from "@/types/domain";
import type { ExportedBuilding, ExportedUpgrade, ExportedVillage } from "@/types/village";

export type SubjectType = "building" | "unit" | "weapon";

/** A tracked_upgrades row, as the repository maps it. */
export interface TrackedUpgrade {
  id: string;
  village: Village;
  subjectType: SubjectType;
  subject: string;
  fromLevel: number;
  workshop: Workshop;
  boostPct: number;
  startedAt: string;
  endsAt: string;
}

export interface LevelUp {
  name: string;
  village: Village;
  toLevel: number;
  source: "export" | "tracked";
}

export interface Overlay {
  village: ExportedVillage;
  stored: ExportedVillage;
  /** Tracked rows that are finished — applied or contradicted — and can be folded. */
  foldIds: string[];
  levelledUp: LevelUp[];
  ignored: string[];
  /** Whether `stored` differs from the export as saved, i.e. a fold would change it. */
  changed: boolean;
}

function newBuilding(name: string, village: Village, hall: number | null): ExportedBuilding | null {
  const data = buildingByName(name, village);
  if (!data) return null;
  return {
    name,
    village,
    kind: data.kind,
    cap: capAt(data.caps, hall ?? undefined) || null,
    count: 0,
    levels: {},
    upgrading: 0,
    geared: 0,
    supercharged: 0,
  };
}

function take(b: ExportedBuilding, level: number, n = 1): void {
  const left = (b.levels[level] ?? 0) - n;
  if (left > 0) b.levels[level] = left;
  else delete b.levels[level];
}

function give(b: ExportedBuilding, level: number, n = 1): void {
  b.levels[level] = (b.levels[level] ?? 0) + n;
}

/** Whether there is an instance at `fromLevel` for this upgrade to start from. */
function hasInstance(v: ExportedVillage, t: Pick<TrackedUpgrade, "village" | "subjectType" | "subject" | "fromLevel">): boolean {
  if (t.subjectType === "weapon") return t.village === "home" && (v.thWeapon ?? null) === t.fromLevel;
  if (t.subjectType === "unit") {
    return v.units.some((u) => u.name === t.subject && u.village === t.village && u.level === t.fromLevel);
  }
  if (t.fromLevel === 0) return true; // building a new one
  const b = v.buildings.find((x) => x.name === t.subject && x.village === t.village);
  return (b?.levels[t.fromLevel] ?? 0) > 0;
}

/**
 * Move one instance up a level. Building from 0 adds one, and a merged building
 * (a Ricochet Cannon) consumes what it is made of, highest levels first.
 */
function levelUp(v: ExportedVillage, t: Pick<TrackedUpgrade, "village" | "subjectType" | "subject" | "fromLevel">): void {
  const hall = t.village === "home" ? v.thLevel : v.bhLevel;

  if (t.subjectType === "weapon") {
    v.thWeapon = t.fromLevel + 1;
    return;
  }
  if (t.subjectType === "unit") {
    const unit = v.units.find((u) => u.name === t.subject && u.village === t.village && u.level === t.fromLevel);
    if (unit) unit.level = t.fromLevel + 1;
    return;
  }

  let b = v.buildings.find((x) => x.name === t.subject && x.village === t.village);
  if (!b) {
    const fresh = newBuilding(t.subject, t.village, hall);
    if (!fresh) return;
    v.buildings.push(fresh);
    b = fresh;
  }

  if (t.fromLevel === 0) {
    b.count += 1;
    for (const m of buildingByName(t.subject, t.village)?.merge ?? []) {
      const source = v.buildings.find((x) => x.name === m.name && x.village === t.village);
      if (!source) continue;
      for (let i = 0; i < m.n; i++) {
        const top = Math.max(-1, ...Object.keys(source.levels).map(Number));
        if (top < 0) break;
        take(source, top);
        source.count = Math.max(0, source.count - 1);
      }
    }
  } else {
    take(b, t.fromLevel);
  }
  give(b, t.fromLevel + 1);
}

/**
 * "Already upgraded": move `count` instances up one level now, with no timer —
 * walls and equipment, which the game upgrades instantly, or anything the
 * member upgraded without starting a timer here. Returns a new village, or null
 * when there are not that many instances at `fromLevel`.
 */
export function markUpgraded(
  village: ExportedVillage,
  subject: Pick<TrackedUpgrade, "village" | "subjectType" | "subject" | "fromLevel">,
  count: number,
): ExportedVillage | null {
  const next = structuredClone(village);
  for (let i = 0; i < count; i++) {
    if (!hasInstance(next, subject)) return null;
    levelUp(next, subject);
  }
  next.appliedSince = (next.appliedSince ?? 0) + count;
  return next;
}

export function applyTracked(
  village: ExportedVillage,
  tracked: readonly TrackedUpgrade[],
  now: Date,
): Overlay {
  const stored = structuredClone(village);
  const levelledUp: LevelUp[] = [];
  const foldIds: string[] = [];
  const ignored: string[] = [];
  let applied = 0;

  // ── The export's own timers that have run out since it was taken ──────────
  const keep: ExportedUpgrade[] = [];
  for (const u of stored.upgrades) {
    const subject = secondsLeft(u, now) === 0 ? upgradeSubject(stored, u) : null;
    if (!subject) {
      keep.push(u); // still running, or unknown to the data: left as the export had it
      continue;
    }
    const t = { village: u.village, subjectType: subject.type, subject: u.name, fromLevel: u.fromLevel };
    if (!hasInstance(stored, t)) {
      keep.push(u);
      continue;
    }
    levelUp(stored, t);
    if (subject.type === "building") {
      const b = stored.buildings.find((x) => x.name === u.name && x.village === u.village);
      if (b) b.upgrading = Math.max(0, b.upgrading - 1);
    }
    levelledUp.push({ name: u.name, village: u.village, toLevel: u.fromLevel + 1, source: "export" });
    applied++;
  }
  stored.upgrades = keep;

  // ── Tracked rows, oldest finish first so chained levels apply in order ────
  const ordered = [...tracked].sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt));
  const running: TrackedUpgrade[] = [];
  for (const t of ordered) {
    const done = Date.parse(t.endsAt) <= now.getTime();
    if (!done) {
      running.push(t);
      continue;
    }
    foldIds.push(t.id);
    if (!hasInstance(stored, t)) {
      ignored.push(t.id);
      continue;
    }
    levelUp(stored, t);
    levelledUp.push({ name: t.subject, village: t.village, toLevel: t.fromLevel + 1, source: "tracked" });
    applied++;
  }
  stored.appliedSince = (village.appliedSince ?? 0) + applied;

  // ── What the page shows: stored, plus the timers still running ────────────
  const shown = structuredClone(stored);
  for (const t of running) {
    if (!hasInstance(shown, t)) {
      ignored.push(t.id);
      foldIds.push(t.id);
      continue;
    }
    shown.upgrades.push({
      name: t.subject,
      village: t.village,
      fromLevel: t.fromLevel,
      remainingSeconds: Math.max(0, Math.round((Date.parse(t.endsAt) - now.getTime()) / 1000)),
      finishesAt: t.endsAt,
      source: "tracked",
      trackedId: t.id,
      startedAt: t.startedAt,
      workshop: t.workshop,
    });
    const b =
      t.subjectType === "building"
        ? shown.buildings.find((x) => x.name === t.subject && x.village === t.village)
        : undefined;
    if (b && t.fromLevel > 0) b.upgrading += 1;
  }
  shown.upgrades.sort((a, b) => Date.parse(a.finishesAt) - Date.parse(b.finishesAt));

  return { village: shown, stored, foldIds, levelledUp, ignored, changed: applied > 0 || foldIds.length > 0 };
}
