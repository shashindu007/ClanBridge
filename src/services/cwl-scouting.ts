// 057 — scouting the other clans of a CWL group, as pure functions.
//
// Three inputs, all written by the sync and read per season:
//
//   roster     who each clan registered for the week, with Town Halls
//   lineups    who each clan actually fielded each day, and the one attack each
//              of them made
//   villages   how far each enemy village is towards ITS Town Hall's caps
//
// From those: the Town Hall mix, how the clan attacks and defends, and the
// players worth a closer look — the weak points a war plan is built around.
//
// ─────────────────────────────────────────────────────────────────────────────
// WEAK POINTS ARE OBSERVATIONS, NOT VERDICTS
//
// services/progress.ts sets the house rule: "rushed" is a word players throw
// at each other, so the page states WHAT is behind and leaves the word out.
// These are about another clan's players, and the rule holds all the same —
// every flag below names the number it is based on.

import type { GroupWar } from "@/repositories/cwl";
import { byWarOrder, lineupBreakdown, type LineupBreakdown } from "@/lib/roster-view";
import type { HeroLevel } from "@/services/progress";

export interface ScoutRosterMember {
  clanTag: string;
  tag: string;
  name: string | null;
  thLevel: number | null;
}

export interface ScoutWarMember {
  warTag: string;
  clanTag: string;
  tag: string;
  name: string | null;
  thLevel: number | null;
  mapPosition: number | null;
  attackStars: number | null;
  attackDestruction: number | null;
  attackDefenderTag: string | null;
}

export interface ScoutVillage {
  clanTag: string;
  tag: string;
  name: string | null;
  thLevel: number | null;
  heroes: HeroLevel[];
  heroPct: number | null;
  petPct: number | null;
  equipmentPct: number | null;
  offencePct: number | null;
  maxPct: number | null;
  warStars: number | null;
  capturedAt: string;
}

