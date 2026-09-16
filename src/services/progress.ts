// T11B.7 — how far along a village is, as pure functions.
//
// Input is the `units` array of one player_progress row (036): every unit with
// its group and the Town Hall / Builder Hall cap that applied when it was
// captured. Nothing here reads a database or the clock.
//
// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS IS LEVELS AGAINST CAPS, SUMMED — NOT "UNITS MAXED"
//
// A group's figure is (sum of levels) / (sum of caps). Counting maxed units
// instead would score a King one level short the same as a King forty levels
// short, which is not the question a member is asking. Levels are the closest
// thing the API offers to effort; clash.ninja weighs by upgrade time, which the
// API does not give us and src/data/game/ does not carry.
//
// Percentages are FLOORED to one decimal, so 99.96% is shown as 99.9% and "100%"
// only ever means everything is capped.
//
// ─────────────────────────────────────────────────────────────────────────────
// "RUSHED" IS A BREAKDOWN, NEVER A VERDICT
//
// needsAttention() in members.ts sets the rule: advisory only, and never
// automate a decision about a person. "Rushed" is a word members throw at each
// other, so the page shows WHICH units are below the previous Town Hall's cap,
// grouped, and leaves the word out.

import {
  GROUP_LABELS,
  GROUP_ORDER,
  capAt,
  findUnit,
  type ResolvedUnit,
  type UnitGroup,
} from "@/data/game";
import type { Village } from "@/types/domain";

export type StoredUnit = ResolvedUnit;

export interface Tally {
  done: number;
  total: number;
  /** 0–100, floored to one decimal place. 100 when there is nothing to count. */
  pct: number;
}

export interface GroupProgress extends Tally {
  group: UnitGroup;
  label: string;
  /** Every unit of the group, counted or not, in display order. */
  units: StoredUnit[];
  maxed: number;
  /** Units whose cap is the game maximum because the hall cap was unknown. */
  capUnknown: number;
}

/**
 * Whether a unit counts towards a total.
 *
 * Super troops do not: a Super Barbarian's level IS the Barbarian's level, so
 * counting both scores the same upgrade twice. A cap of 0 means the unit is not
 * available at this hall and has nothing to be behind on.
 */
export function counts(unit: StoredUnit): boolean {
  return unit.group !== "superTroop" && unit.cap > 0;
}

function floorPct(done: number, total: number): number {
  if (total <= 0) return 100;
  return Math.floor((done / total) * 1000) / 10;
}

export function tally(units: StoredUnit[]): Tally {
  let done = 0;
  let total = 0;
  for (const unit of units) {
    if (!counts(unit)) continue;
    // Clamped: a level above its cap (stale game data) must not push a group
    // past 100%, and resolveUnit() already fell back to the game maximum there.
    done += Math.min(unit.level, unit.cap);
    total += unit.cap;
  }
  return { done, total, pct: floorPct(done, total) };
}

const byName = (a: StoredUnit, b: StoredUnit) => a.name.localeCompare(b.name);

/** Per-group progress for one village, in GROUP_ORDER, omitting empty groups. */
export function groupProgress(units: StoredUnit[], village: Village): GroupProgress[] {
  const groups: GroupProgress[] = [];

  for (const group of GROUP_ORDER) {
    const members = units.filter((u) => u.village === village && u.group === group);
    if (!members.length) continue;

    // Equipment is listed by hero, then name, so a hero's kit reads together.
    members.sort((a, b) =>
      group === "equipment"
        ? (a.hero ?? "").localeCompare(b.hero ?? "") || byName(a, b)
        : 0,
    );

    groups.push({
      group,
      label: GROUP_LABELS[group],
      units: members,
      ...tally(members),
      maxed: members.filter((u) => counts(u) && u.level >= u.cap).length,
      capUnknown: members.filter((u) => counts(u) && !u.capKnown).length,
    });
  }
  return groups;
}

/** One figure for a whole village. */
export function overallProgress(units: StoredUnit[], village: Village): Tally {
  return tally(units.filter((u) => u.village === village));
}

export interface BehindUnit {
  name: string;
  level: number;
  /** The cap at the PREVIOUS hall level — the level this unit "should" already be. */
  previousCap: number;
}

export interface BehindGroup {
  group: UnitGroup;
  label: string;
  units: BehindUnit[];
}

/**
 * Units below the previous hall's cap, grouped — the clash.ninja definition of
 * a rushed unit, without the word.
 *
 * The previous cap comes from TODAY's game data, not from the stored row, so
 * this is meant for the latest reading only. A hall-1 village has no previous
 * hall and nothing can be behind.
 */
export function behindPreviousHall(
  units: StoredUnit[],
  village: Village,
  hall: number | undefined,
): BehindGroup[] {
  if (!hall || hall < 2) return [];

  const behind = new Map<UnitGroup, BehindUnit[]>();
  for (const unit of units) {
    if (unit.village !== village || !counts(unit)) continue;
    if (unit.group === "equipment") continue; // acquired, not unlocked — see lockedUnits()

    const data = findUnit(unit.name, unit.village);
    const previousCap = data ? capAt(data.caps, hall - 1) : undefined;
    if (!previousCap || unit.level >= previousCap) continue;

    const list = behind.get(unit.group) ?? [];
    list.push({ name: unit.name, level: unit.level, previousCap });
    behind.set(unit.group, list);
  }

  return GROUP_ORDER.filter((g) => behind.has(g)).map((group) => ({
    group,
    label: GROUP_LABELS[group],
    units: behind.get(group)!.sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

export interface Upgrade {
  name: string;
  village: Village;
  group: UnitGroup;
  from: number;
  to: number;
}

/**
 * What went up between two readings, in display order.
 *
 * Keyed by village AND name — Baby Dragon exists in both villages, and keying by
 * name alone would report one village's upgrade against the other's level. A
 * unit absent from the older reading counts as coming from 0, which is what a
 * newly unlocked troop is.
 */
export function upgradesBetween(older: StoredUnit[], newer: StoredUnit[]): Upgrade[] {
  const before = new Map(older.map((u) => [`${u.village}:${u.name}`, u.level]));
  const upgrades: Upgrade[] = [];

  for (const unit of newer) {
    if (unit.group === "superTroop") continue;
    const from = before.get(`${unit.village}:${unit.name}`) ?? 0;
    if (unit.level > from) {
      upgrades.push({
        name: unit.name,
        village: unit.village,
        group: unit.group,
        from,
        to: unit.level,
      });
    }
  }

  const rank = (g: UnitGroup) => GROUP_ORDER.indexOf(g);
  return upgrades.sort(
    (a, b) => rank(a.group) - rank(b.group) || a.name.localeCompare(b.name),
  );
}
