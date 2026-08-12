// T7.3 — the raid derivations, as pure functions.
//
// No SQL, no clock beyond what is passed in, no Supabase import. Everything here
// takes repository types and returns plain data, so the rules can be tested
// without a database — the same contract services/cwl.ts and services/war.ts keep.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE RULE THIS FILE EXISTS TO GET RIGHT: ATTACKS HAVE A DENOMINATOR
//
// A raid weekend gives each member a variable number of attacks — a base limit
// plus a bonus attack awarded to some and not others. So "used 5" means nothing
// on its own. 5 of 5 is a member who did everything asked; 5 of 6 is a member
// who left one unspent, and a report that shows both as "5" tells the leader
// they are the same person.
//
// This is the third time this project has met the same shape. CWL used a boolean
// `missed`, which was right there because a CWL war gives exactly one attack.
// T6.9 found that boolean wrong for a regular war, where two attacks mean
// fifteen members each leaving one unused is a whole roster's worth invisible.
// Raids are the general case: the denominator is not even constant between two
// members of the same clan on the same weekend.
//
// Hence `attacksOwed` rather than a boolean, and hence the deliberate `null`
// when the limit is unknown — see below. Guessing 6 would be worse than
// admitting ignorance, because a guessed denominator produces a confident,
// readable, wrong number that nobody thinks to question.
// ─────────────────────────────────────────────────────────────────────────────

import type { RaidParticipantRow, RaidSeasonRow } from "@/repositories/raids";

/** A weekend the API still says is being played. Mirrors scripts/sync/raids.ts. */
export function isOngoing(season: RaidSeasonRow): boolean {
  return season.state === "ongoing";
}

/**
 * How many attacks a member was offered, or null if we cannot say.
 *
 * NULL IS A REAL ANSWER HERE. Rows written before migration 027 have no
 * attack_limit at all, and the API omits the field on some responses. The
 * alternative — defaulting to 6, or to `attacksUsed` so everyone looks
 * complete — invents a denominator, and every number derived from it then
 * reads as fact. A dash on the page is honest; a wrong "5 of 6" is not.
 */
export function attacksOffered(p: RaidParticipantRow): number | null {
  if (p.attackLimit === null) return null;
  return p.attackLimit + (p.bonusAttackLimit ?? 0);
}

/**
 * Attacks left unspent, or null when the offer is unknown.
 *
 * Clamped at zero. A member credited with more attacks than they were offered
 * is a data problem, not a negative debt, and "-1 owed" sends the reader looking
 * for a bug in the wrong place — the same clamp warRecord applies.
 */
export function attacksOwed(p: RaidParticipantRow): number | null {
  const offered = attacksOffered(p);
  if (offered === null || p.attacksUsed === null) return null;
  return Math.max(0, offered - p.attacksUsed);
}

export interface RaidRecord extends RaidParticipantRow {
  offered: number | null;
  owed: number | null;
  /** True only when they were offered attacks and used none. */
  satOut: boolean;
}

/**
 * The weekend's participants with their denominators attached, worst first.
 *
 * ORDERED BY WHAT IS OWED, not by loot. Loot ranks the people who did well;
 * this list exists for the people who did not, and they are the only ones a
 * leader can act on. Unknown denominators sort last rather than first — they
 * are not an accusation and should not lead a list that reads as one.
 */
export function raidRecord(participants: RaidParticipantRow[]): RaidRecord[] {
  return participants
    .map((p) => {
      const offered = attacksOffered(p);
      const owed = attacksOwed(p);
      return {
        ...p,
        offered,
        owed,
        satOut: offered !== null && offered > 0 && (p.attacksUsed ?? 0) === 0,
      };
    })
    .sort(
      (a, b) =>
        (b.owed ?? -1) - (a.owed ?? -1) ||
        (b.loot ?? 0) - (a.loot ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

/** Everyone with attacks still unspent — the chase list, worst first. */
export function outstandingRaidAttacks(record: RaidRecord[]): RaidRecord[] {
  return record.filter((r) => (r.owed ?? 0) > 0);
}

export interface RaidTotals {
  weekends: number;
  totalLoot: number;
  /** Raid medals across every weekend, which is what members are actually paid. */
  offensiveReward: number;
  /** Attacks used and offered across everyone, for the participation headline. */
  attacksUsed: number;
  attacksOffered: number;
  /** How many participants had no known limit — see attacksOffered on why. */
  unknownLimits: number;
}

/**
 * One weekend, summed.
 *
 * `attacksOffered` counts only participants whose limit is known, and
 * `unknownLimits` reports how many were left out. A denominator that silently
 * omits rows reads as a complete total and is not one — the page has to be able
 * to say "42 of 48, and 3 we cannot judge" rather than implying 42 of 45.
 */
export function seasonTotals(
  season: RaidSeasonRow,
  participants: RaidParticipantRow[],
): RaidTotals {
  let attacksUsed = 0;
  let offered = 0;
  let unknownLimits = 0;

  for (const p of participants) {
    attacksUsed += p.attacksUsed ?? 0;
    const own = attacksOffered(p);
    if (own === null) unknownLimits += 1;
    else offered += own;
  }

  return {
    weekends: 1,
    totalLoot: season.totalLoot ?? 0,
    offensiveReward: season.offensiveReward ?? 0,
    attacksUsed,
    attacksOffered: offered,
    unknownLimits,
  };
}

/**
 * Many weekends, summed — the history headline (T7.3).
 *
 * Takes the seasons alone, so it costs no participant queries. That is why
 * attacksUsed comes from the season's own total_attacks rather than from
 * summing members: the clan-level number is on the row already, and fetching
 * every participant of every weekend to re-derive it would be ten queries for a
 * number the API already sent.
 */
export function historyTotals(seasons: RaidSeasonRow[]): {
  weekends: number;
  totalLoot: number;
  offensiveReward: number;
  attacks: number;
} {
  return seasons.reduce(
    (acc, s) => ({
      weekends: acc.weekends + 1,
      totalLoot: acc.totalLoot + (s.totalLoot ?? 0),
      offensiveReward: acc.offensiveReward + (s.offensiveReward ?? 0),
      attacks: acc.attacks + (s.totalAttacks ?? 0),
    }),
    { weekends: 0, totalLoot: 0, offensiveReward: 0, attacks: 0 },
  );
}

export interface PlayerRaidSummary {
  weekendsAvailable: number;
  weekendsRaided: number;
  attacksUsed: number;
  totalLoot: number;
}

/**
 * One member's record across the weekends this clan has (T7.3, linked from the
 * player profile).
 *
 * `weekendsAvailable` counts every weekend in the window, INCLUDING the ones
 * they sat out — that gap is the entire point. Counting only weekends they
 * appear in makes a member who raided once out of ten look identical to one who
 * raided once and only joined last week. Same reason T4B.11 splits
 * selected-and-absent from never-selected rather than collapsing them.
 */
export function playerRaidSummary(
  history: Array<{ season: RaidSeasonRow; participation: RaidParticipantRow | null }>,
): PlayerRaidSummary {
  let weekendsRaided = 0;
  let attacksUsed = 0;
  let totalLoot = 0;

  for (const { participation } of history) {
    if (!participation) continue;
    const used = participation.attacksUsed ?? 0;
    if (used > 0) weekendsRaided += 1;
    attacksUsed += used;
    totalLoot += participation.loot ?? 0;
  }

  return {
    weekendsAvailable: history.length,
    weekendsRaided,
    attacksUsed,
    totalLoot,
  };
}
