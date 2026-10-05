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
  /**
   * The best result clanmates had ALREADY taken from that base when this
   * attack came — 0 for the first to hit it. Three stars on a base already at
   * two gave the clan one star, not three.
   *
   * Null when the base was hit more than once and the order of those attacks
   * was never recorded (062); the rating then treats it as a first hit.
   */
  alreadyTaken: number | null;
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

  // What each of our attacks found already taken, from the order they came in
  // (062). Grouped from cwl_attacks — the record of what was attacked — with
  // the order read off our own lineup rows.
  const orderOf = new Map(ourRows.map((m) => [m.tag, m.attackOrder]));
  const tagOf = new Map(roster.map((m) => [m.playerId, m.tag]));
  const onTarget = new Map<string, Array<{ tag: string; stars: number; order: number | null }>>();
  for (const attack of attacks) {
    const tag = tagOf.get(attack.playerId);
    if (!tag || !attack.defenderTag) continue;
    const list = onTarget.get(attack.defenderTag) ?? [];
    list.push({ tag, stars: attack.stars, order: orderOf.get(tag) ?? null });
    onTarget.set(attack.defenderTag, list);
  }
  const alreadyTaken = new Map<string, number | null>();
  for (const hits of onTarget.values()) {
    // The only attack on a base found nothing taken, whatever the order was.
    if (hits.length === 1) {
      alreadyTaken.set(hits[0]!.tag, 0);
      continue;
    }
    if (hits.some((h) => h.order === null)) {
      for (const h of hits) alreadyTaken.set(h.tag, null);
      continue;
    }
    let best = 0;
    for (const h of hits.sort((a, b) => (a.order as number) - (b.order as number))) {
      alreadyTaken.set(h.tag, best);
      best = Math.max(best, h.stars);
    }
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
              // No defender named: nothing to have been taken from. Null stays
              // null — "not known" is not the same as "nothing".
              alreadyTaken: alreadyTaken.has(m.tag) ? (alreadyTaken.get(m.tag) as number | null) : 0,
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
