// One CWL war day, base by base: each of OUR bases with the attack its owner
// made and every attack the enemy made on it.
//
// The day page used to show half of this. It listed our attacks and nothing of
// the enemy's, so "who got 3-starred" and "which of our bases is still standing"
// had to be read off the game. And it printed the API's mapPosition as the base
// number, which in CWL it is not — see baseNumbers() in services/cwl.ts.
//
// Two sources, both already written by the CWL sync:
//
//   roster + attacks   our side, from cwl_war_members and cwl_attacks (002/019)
//   lineup             both sides of the same war from cwl_group_war_members
//                      (057), each member's one attack inline
//
// Defence is not stored anywhere (057): it is the enemy's attacks read by the
// tag they hit, derived here the same way missed attacks are.
//
// A season from before 057 has no lineup. Its board still lists our attacks,
// but an enemy base has no number and no name, and there is no defence —
// `enemyKnown` is false and the page says so instead of printing a number that
// is known to be wrong.

import type { CwlAttack, CwlRosterEntry, GroupWar } from "@/repositories/cwl";
import type { ScoutWarMember } from "@/services/cwl-scouting";
import { baseNumbers, warRecord } from "@/services/cwl";

/** A base as a row names it: its number on the map, and whose it is. */
export interface BaseRef {
  tag: string;
  /** Null when the lineup it belongs to was never recorded. */
  base: number | null;
  name: string | null;
  thLevel: number | null;
}

export interface DayAttack {
  stars: number;
  destruction: number;
  /** The enemy base that was hit. Null only when the API named no defender. */
  target: BaseRef | null;
}

export interface DayDefence {
  stars: number;
  destruction: number;
  /** The enemy who attacked. */
  by: BaseRef;
}

export interface DayBase {
  playerId: string;
  tag: string;
  name: string;
  thLevel: number | null;
  /** This base's number on the war map. */
  base: number | null;
  /** The owner's attack — one each in CWL. Null when it has not been used. */
  attack: DayAttack | null;
  /** Every enemy attack on this base, the one that counts first. */
  defences: DayDefence[];
}

/** Attacks used out of attacks available. Null where it is not known. */
export interface SideAttacks {
  used: number | null;
  of: number | null;
}

export interface DayBoard {
  /** Our bases in map order. */
  bases: DayBase[];
  /** False when the enemy lineup for this day was never recorded. */
  enemyKnown: boolean;
  ours: SideAttacks;
  theirs: SideAttacks;
  /** Our bases attacked at least once, and 3-starred at least once. */
  basesHit: number;
  basesTripled: number;
}

