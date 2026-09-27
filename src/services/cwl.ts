// T4.3 — derived CWL values. No SQL here; this layer takes what the repository
// returned and works out what it means.
//
// The headline one is missed attacks, and it is a derivation rather than a
// column on purpose. 002_cwl.sql:76-78:
//
//     "Missed attacks are NOT stored. The API simply returns no attack for a
//      player who did not attack; the missed list is derived from roster minus
//      attacks. Never insert a zero-star placeholder row to represent a miss."
//
// A stored miss is indistinguishable from a genuine zero-star attack once it is
// in the table, and CWL rows cannot be repaired later because the source data is
// deleted at the end of the season.

import type { CwlAttack, CwlRosterEntry, CwlWar } from "@/repositories/cwl";

export interface MemberWarRecord {
  playerId: string;
  tag: string;
  name: string;
  mapPosition: number | null;
  thLevel: number | null;
  attacks: CwlAttack[];
  /** True when this player was on the roster and used none of their attacks. */
  missed: boolean;
  stars: number;
  destruction: number;
}

/**
 * The roster with each member's attacks attached, and the miss flag set.
 *
 * Driven from the roster, not from the attacks: a player only appears if they
 * were actually in the war, and a player with no attacks still appears — which
 * is the entire point. Iterating attacks instead would make the people who did
 * nothing invisible, and they are the ones the leader is looking for.
 */
export function warRecord(
  roster: CwlRosterEntry[],
  attacks: CwlAttack[],
): MemberWarRecord[] {
  const byPlayer = new Map<string, CwlAttack[]>();
  for (const attack of attacks) {
    const list = byPlayer.get(attack.playerId) ?? [];
    list.push(attack);
    byPlayer.set(attack.playerId, list);
  }

  return roster.map((member) => {
    const mine = (byPlayer.get(member.playerId) ?? [])
      .slice()
      .sort((a, b) => a.attackOrder - b.attackOrder);

    return {
      playerId: member.playerId,
      tag: member.tag,
      name: member.name,
      mapPosition: member.mapPosition,
      thLevel: member.thLevel,
      attacks: mine,
      missed: mine.length === 0,
      stars: mine.reduce((total, a) => total + a.stars, 0),
      destruction: mine.reduce((total, a) => total + a.destruction, 0),
    };
  });
}

/** Just the people who did not attack — the list a leader actually chases (T4.5). */
export function missedAttacks(
  roster: CwlRosterEntry[],
  attacks: CwlAttack[],
): MemberWarRecord[] {
  return warRecord(roster, attacks).filter((m) => m.missed);
}

export interface SeasonTotals {
  warsPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  stars: number;
  starsAgainst: number;
}

export interface SeasonSpan {
  /** The earliest battle-day start recorded for the season. */
  from: string;
  /** The latest end recorded, or null while no day has ended yet. */
  to: string | null;
  /** `running` while any day has not reached warEnded. */
  state: "running" | "ended";
}

/**
 * When a season actually ran, derived from its war days.
 *
 * DERIVED AND NOT STORED, on purpose. cwl_seasons carries 'YYYY-MM' and the
 * league and nothing else, while every row in cwl_wars has carried a start and
 * an end since 002 — written by every CWL sync and, until T12.2, read by no
 * query at all. So the times existed and the season page could not say when a
 * day had run, while the war board said exactly that about a regular war.
 *
 * A stored pair would also be a second source that can disagree with the days
 * it summarises. A season's span IS its war days; deriving it cannot drift.
 *
 * `state` is what decides how the caller words the second date: while a day is
 * still open it is a DEADLINE the reader acts on, and afterwards it is a fact
 * about the past. Getting that the wrong way round is how somebody reads "ends
 * Friday" about a season that finished last month.
 *
 * Null when no day has a start — a season row whose wars were never captured,
 * which is the case the page's empty state already names.
 */
export function seasonSpan(wars: CwlWar[]): SeasonSpan | null {
  let from: string | null = null;
  let to: string | null = null;
  let running = false;

  for (const war of wars) {
    if (war.startTime && (from === null || war.startTime < from)) from = war.startTime;
    if (war.endTime && (to === null || war.endTime > to)) to = war.endTime;
    // Anything not finished keeps the season open, including a day still in
    // preparation — which is a day nobody has attacked in yet, not a past one.
    if (war.state !== "warEnded") running = true;
  }

  if (from === null) return null;
  return { from, to, state: running ? "running" : "ended" };
}

/**
 * A season's win/loss record.
 *
 * Counts only wars that have a result. A war still in preparation has none, and
 * scoring it as anything — including a loss — would be a lie about a war that
 * has not happened.
 */
export function seasonTotals(wars: CwlWar[]): SeasonTotals {
  const totals: SeasonTotals = {
    warsPlayed: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    stars: 0,
    starsAgainst: 0,
  };

  for (const war of wars) {
    if (!war.result) continue;
    // The sync gives a running day a provisional result from the stars so far.
    // It is not a win or a loss until the day ends.
    if (war.state === "inWar" || war.state === "preparation") continue;
    totals.warsPlayed += 1;
    if (war.result === "win") totals.wins += 1;
    else if (war.result === "lose") totals.losses += 1;
    else totals.ties += 1;
    totals.stars += war.ourStars ?? 0;
    totals.starsAgainst += war.theirStars ?? 0;
  }

  return totals;
}

/**
 * Per-player totals across a whole season, for the contribution view.
 *
 * `warsRostered` is the denominator that makes `attacksUsed` mean anything: 4
 * attacks from 7 wars is a different conversation from 4 from 4.
 */
export interface SeasonContribution {
  playerId: string;
  tag: string;
  name: string;
  warsRostered: number;
  attacksUsed: number;
  missed: number;
  stars: number;
}

export function seasonContribution(
  perWar: Array<{ roster: CwlRosterEntry[]; attacks: CwlAttack[] }>,
): SeasonContribution[] {
  const byPlayer = new Map<string, SeasonContribution>();

  for (const war of perWar) {
    for (const member of warRecord(war.roster, war.attacks)) {
      const entry = byPlayer.get(member.playerId) ?? {
        playerId: member.playerId,
        tag: member.tag,
        name: member.name,
        warsRostered: 0,
        attacksUsed: 0,
        missed: 0,
        stars: 0,
      };

      entry.warsRostered += 1;
      entry.attacksUsed += member.attacks.length;
      entry.stars += member.stars;
      if (member.missed) entry.missed += 1;
      byPlayer.set(member.playerId, entry);
    }
  }

  // Most stars first, then fewest misses — the order a leader reads it in.
  return [...byPlayer.values()].sort(
    (a, b) => b.stars - a.stars || a.missed - b.missed || a.name.localeCompare(b.name),
  );
}
