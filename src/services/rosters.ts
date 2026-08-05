// T4B.11-T4B.13 — comparing the plan to what happened.
//
// R12, in one file. `cwl_roster_members` is who the leader CHOSE;
// `cwl_war_members` is who the API says PLAYED. Keeping both is what makes this
// possible, and IMPLEMENTATION.md calls the comparison "the report that ends
// arguments".
//
// The tempting simplification — reconcile the two into one list — deletes the
// only record of who was picked and did not show up, and R4 means it cannot be
// recovered.

import type { CwlAttack, CwlRosterEntry } from "@/repositories/cwl";
import type { RosterMember } from "@/repositories/rosters";

export type PlanOutcome = "played" | "absent" | "unplanned";

export interface PlanVsReality {
  playerId: string;
  tag: string;
  name: string;
  outcome: PlanOutcome;
  /** Wars they appeared in, out of the season's war count. */
  warsPlayed: number;
  attacksUsed: number;
  stars: number;
}

export interface SeasonWarData {
  /** The API roster for one war (cwl_war_members). */
  apiRoster: CwlRosterEntry[];
  attacks: CwlAttack[];
}

/**
 * T4B.11 — the three groups.
 *
 *   played     selected, and turned up
 *   absent     selected, and never appeared in a single war
 *   unplanned  played, but was never on the leader's roster
 *
 * The third group is the one nobody expects and the reason this is a three-way
 * split rather than a checklist: players get added in game by a co-leader who
 * did not see the roster, and without this they are invisible in every report
 * while quietly consuming a slot someone else was promised.
 */
export function planVsReality(
  selected: RosterMember[],
  wars: SeasonWarData[],
): PlanVsReality[] {
  const appearances = new Map<string, { wars: number; attacks: number; stars: number }>();
  const identity = new Map<string, { tag: string; name: string }>();

  for (const war of wars) {
    for (const entry of war.apiRoster) {
      const current = appearances.get(entry.playerId) ?? { wars: 0, attacks: 0, stars: 0 };
      current.wars += 1;
      appearances.set(entry.playerId, current);
      identity.set(entry.playerId, { tag: entry.tag, name: entry.name });
    }
    for (const attack of war.attacks) {
      const current = appearances.get(attack.playerId) ?? { wars: 0, attacks: 0, stars: 0 };
      current.attacks += 1;
      current.stars += attack.stars;
      appearances.set(attack.playerId, current);
    }
  }

  const rows: PlanVsReality[] = [];
  const selectedIds = new Set<string>();

  for (const member of selected) {
    selectedIds.add(member.playerId);
    const seen = appearances.get(member.playerId);
    rows.push({
      playerId: member.playerId,
      tag: member.tag,
      name: member.name,
      outcome: seen && seen.wars > 0 ? "played" : "absent",
      warsPlayed: seen?.wars ?? 0,
      attacksUsed: seen?.attacks ?? 0,
      stars: seen?.stars ?? 0,
    });
  }

  for (const [playerId, seen] of appearances) {
    if (selectedIds.has(playerId)) continue;
    const who = identity.get(playerId);
    rows.push({
      playerId,
      tag: who?.tag ?? "",
      name: who?.name ?? "Unknown player",
      outcome: "unplanned",
      warsPlayed: seen.wars,
      attacksUsed: seen.attacks,
      stars: seen.stars,
    });
  }

  // absent first: it is the group the leader needs to act on. Then unplanned,
  // then the people who did what was asked.
  const rank: Record<PlanOutcome, number> = { absent: 0, unplanned: 1, played: 2 };
  return rows.sort(
    (a, b) => rank[a.outcome] - rank[b.outcome] || b.stars - a.stars || a.name.localeCompare(b.name),
  );
}

export interface ContributionRow {
  playerId: string;
  tag: string;
  name: string;
  warsPlayed: number;
  attacksUsed: number;
  missed: number;
  stars: number;
  averageDestruction: number;
  hasBonus: boolean;
  bonusOrder: number | null;
}

/**
 * T4B.12 — per player for the season: attacks used out of the wars they were in,
 * stars, average destruction, missed days, and whether they got a medal.
 *
 * `missed` counts wars they were ON THE API ROSTER for and did not attack in —
 * not wars they sat out. Being left out of a war is the leader's decision; not
 * attacking in one you were placed in is the member's.
 */
export function contributionReport(
  wars: SeasonWarData[],
  bonuses: Array<{ playerId: string; awardOrder: number | null }>,
): ContributionRow[] {
  const acc = new Map<
    string,
    { tag: string; name: string; wars: number; attacks: number; stars: number; destruction: number }
  >();

  for (const war of wars) {
    const attacksByPlayer = new Map<string, CwlAttack[]>();
    for (const attack of war.attacks) {
      const list = attacksByPlayer.get(attack.playerId) ?? [];
      list.push(attack);
      attacksByPlayer.set(attack.playerId, list);
    }

    for (const entry of war.apiRoster) {
      const row =
        acc.get(entry.playerId) ??
        { tag: entry.tag, name: entry.name, wars: 0, attacks: 0, stars: 0, destruction: 0 };
      row.wars += 1;
      for (const attack of attacksByPlayer.get(entry.playerId) ?? []) {
        row.attacks += 1;
        row.stars += attack.stars;
        row.destruction += attack.destruction;
      }
      acc.set(entry.playerId, row);
    }
  }

  const bonusByPlayer = new Map(bonuses.map((b) => [b.playerId, b.awardOrder]));

  const rows: ContributionRow[] = [...acc.entries()].map(([playerId, r]) => ({
    playerId,
    tag: r.tag,
    name: r.name,
    warsPlayed: r.wars,
    attacksUsed: r.attacks,
    missed: r.wars - r.attacks,
    stars: r.stars,
    averageDestruction: r.attacks === 0 ? 0 : r.destruction / r.attacks,
    hasBonus: bonusByPlayer.has(playerId),
    bonusOrder: bonusByPlayer.get(playerId) ?? null,
  }));

  // Stars first, then fewest missed. This is a DEFAULT READING ORDER, not the
  // bonus rule — T4B.13 leaves the allocation order to the leader, and this sort
  // exists so the evidence is legible while they decide.
  return rows.sort(
    (a, b) => b.stars - a.stars || a.missed - b.missed || a.name.localeCompare(b.name),
  );
}

/**
 * T4B.13 — the leader's allocation list, in their order.
 *
 * Deliberately NOT a ranking function. The rule for this deployment is the
 * leader's final decision order, so the system's job is to hold that order once
 * it is set, and to show the contribution evidence beside it while it is being
 * decided. Anything already awarded keeps its place; everyone else follows in
 * the default reading order for consideration.
 */
export function allocationList(
  contributions: ContributionRow[],
): { awarded: ContributionRow[]; candidates: ContributionRow[] } {
  const awarded = contributions
    .filter((c) => c.hasBonus)
    .sort((a, b) => (a.bonusOrder ?? 999) - (b.bonusOrder ?? 999));

  const candidates = contributions.filter((c) => !c.hasBonus);
  return { awarded, candidates };
}

/** The next free position in the leader's order. */
export function nextAwardOrder(awarded: ContributionRow[]): number {
  const used = awarded.map((a) => a.bonusOrder ?? 0);
  return used.length === 0 ? 1 : Math.max(...used) + 1;
}
