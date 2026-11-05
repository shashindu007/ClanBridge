// How hard a war or a CWL day was, as a number its marks are multiplied by,
// where players of different clans are ranked together.
//
// Every mark rule is relative to the attacker: three stars on your own Town
// Hall level is the same +7 in a TH12 war in Silver as in a TH17 war in
// Champion. Inside one clan that is right, because everyone faced the same
// enemy. Across clans it ranked a minnow clan's players level with a max
// clan's, so in those views each war's or day's plus marks and plus share are
// multiplied by:
//
//   regular war   enemy TH weight
//   CWL day       league weight × enemy TH weight
//
// ENEMY TH WEIGHT: the AVERAGE Town Hall of the enemy lineup, never the
// highest (one TH17 in a TH12 lineup is not a TH17 war). 1.85 for a lineup at
// the highest hall in the game, 0.15 less for each level below it, and never
// under 1.00, so an easy war still counts in full.
//
// LEAGUE WEIGHT: 0.1 for Bronze League III and 0.1 more for each league up
// (Champion League I 1.8, Legend 2.2), the club's chosen scale. A league that
// was never recorded is 1.0, neither help nor harm.
//
// MINUS MARKS ARE NOT MULTIPLIED. A missed attack or no stars is as bad in any
// league; shrinking it in a weak one would be a discount for losing there.
//
// A clan's own pages never use this: see the views that call weightedMonth().

import { CWL_LEAGUES, canonicalLeague } from "@/data/cwl-medals";
import { HOME_HALLS } from "@/data/game";

/** The weight for a lineup at the highest Town Hall in the game. */
export const TH_TOP = 1.85;
/** Taken off for each Town Hall level the enemy's average stands below it. */
export const TH_STEP = 0.15;
/** The least a war counts for. */
export const TH_FLOOR = 1;
/** Bronze League III, and the step for each league above it. */
export const LEAGUE_STEP = 0.1;
/** A league never recorded. */
export const LEAGUE_UNKNOWN = 1;

const round2 = (value: number) => Math.round(value * 100) / 100;

/** The league's weight, or null for a name that is not a CWL league. */
export function leagueWeight(league: string | null | undefined): number | null {
  const name = canonicalLeague(league);
  if (!name) return null;
  return round2(LEAGUE_STEP * (CWL_LEAGUES.indexOf(name) + 1));
}

/** The average of the levels that are known, or null with none. */
export function averageTh(levels: ReadonlyArray<number | null | undefined>): number | null {
  const known = levels.filter((l): l is number => typeof l === "number" && l > 0);
  if (known.length === 0) return null;
  return known.reduce((sum, l) => sum + l, 0) / known.length;
}

/** The enemy lineup's weight. An unknown lineup counts as an easy one: 1.00. */
export function thWeight(average: number | null, maxTh: number = HOME_HALLS): number {
  if (average === null) return TH_FLOOR;
  return round2(Math.max(TH_FLOOR, TH_TOP - TH_STEP * (maxTh - average)));
}

/** A CWL day: the league's weight times the day's enemy lineup's. */
export function dayWeight(league: string | null | undefined, enemyThs: ReadonlyArray<number | null>): number {
  return round2((leagueWeight(league) ?? LEAGUE_UNKNOWN) * thWeight(averageTh(enemyThs)));
}

/** A regular war: the enemy lineup's weight. */
export function warWeight(enemyThs: ReadonlyArray<number | null>): number {
  return thWeight(averageTh(enemyThs));
}

/** Plus values are multiplied; minus ones stand as they are. */
export function weighPlus(value: number, weight: number): number {
  return value > 0 ? value * weight : value;
}

/** One war or day of a player's: null where they were not in it. */
export interface WeighedUnit {
  share: number;
  marks: number;
}

export interface WeightedMonth {
  /** Each counted unit's share, weighed, added up. */
  rating: number;
  /** Each counted unit's marks, weighed, added up. */
  marks: number;
  /** Rating per counted unit. Null before the first. */
  perUnit: number | null;
  /** The mean weight over the units they played. Null before the first. */
  averageWeight: number | null;
}

/**
 * A player's month, weighed: only the units that count, each by its own
 * weight. `units[i]` is matched to `weights[i]` and `counted[i]`.
 */
export function weightedMonth(
  units: ReadonlyArray<WeighedUnit | null>,
  weights: readonly number[],
  counted: readonly boolean[],
): WeightedMonth {
  let rating = 0;
  let marks = 0;
  let played = 0;
  let weightSum = 0;
  units.forEach((unit, i) => {
    if (!unit || !counted[i]) return;
    const weight = weights[i] ?? 1;
    rating += weighPlus(unit.share, weight);
    marks += weighPlus(unit.marks, weight);
    weightSum += weight;
    played += 1;
  });
  return {
    rating: Math.round(rating * 10) / 10,
    marks: round2(marks),
    perUnit: played > 0 ? Math.round((rating / played) * 10) / 10 : null,
    averageWeight: played > 0 ? round2(weightSum / played) : null,
  };
}

/** "×1.56", for a difficulty cell. */
export function weightLabel(weight: number | null): string {
  return weight === null ? "—" : `×${weight.toFixed(2)}`;
}
