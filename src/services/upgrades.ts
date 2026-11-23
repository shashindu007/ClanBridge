// "Upgrades left" — every upgrade a base still has for its hall, with prices.
//
// SERVER ONLY: it reads the price table (src/data/game/costs.ts). Base details
// calls it after the overlay, so a level that finished a minute ago is already
// gone from the list, and hands the browser plain items.
//
// WHAT COUNTS AS "LEFT", AND WHAT DOES NOT
//
//   - Every instance below this hall's cap, one line per subject and level:
//     "Cannon 19 → 20 ×3" and "Cannon 20 → 21 ×4" are two lines, because they
//     are two different jobs with different prices.
//   - Buildings this hall allows that are not built yet, from the per-hall
//     counts in buildings.json, after merges: two Cannons that became a
//     Ricochet Cannon are not "missing".
//   - Merges still to do ("Merge 2 × Archer Tower"), and units the hall allows
//     that are not unlocked yet.
//   - The Town Hall weapon, when the export says what level it is.
//
//   NOT the halls themselves (the yardstick everything else is measured
//   against), super troops (their level is the base troop's), traps that are
//   not built (the data has no trap counts), and anything above the data's cap,
//   which can only mean the data is behind the game.

import {
  buildingByName,
  buildingsOf,
  capAt,
  countAt,
  lockedUnits,
  townHallWeaponCap,
  type GameBuilding,
} from "@/data/game";
import { upgradeStep, weaponAt, type SubjectType } from "@/data/game/costs";
import {
  highestLevel,
  secondsLeft,
  upgradeSubject,
  workshopOf,
  type Workshop,
} from "@/services/village";
import type { PricedStep, RemainingItem, Running, UpgradeTab } from "@/services/upgrade-time";
import type { Village } from "@/types/domain";
import type { ExportedVillage } from "@/types/village";

/** Never measured against a hall: they ARE the hall. */
const HALL_KINDS = new Set(["Town Hall", "Town Hall2"]);
/** Bought with gems or given, never "missing" from a base. */
const NOT_COUNTED_KINDS = new Set(["Worker", "Worker2", "Helper", "trap"]);

function steps(type: SubjectType, name: string, village: Village, from: number, cap: number): Array<PricedStep | null> {
  const out: Array<PricedStep | null> = [];
  // A unit's level 1 comes with the building that unlocks it, so its first
  // priced step is level 2 even when the unit is not unlocked yet.
  const first = type === "unit" ? Math.max(from, 1) + 1 : from + 1;
  for (let level = first; level <= cap; level++) out.push(upgradeStep(type, name, village, level));
  // Builder Base troops unlocked late START at a high level (a Hog Glider is
  // level 15 when it arrives), so the levels below that are not steps at all.
  if (type === "unit" && from <= 1) {
    const start = out.findIndex((s) => s !== null);
    return start > 0 ? out.slice(start) : out;
  }
  return out;
}

const keyOf = (type: SubjectType, village: Village, name: string, from: number) =>
  `${type}:${village}:${name}:${from}`;