export function dayBoard(input: {
  roster: CwlRosterEntry[];
  attacks: CwlAttack[];
  /** Both sides of THIS war, or [] when it was never recorded. */
  lineup: readonly ScoutWarMember[];
  ourTag: string;
  teamSize: number | null;
  /** The same war in the group table, for the enemy's attack count without a lineup. */
  groupWar?: GroupWar | null;
}): DayBoard {
  const { roster, attacks, lineup, ourTag, teamSize, groupWar } = input;
  const ourRows = lineup.filter((m) => m.clanTag === ourTag);
  const enemyRows = lineup.filter((m) => m.clanTag !== ourTag);
  const enemyKnown = enemyRows.length > 0;

  // The lineup row first: it is refreshed while the war is live, where the
  // roster keeps the position it was first written with.
  const ourPosition = new Map(ourRows.map((m) => [m.tag, m.mapPosition]));
  const ourBase = baseNumbers(
    roster.map((m) => ({ tag: m.tag, mapPosition: ourPosition.get(m.tag) ?? m.mapPosition })),
  );
  const enemyBase = baseNumbers(enemyRows);
  const enemyByTag = new Map(enemyRows.map((m) => [m.tag, m]));

  const enemyRef = (tag: string): BaseRef => {
    const member = enemyByTag.get(tag);
    return {
      tag,
      base: enemyBase.get(tag) ?? null,
      name: member?.name ?? null,
      thLevel: member?.thLevel ?? null,
    };
  };

  const hitsOn = new Map<string, DayDefence[]>();
  for (const m of enemyRows) {
    if (m.attackStars === null || m.attackDefenderTag === null) continue;
    const list = hitsOn.get(m.attackDefenderTag) ?? [];
    list.push({ stars: m.attackStars, destruction: m.attackDestruction ?? 0, by: enemyRef(m.tag) });
    hitsOn.set(m.attackDefenderTag, list);
  }

  const bases = warRecord(roster, attacks)
    .map((m): DayBase => {
      const attack = m.attacks[0];
      return {
        playerId: m.playerId,
        tag: m.tag,
        name: m.name,
        thLevel: m.thLevel,
        base: ourBase.get(m.tag) ?? null,
        attack: attack
          ? {
              stars: attack.stars,
              destruction: attack.destruction,
              target: attack.defenderTag ? enemyRef(attack.defenderTag) : null,
            }
          : null,
        // A base hit twice scores its best hit, so that one leads.
        defences: (hitsOn.get(m.tag) ?? []).sort(
          (a, b) => b.stars - a.stars || b.destruction - a.destruction,
        ),
      };
    })
    .sort((a, b) => (a.base ?? 99) - (b.base ?? 99) || a.name.localeCompare(b.name));

  // Without a lineup the group table still has the enemy's count (048).
  const theirCount = groupWar
    ? groupWar.clanTag === ourTag
      ? groupWar.opponentAttacks
      : groupWar.clanAttacks
    : null;

  return {
    bases,
    enemyKnown,
    ours: { used: bases.filter((b) => b.attack).length, of: roster.length || teamSize },
    theirs: {
      used: enemyKnown ? enemyRows.filter((m) => m.attackStars !== null).length : theirCount,
      of: enemyRows.length || teamSize,
    },
    basesHit: bases.filter((b) => b.defences.length > 0).length,
    basesTripled: bases.filter((b) => b.defences.some((d) => d.stars === 3)).length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOP PERFORMERS
//
// The list was the season's stars and nothing else, and on the first days of a
// week that is a twelve-way tie at three stars — which it then broke BY NAME.
// So a top base that dropped to their #13 for an easy triple was listed above
// our #14 who tripled their #8, because of how the two names sort.
//
// Stars still come first: they are what wins the war and pays the medals. What
// changed is everything after them — a tie now goes to the harder hit.
// ─────────────────────────────────────────────────────────────────────────────

export interface TopPerformer {
  playerId: string;
  tag: string;
  name: string;
  /** Their Town Hall on the latest day they attacked. */
  thLevel: number | null;
  attacks: number;
  stars: number;
  threeStars: number;
  averageDestruction: number;
  /**
   * How far above their own Town Hall their targets stood, averaged over their
   * attacks. Null when no target's Town Hall is known.
   */
  thReach: number | null;
  /**
   * How far UP the war map they hit, averaged: their own base number minus the
   * target's, so our #14 on their #8 is +6 and our #4 on their #13 is -9. Null
   * when the enemy lineup was never recorded.
   */
  mapReach: number | null;
}

/**
 * Everyone who has attacked this season, best first.
 *
 *   1. stars
 *   2. stars per attack — the same stars from fewer attacks
 *   3. the harder hit: a higher Town Hall than their own, then a base higher on
 *      the map than their own
 *   4. destruction
 *
 * The name is last and only keeps the order stable. An attack whose target is
 * not known counts as neither up nor down.
 *
 * `days` is one board per war day. A day still in preparation has no attacks
 * and adds nothing; a live day counts as it stands.
 */
export function topPerformers(days: readonly DayBoard[]): TopPerformer[] {
  const acc = new Map<
    string,
    {
      tag: string;
      name: string;
      thLevel: number | null;
      attacks: number;
      stars: number;
      threeStars: number;
      destruction: number;
      thGaps: number[];
      mapGaps: number[];
    }
  >();

  for (const day of days) {
    for (const base of day.bases) {
      const attack = base.attack;
      if (!attack) continue;
      const row = acc.get(base.playerId) ?? {
        tag: base.tag,
        name: base.name,
        thLevel: base.thLevel,
        attacks: 0,
        stars: 0,
        threeStars: 0,
        destruction: 0,
        thGaps: [],
        mapGaps: [],
      };
      row.name = base.name;
      row.thLevel = base.thLevel ?? row.thLevel;
      row.attacks += 1;
      row.stars += attack.stars;
      if (attack.stars === 3) row.threeStars += 1;
      row.destruction += attack.destruction;
      const target = attack.target;
      if (target && target.thLevel !== null && base.thLevel !== null) {
        row.thGaps.push(target.thLevel - base.thLevel);
      }
      if (target && target.base !== null && base.base !== null) {
        row.mapGaps.push(base.base - target.base);
      }
      acc.set(base.playerId, row);
    }
  }

  const mean = (values: number[]) =>
    values.length ? values.reduce((t, v) => t + v, 0) / values.length : null;

  return [...acc.entries()]
    .map(
      ([playerId, r]): TopPerformer => ({
        playerId,
        tag: r.tag,
        name: r.name,
        thLevel: r.thLevel,
        attacks: r.attacks,
        stars: r.stars,
        threeStars: r.threeStars,
        averageDestruction: r.destruction / r.attacks,
        thReach: mean(r.thGaps),
        mapReach: mean(r.mapGaps),
      }),
    )
    .sort(
      (a, b) =>
        b.stars - a.stars ||
        a.attacks - b.attacks ||
        (b.thReach ?? 0) - (a.thReach ?? 0) ||
        (b.mapReach ?? 0) - (a.mapReach ?? 0) ||
        b.averageDestruction - a.averageDestruction ||
        a.name.localeCompare(b.name),
    );
}

function amount(n: number): string {
  const rounded = Math.round(Math.abs(n) * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/**
 * The harder-hit part of a row, in a few words: "hit 1 TH up, 6 bases up",
 * "hit mirror", "avg 2.5 bases down". An average says so — "3 bases up" over
 * four attacks is not one attack. Null when nothing about the targets is known.
 */
export function reachNote(p: Pick<TopPerformer, "attacks" | "thReach" | "mapReach">): string | null {
  const parts: string[] = [];
  if (p.thReach !== null && amount(p.thReach) !== "0") {
    parts.push(`${amount(p.thReach)} TH ${p.thReach > 0 ? "up" : "down"}`);
  }
  if (p.mapReach !== null) {
    const n = amount(p.mapReach);
    parts.push(n === "0" ? "mirror" : `${n} base${n === "1" ? "" : "s"} ${p.mapReach > 0 ? "up" : "down"}`);
  }
  return parts.length ? `${p.attacks > 1 ? "avg" : "hit"} ${parts.join(", ")}` : null;
}
