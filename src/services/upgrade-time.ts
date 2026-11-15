// What is left to upgrade, added up: resources, and how long it takes with the
// builders a base actually has.
//
// Browser-safe, and deliberately free of the price table. services/upgrades.ts
// (server) builds the items with their prices attached; this file only does
// arithmetic on them, so the tracker can re-total instantly in the browser when
// a member switches the Gold Pass boost.

import type { Price, Resource, SubjectType } from "@/data/game/costs";
import type { UnitGroup } from "@/data/game";
import type { Workshop } from "@/services/village";
import type { Village } from "@/types/domain";

/** The tracker's tabs. Walls and equipment hold no builder: they upgrade instantly. */
export type UpgradeTab = "builders" | "lab" | "pets" | "walls" | "equipment";

export interface PricedStep {
  /** The level this step reaches. */
  level: number;
  cost: Price[];
  /** Walls: the same amount, payable in elixir instead. */
  alt?: Price;
  seconds: number;
}

/** One line of "Upgrades left": every instance of a subject at one level. */
export interface RemainingItem {
  /** Stable across renders: type, village, name and level. */
  key: string;
  subjectType: SubjectType;
  name: string;
  village: Village;
  kind?: string;
  group?: UnitGroup;
  hero?: string;
  tab: UpgradeTab;
  /** Who does it; null when it is instant (walls, equipment). */
  workshop: Workshop | null;
  /** 0 for one not built yet. */
  fromLevel: number;
  cap: number;
  /** Instances at fromLevel that could start now. */
  idle: number;
  /** Instances at fromLevel already upgrading. */
  busy: number;
  action: "upgrade" | "build" | "merge";
  /** A unit this hall allows that has not been unlocked yet. */
  locked?: boolean;
  /** A merge: what it consumes. */
  merge?: Array<{ name: string; n: number; level: number }>;
  /** Why it cannot be started yet, e.g. a merge whose sources are not at the merge level. */
  blocked?: string;
  /** fromLevel + 1 up to cap. null where the data has no price for that level. */
  steps: Array<PricedStep | null>;
}

/** Gold Pass boosts, as the game offers them. */
export const BOOSTS = [0, 10, 15, 20] as const;
export type Boost = (typeof BOOSTS)[number];

export function boosted(seconds: number, pct: number): number {
  return Math.round(seconds * (1 - Math.min(Math.max(pct, 0), 50) / 100));
}

/** Whether the Gold Pass boost applies. Pets are not boosted by it. */
export function boostApplies(workshop: Workshop | null): boolean {
  return workshop === "builders" || workshop === "lab";
}

/** Seconds of one step after the boost that applies to it. */
export function stepSeconds(item: Pick<RemainingItem, "workshop">, step: PricedStep, boostPct: number): number {
  return boostApplies(item.workshop) ? boosted(step.seconds, boostPct) : step.seconds;
}

export interface ItemTotal {
  cost: Partial<Record<Resource, number>>;
  /** Builder or lab time for EVERY instance, one after another. */
  seconds: number;
  unpriced: number;
}

function addCost(into: Partial<Record<Resource, number>>, prices: Price[], times: number): void {
  for (const p of prices) into[p.resource] = (into[p.resource] ?? 0) + p.amount * times;
}

/**
 * Everything one line still costs. A busy instance has already paid for the
 * step it is on, so only the steps after it count.
 */
export function itemTotal(item: RemainingItem, boostPct: number): ItemTotal {
  const total: ItemTotal = { cost: {}, seconds: 0, unpriced: 0 };
  item.steps.forEach((step, i) => {
    const times = item.idle + (i > 0 ? item.busy : 0);
    if (times === 0) return;
    if (!step) {
      total.unpriced += times;
      return;
    }
    addCost(total.cost, step.cost, times);
    total.seconds += stepSeconds(item, step, boostPct) * times;
  });
  return total;
}

/** The next step of one line, or null when it has no price. */
export function nextStep(item: RemainingItem): PricedStep | null {
  return item.steps[0] ?? null;
}

export interface Running {
  builders: number[];
  lab: number[];
  pets: number[];
}

export interface Totals {
  cost: Partial<Record<Resource, number>>;
  unpriced: number;
  /** Seconds until each workshop has nothing left, given what is running now. */
  finish: Record<Workshop, number>;
  /** The longest of the three: when the whole hall is maxed. */
  overall: number;
  /** Upgrades left, counted per instance and step. */
  steps: number;
}

