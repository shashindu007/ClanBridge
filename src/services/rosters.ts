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
  /**
   * The day's state, when known. contributionReport() leaves out a day still
   * in preparation or battle: a miss is a day that ENDED without an attack.
   */
  state?: string | null;
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
}

/**
 * T4B.12 — per player for the season: attacks used out of the wars they were in,
 * stars, average destruction and missed days.
 *
 * `missed` counts wars they were ON THE API ROSTER for and did not attack in —
 * not wars they sat out. Being left out of a war is the leader's decision; not
 * attacking in one you were placed in is the member's.
 */
export function contributionReport(wars: SeasonWarData[]): ContributionRow[] {
  const acc = new Map<
    string,
    { tag: string; name: string; wars: number; attacks: number; stars: number; destruction: number }
  >();

  for (const war of wars) {
    // Mid-season, the days not yet over used to add a "miss" to everyone on
    // them — and the bonus-medal candidate list is ranked on these numbers.
    if (war.state === "preparation" || war.state === "inWar") continue;

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

  const rows: ContributionRow[] = [...acc.entries()].map(([playerId, r]) => ({
    playerId,
    tag: r.tag,
    name: r.name,
    warsPlayed: r.wars,
    attacksUsed: r.attacks,
    missed: r.wars - r.attacks,
    stars: r.stars,
    averageDestruction: r.attacks === 0 ? 0 : r.destruction / r.attacks,
  }));

  // Stars first, then fewest missed. A DEFAULT READING ORDER — the evidence a
  // leader looks at before handing out bonus medals in game, not a ranking
  // that decides them.
  return rows.sort(
    (a, b) => b.stars - a.stars || a.missed - b.missed || a.name.localeCompare(b.name),
  );
}