export interface ScoutSeason {
  roster: ScoutRosterMember[];
  lineups: ScoutWarMember[];
  villages: ScoutVillage[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Thresholds. Named, so the page can say what a flag means.
// ─────────────────────────────────────────────────────────────────────────────

/** Heroes below this share of their Town Hall's max are flagged. */
export const HERO_PCT_FLAG = 85;
/** An attacker averaging this many stars or fewer, over at least two attacks. */
export const LOW_STARS_FLAG = 1.5;
/** A base 3-starred at least this often. */
export const TRIPLED_FLAG = 2;
/** Town Halls below the top of the clan's fielded lineup. */
export const TH_GAP_FLAG = 2;

export type WeakPointKind = "heroes" | "missed" | "lowStars" | "tripled" | "lowTh";

export interface WeakPoint {
  kind: WeakPointKind;
  label: string;
}

export interface ScoutedPlayer {
  tag: string;
  name: string;
  thLevel: number | null;
  heroes: HeroLevel[];
  heroPct: number | null;
  petPct: number | null;
  equipmentPct: number | null;
  offencePct: number | null;
  maxPct: number | null;
  warStars: number | null;
  /** Read by the scout at least once this season. */
  scouted: boolean;
  /** Days in a lineup that has started (battle day or over). */
  daysFielded: number;
  attacks: number;
  /** Ended days in the lineup without an attack. A live day is not a miss yet. */
  missed: number;
  stars: number;
  threeStars: number;
  avgStars: number | null;
  avgDestruction: number | null;
  /** Times their base was attacked, and 3-starred. */
  defences: number;
  tripled: number;
  /** Stars per started day, by day number — null where they were not fielded. */
  byDay: Array<{ day: number; stars: number | null; fielded: boolean }>;
  flags: WeakPoint[];
}

export interface ClanScout {
  clanTag: string;
  /** Everyone registered, by Town Hall. */
  roster: LineupBreakdown;
  /** Everyone who has been in a started lineup, by Town Hall. */
  fielded: LineupBreakdown;
  scouted: number;
  avgHeroPct: number | null;
  avgPetPct: number | null;
  avgEquipmentPct: number | null;
  /** The newest village reading for this clan. */
  capturedAt: string | null;
  attacks: number;
  missed: number;
  threeStars: number;
  /** Share of attacks that took three stars, 0–100; null before the first. */
  threeStarRate: number | null;
  avgStars: number | null;
  avgDestruction: number | null;
  defences: number;
  tripledAgainst: number;
  /** Registered players, strongest base first. */
  players: ScoutedPlayer[];
  /** Players with at least one flag, most flags first. */
  weakPoints: ScoutedPlayer[];
}

const STARTED = new Set(["inWar", "warEnded"]);

function average(values: Array<number | null | undefined>): number | null {
  const known = values.filter((v): v is number => typeof v === "number");
  return known.length ? known.reduce((t, v) => t + v, 0) / known.length : null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The flags for one player. Pure; exported for the test. */
export function weakPointsFor(
  p: Pick<
    ScoutedPlayer,
    "thLevel" | "heroPct" | "missed" | "attacks" | "avgStars" | "defences" | "tripled" | "daysFielded"
  >,
  topFieldedTh: number | null,
): WeakPoint[] {
  const flags: WeakPoint[] = [];
  if (p.heroPct !== null && p.heroPct < HERO_PCT_FLAG) {
    flags.push({
      kind: "heroes",
      label: `Heroes ${Math.floor(p.heroPct)}% of ${p.thLevel ? `TH${p.thLevel}` : "their Town Hall's"} max`,
    });
  }
  if (p.missed > 0) {
    flags.push({ kind: "missed", label: `Missed ${p.missed} attack${p.missed === 1 ? "" : "s"}` });
  }
  if (p.attacks >= 2 && p.avgStars !== null && p.avgStars <= LOW_STARS_FLAG) {
    flags.push({ kind: "lowStars", label: `Averages ${p.avgStars.toFixed(1)}★ per attack` });
  }
  if (p.tripled >= TRIPLED_FLAG) {
    flags.push({ kind: "tripled", label: `Base 3-starred ${p.tripled} of ${p.defences} times` });
  }
  if (
    p.daysFielded > 0 &&
    p.thLevel !== null &&
    topFieldedTh !== null &&
    topFieldedTh - p.thLevel >= TH_GAP_FLAG
  ) {
    flags.push({ kind: "lowTh", label: `TH${p.thLevel} in a TH${topFieldedTh} lineup` });
  }
  return flags;
}

/**
 * Everything known about one clan of the group.
 *
 * `wars` is the group's wars, for their states and day numbers: only a started
 * day counts for anything, and only an ended one can hold a missed attack.
 */
export function clanScout(clanTag: string, season: ScoutSeason, wars: readonly GroupWar[]): ClanScout {
  const warByTag = new Map(wars.map((w) => [w.warTag, w]));
  const startedDays = [
    ...new Set(
      wars
        .filter((w) => w.state && STARTED.has(w.state) && w.dayNumber !== null)
        .map((w) => w.dayNumber as number),
    ),
  ].sort((a, b) => a - b);

  const roster = season.roster.filter((m) => m.clanTag === clanTag);
  const villages = new Map(
    season.villages.filter((v) => v.clanTag === clanTag).map((v) => [v.tag, v]),
  );

  // Started lineups of this clan, and every attack made against it.
  const ownRows = season.lineups.filter((m) => {
    const state = warByTag.get(m.warTag)?.state;
    return m.clanTag === clanTag && !!state && STARTED.has(state);
  });
  const ownTags = new Set([...roster.map((m) => m.tag), ...ownRows.map((m) => m.tag)]);
  const against = season.lineups.filter(
    (m) =>
      m.clanTag !== clanTag &&
      m.attackStars !== null &&
      m.attackDefenderTag !== null &&
      ownTags.has(m.attackDefenderTag),
  );

  // Fielded players' Town Halls as of their latest day, for the TH mix.
  const fieldedTh = new Map<string, number | null>();
  for (const m of ownRows) fieldedTh.set(m.tag, m.thLevel ?? fieldedTh.get(m.tag) ?? null);
  const topFieldedTh = Math.max(0, ...[...fieldedTh.values()].map((t) => t ?? 0)) || null;

  // Everyone registered, plus anyone fielded the roster somehow did not list.
  const names = new Map<string, { name: string | null; thLevel: number | null }>();
  for (const m of roster) names.set(m.tag, { name: m.name, thLevel: m.thLevel });
  for (const m of ownRows) {
    if (!names.has(m.tag)) names.set(m.tag, { name: m.name, thLevel: m.thLevel });
  }

  const players: ScoutedPlayer[] = [...names].map(([tag, base]) => {
    const village = villages.get(tag);
    const rows = ownRows.filter((m) => m.tag === tag);
    const made = rows.filter((m) => m.attackStars !== null);
    const missed = rows.filter(
      (m) => m.attackStars === null && warByTag.get(m.warTag)?.state === "warEnded",
    ).length;
    const stars = made.reduce((t, m) => t + (m.attackStars ?? 0), 0);
    const hitsOnMe = against.filter((m) => m.attackDefenderTag === tag);
    const thLevel = village?.thLevel ?? rows.at(-1)?.thLevel ?? base.thLevel;

    const player = {
      tag,
      name: village?.name ?? base.name ?? tag,
      thLevel,
      heroes: village?.heroes ?? [],
      heroPct: village?.heroPct ?? null,
      petPct: village?.petPct ?? null,
      equipmentPct: village?.equipmentPct ?? null,
      offencePct: village?.offencePct ?? null,
      maxPct: village?.maxPct ?? null,
      warStars: village?.warStars ?? null,
      scouted: !!village,
      daysFielded: rows.length,
      attacks: made.length,
      missed,
      stars,
      threeStars: made.filter((m) => m.attackStars === 3).length,
      avgStars: made.length ? round1(stars / made.length) : null,
      avgDestruction: average(made.map((m) => m.attackDestruction)),
      defences: hitsOnMe.length,
      tripled: hitsOnMe.filter((m) => m.attackStars === 3).length,
      byDay: startedDays.map((day) => {
        const row = rows.find((m) => warByTag.get(m.warTag)?.dayNumber === day);
        return { day, stars: row?.attackStars ?? null, fielded: !!row };
      }),
    };
    return { ...player, flags: weakPointsFor(player, topFieldedTh) };
  });
  players.sort(byWarOrder);

  const attacks = players.reduce((t, p) => t + p.attacks, 0);
  const threeStars = players.reduce((t, p) => t + p.threeStars, 0);
  const made = ownRows.filter((m) => m.attackStars !== null);
  const latest = [...villages.values()].map((v) => v.capturedAt).sort().at(-1) ?? null;
  const scoutedPlayers = players.filter((p) => p.scouted);

  return {
    clanTag,
    roster: lineupBreakdown(roster.map((m) => ({ name: m.name ?? m.tag, thLevel: m.thLevel }))),
    fielded: lineupBreakdown(
      [...fieldedTh].map(([tag, thLevel]) => ({ name: tag, thLevel })),
    ),
    scouted: scoutedPlayers.length,
    avgHeroPct: average(scoutedPlayers.map((p) => p.heroPct)),
    avgPetPct: average(scoutedPlayers.map((p) => p.petPct)),
    avgEquipmentPct: average(scoutedPlayers.map((p) => p.equipmentPct)),
    capturedAt: latest,
    attacks,
    missed: players.reduce((t, p) => t + p.missed, 0),
    threeStars,
    threeStarRate: attacks ? (threeStars / attacks) * 100 : null,
    avgStars: attacks ? round1(players.reduce((t, p) => t + p.stars, 0) / attacks) : null,
    avgDestruction: average(made.map((m) => m.attackDestruction)),
    defences: against.length,
    tripledAgainst: against.filter((m) => m.attackStars === 3).length,
    players,
    weakPoints: players
      .filter((p) => p.flags.length)
      .sort((a, b) => b.flags.length - a.flags.length || byWarOrder(a, b)),
  };
}

/** What scouting knows about one clan of the group, for its Standings row. */
export interface StandingScout {
  /** The registered roster's Town Halls. */
  roster: LineupBreakdown;
  /** Average heroes against Town Hall max over the villages read; null with none read. */
  avgHeroPct: number | null;
  /** Players with at least one weak point. */
  weakPoints: number;
}

/** One base of a lineup, by map position. */
export interface LineupSlot {
  position: number | null;
  tag: string;
  name: string;
  thLevel: number | null;
}

export interface NextLineup {
  warTag: string;
  day: number | null;
  state: string;
  enemyTag: string;
  theirs: LineupSlot[];
  ours: LineupSlot[];
}

/**
 * Our war that is next to be fought: the one in preparation, else the one in
 * battle. Its enemy lineup is public from preparation day — about a day before
 * anyone can attack it, which is the whole point of reading it.
 */
export function nextLineup(
  ourTag: string,
  wars: readonly GroupWar[],
  lineups: readonly ScoutWarMember[],
): NextLineup | null {
  const ours = wars.filter((w) => w.clanTag === ourTag || w.opponentTag === ourTag);
  const war =
    ours.find((w) => w.state === "preparation") ?? ours.find((w) => w.state === "inWar") ?? null;
  if (!war) return null;
  const enemyTag = war.clanTag === ourTag ? war.opponentTag : war.clanTag;
  const side = (clanTag: string): LineupSlot[] =>
    lineups
      .filter((m) => m.warTag === war.warTag && m.clanTag === clanTag)
      .map((m) => ({ position: m.mapPosition, tag: m.tag, name: m.name ?? m.tag, thLevel: m.thLevel }))
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  return {
    warTag: war.warTag,
    day: war.dayNumber,
    state: war.state as string,
    enemyTag,
    theirs: side(enemyTag),
    ours: side(ourTag),
  };
}