/**
 * Longest-first over N builders, each starting with whatever it is already
 * running. One instance's levels are a chain (Cannon 19 → 20 → 21 cannot run on
 * two builders at once), so each chain is one job. This is the standard
 * approximation; the game's real order is the member's, so the page says "about".
 */
function schedule(jobs: number[], workers: number, loads: number[]): number {
  const n = Math.max(1, workers);
  const busy = Array.from({ length: n }, (_, i) => loads[i] ?? 0);
  for (const job of [...jobs].sort((a, b) => b - a)) {
    let min = 0;
    for (let i = 1; i < n; i++) if (busy[i]! < busy[min]!) min = i;
    busy[min]! += job;
  }
  return Math.max(0, ...busy);
}

export function remainingTotals(
  items: readonly RemainingItem[],
  options: { builders: number; boostPct: number; running: Running },
): Totals {
  const cost: Partial<Record<Resource, number>> = {};
  let unpriced = 0;
  let steps = 0;
  const jobs: Record<Workshop, number[]> = { builders: [], lab: [], pets: [] };

  for (const item of items) {
    const t = itemTotal(item, options.boostPct);
    for (const [r, n] of Object.entries(t.cost)) cost[r as Resource] = (cost[r as Resource] ?? 0) + n!;
    unpriced += t.unpriced;
    steps += item.steps.length * item.idle + Math.max(0, item.steps.length - 1) * item.busy;
    if (!item.workshop) continue;

    const chain = (from: number) =>
      item.steps.slice(from).reduce((s, step) => s + (step ? stepSeconds(item, step, options.boostPct) : 0), 0);
    for (let i = 0; i < item.idle; i++) jobs[item.workshop].push(chain(0));
    for (let i = 0; i < item.busy; i++) jobs[item.workshop].push(chain(1));
  }

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const finish: Record<Workshop, number> = {
    builders: schedule(jobs.builders, options.builders, options.running.builders),
    lab: sum(jobs.lab) + Math.max(0, ...options.running.lab),
    pets: sum(jobs.pets) + Math.max(0, ...options.running.pets),
  };

  return {
    cost,
    unpriced,
    finish,
    overall: Math.max(finish.builders, finish.lab, finish.pets),
    steps,
  };
}

/** "950", "12.5K", "3.4M", "1.25B" — the way the game's shop rounds. */
export function formatAmount(n: number): string {
  // Number() drops trailing zeros: 3.40 → "3.4", 12.0 → "12".
  const trim = (x: number, d: number) => String(Number(x.toFixed(d)));
  if (n >= 1e9) return `${trim(n / 1e9, 2)}B`;
  if (n >= 1e6) return `${trim(n / 1e6, n >= 1e8 ? 0 : 1)}M`;
  if (n >= 1e4) return `${trim(n / 1e3, n >= 1e5 ? 0 : 1)}K`;
  return n.toLocaleString("en-US");
}

/** Longer spans than formatDuration's two units read better as days alone. */
export function formatLong(seconds: number): string {
  if (seconds <= 0) return "nothing left";
  const days = seconds / 86_400;
  if (days >= 10) return `${Math.round(days)} days`;
  const d = Math.floor(days);
  const h = Math.floor((seconds % 86_400) / 3_600);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  const m = Math.floor((seconds % 3_600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`;
}

export type SortKey = "quickest" | "cheapest" | "name";

/** The cost of the next step, in the base resource's units, for "Cheapest". */
function nextAmount(item: RemainingItem): number {
  return nextStep(item)?.cost.reduce((s, p) => s + p.amount, 0) ?? Number.POSITIVE_INFINITY;
}

/**
 * Quickest and cheapest sort what can be STARTED first — a busy line or a
 * locked unit is not a choice right now — then by the next step.
 */
export function sortItems(items: readonly RemainingItem[], by: SortKey, boostPct: number): RemainingItem[] {
  const startable = (i: RemainingItem) => (i.idle > 0 && !i.locked && !i.blocked ? 0 : 1);
  const time = (i: RemainingItem) => {
    const s = nextStep(i);
    return s ? stepSeconds(i, s, boostPct) : Number.POSITIVE_INFINITY;
  };
  return [...items].sort((a, b) => {
    if (by === "name") return a.name.localeCompare(b.name) || a.fromLevel - b.fromLevel;
    const first = startable(a) - startable(b);
    if (first !== 0) return first;
    const diff = by === "quickest" ? time(a) - time(b) : nextAmount(a) - nextAmount(b);
    return diff || a.name.localeCompare(b.name);
  });
}