/** How many timers are running at `now`, by subject and from-level. */
function runningAt(village: ExportedVillage, which: Village, now: Date): Map<string, number> {
  const out = new Map<string, number>();
  for (const u of village.upgrades) {
    if (u.village !== which || secondsLeft(u, now) === 0) continue;
    const k = `${u.name}:${u.fromLevel}`;
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

function unitTab(workshop: Workshop | null, group: string): UpgradeTab {
  if (group === "equipment") return "equipment";
  return workshop ?? "lab";
}

export function remainingUpgrades(village: ExportedVillage, which: Village, now: Date): RemainingItem[] {
  const hall = (which === "home" ? village.thLevel : village.bhLevel) ?? undefined;
  if (!hall) return [];

  const items: RemainingItem[] = [];
  const running = runningAt(village, which, now);
  const busyAt = (name: string, level: number) => running.get(`${name}:${level}`) ?? 0;

  // ── Buildings the base has ───────────────────────────────────────────────
  const have = new Map<string, number>();
  for (const b of village.buildings) {
    if (b.village !== which) continue;
    have.set(b.name, (have.get(b.name) ?? 0) + b.count);
    if (HALL_KINDS.has(b.kind)) continue;

    // The data's cap, not the one saved with the export, which may be from
    // older data. null/undefined from the data is "not known yet" (TH19 before
    // coc.py has it): left out here, and counted by pendingCount() instead —
    // never the saved cap, and never treated as maxed.
    const data = buildingByName(b.name, which);
    const cap = data ? capAt(data.caps, hall) : b.capPending ? null : b.cap;
    if (!cap || highestLevel(b) > cap) continue;
    const wall = b.kind === "Wall";

    for (const [lvl, n] of Object.entries(b.levels)) {
      const level = Number(lvl);
      if (level >= cap || n <= 0) continue;
      const busy = Math.min(n, busyAt(b.name, level));
      items.push({
        key: keyOf("building", which, b.name, level),
        subjectType: "building",
        name: b.name,
        village: which,
        kind: b.kind,
        tab: wall ? "walls" : "builders",
        workshop: wall ? null : "builders",
        fromLevel: level,
        cap,
        idle: n - busy,
        busy,
        action: "upgrade",
        steps: steps("building", b.name, which, level, cap),
      });
    }
  }

  // ── Buildings this hall allows that are not built, after merges ──────────
  const all = buildingsOf(which);
  const merged = all.filter((m) => m.merge);
  // How many of `name` the merged buildings this base has were made from —
  // all the way down, so a merge of a merge still accounts for the Cannons
  // its parts were made of.
  const consumed = (name: string, seen: ReadonlySet<string> = new Set()): number =>
    merged.reduce((n, m) => {
      const per = m.merge!.find((x) => x.name === name)?.n ?? 0;
      if (per === 0 || seen.has(m.name)) return n;
      const made = (have.get(m.name) ?? 0) + consumed(m.name, new Set([...seen, name]));
      return n + made * per;
    }, 0);
  // Sources at their merge level, shared by every merge on the list: two
  // merges that both take level-21 Cannons (Ricochet Cannon, Multi-Gear Tower)
  // cannot both be offered the same Cannons.
  const pool = new Map<string, number>();
  const poolOf = (name: string, level: number) => {
    const key = `${name}:${level}`;
    if (!pool.has(key)) pool.set(key, readyAt(village, which, name, level, now));
    return key;
  };
  for (const data of all) {
    if (HALL_KINDS.has(data.kind) || NOT_COUNTED_KINDS.has(data.kind)) continue;
    const expected = countAt(data, hall) ?? 0;
    const cap = capAt(data.caps, hall) ?? 0;
    if (expected <= 0 || cap <= 0) continue;

    const missing = expected - (have.get(data.name) ?? 0) - consumed(data.name);
    if (missing <= 0) continue;
    const busy = Math.min(missing, busyAt(data.name, 0));
    const item = missingItem(data, which, cap, missing - busy, busy);

    // A merge needs its sources AT the merge level, as the game does: two
    // Cannons at 21 for a Ricochet Cannon. Merges already running have not
    // consumed theirs yet (that happens when they finish), so they are set aside.
    if (data.merge) {
      // Merges already running have not consumed their sources yet.
      for (const m of data.merge) {
        const key = poolOf(m.name, m.level);
        pool.set(key, Math.max(0, pool.get(key)! - busy * m.n));
      }
      const ready = Math.min(
        missing - busy,
        ...data.merge.map((m) => Math.floor(pool.get(poolOf(m.name, m.level))! / m.n)),
      );
      for (const m of data.merge) {
        const key = poolOf(m.name, m.level);
        pool.set(key, pool.get(key)! - ready * m.n);
      }
      item.ready = Math.max(0, ready);
      if (ready < 1) {
        item.blocked = `Needs ${data.merge.map((m) => `${m.n} × ${m.name} at level ${m.level}`).join(" and ")}`;
      }
    }
    items.push(item);
  }

  // ── The Town Hall weapon ──────────────────────────────────────────────────
  const weaponCap = which === "home" ? townHallWeaponCap(hall) : null;
  const weapon = which === "home" ? weaponAt(hall) : null;
  const weaponLevel = village.thWeapon;
  if (weaponCap && weapon && typeof weaponLevel === "number" && weaponLevel < weaponCap) {
    const busy = Math.min(1, busyAt(weapon, weaponLevel));
    items.push({
      key: keyOf("weapon", which, weapon, weaponLevel),
      subjectType: "weapon",
      name: weapon,
      village: which,
      kind: "Town Hall",
      tab: "builders",
      workshop: "builders",
      fromLevel: weaponLevel,
      cap: weaponCap,
      idle: 1 - busy,
      busy,
      action: "upgrade",
      steps: steps("weapon", weapon, which, weaponLevel, weaponCap),
    });
  }

  // ── Units: heroes, troops, spells, pets, equipment ───────────────────────
  const present = village.units.filter((u) => u.village === which);
  const locked = lockedUnits(present, village.thLevel ?? undefined, village.bhLevel ?? undefined).filter(
    (u) => u.village === which,
  );
  for (const u of [...present, ...locked]) {
    if (u.group === "superTroop" || !u.capKnown || u.level >= u.cap) continue;
    const workshop = workshopOf({ type: "unit", group: u.group });
    const isLocked = u.level === 0;
    const busy = isLocked ? 0 : Math.min(1, busyAt(u.name, u.level));
    items.push({
      key: keyOf("unit", which, u.name, u.level),
      subjectType: "unit",
      name: u.name,
      village: which,
      group: u.group,
      ...(u.hero ? { hero: u.hero } : {}),
      tab: unitTab(workshop, u.group),
      workshop,
      fromLevel: u.level,
      cap: u.cap,
      idle: 1 - busy,
      busy,
      action: "upgrade",
      ...(isLocked ? { locked: true } : {}),
      steps: steps("unit", u.name, which, u.level, u.cap),
    });
  }

  return items;
}

/** Instances of a building at `level` or above that are not upgrading right now. */
function readyAt(village: ExportedVillage, which: Village, name: string, level: number, now: Date): number {
  const b = village.buildings.find((x) => x.name === name && x.village === which);
  if (!b) return 0;
  const atLevel = Object.entries(b.levels).reduce((n, [l, c]) => (Number(l) >= level ? n + c : n), 0);
  const upgrading = village.upgrades.filter(
    (u) => u.name === name && u.village === which && u.fromLevel >= level && secondsLeft(u, now) > 0,
  ).length;
  return Math.max(0, atLevel - upgrading);
}

function missingItem(data: GameBuilding, which: Village, cap: number, idle: number, busy: number): RemainingItem {
  const wall = data.kind === "Wall";
  return {
    key: keyOf("building", which, data.name, 0),
    subjectType: "building",
    name: data.name,
    village: which,
    kind: data.kind,
    tab: wall ? "walls" : "builders",
    workshop: wall ? null : "builders",
    fromLevel: 0,
    cap,
    idle,
    busy,
    action: data.merge ? "merge" : "build",
    ...(data.merge ? { merge: data.merge } : {}),
    steps: steps("building", data.name, which, 0, cap),
  };
}

/**
 * How many things in this village the tracker cannot list because the game
 * data has not caught up: buildings whose cap at this hall is unknown (TH19
 * while coc.py stops at TH18) and units newer than, or above, the data. When
 * this is above zero, an empty list does NOT mean the base is maxed.
 *
 * Base details works it out on the server beside remainingUpgrades() and
 * hands the number to the tracker.
 */
export function pendingCount(village: ExportedVillage, which: Village): number {
  const buildings = village.buildings.filter(
    (b) => b.village === which && b.capPending && !HALL_KINDS.has(b.kind),
  ).length;
  const units = village.units.filter(
    (u) => u.village === which && u.group !== "superTroop" && !u.capKnown && u.level > 0,
  ).length;
  return buildings + units;
}

/** Seconds left on every running timer, per workshop — the scheduler's starting load. */
export function runningLoads(village: ExportedVillage, which: Village, now: Date): Running {
  const out: Running = { builders: [], lab: [], pets: [] };
  for (const u of village.upgrades) {
    if (u.village !== which) continue;
    const left = secondsLeft(u, now);
    if (left === 0) continue;
    const w = u.workshop ?? workshopOf(upgradeSubject(village, u));
    if (w) out[w].push(left);
  }
  return out;
}
