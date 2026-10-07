// The war rating: the CWL player rating (services/cwl-rating.ts), applied to
// regular wars.
//
// The marks are CWL's, from the same constants and the same functions — a
// 3-star, a Town Hall up, a base held to one star are worth here exactly what
// they are worth there. A regular war differs in four ways, and those are the
// whole of this file:
//
//   TWO ATTACKS   each is scored and the two are added, with the better one
//                 counting 1.5 times when it is above zero: +12 and +4 is
//                 12 × 1.5 + 4 = 22. An attack not used costs 10 each once
//                 the war is over.
//
//   THE SAME BASE In a regular war a base is hit by several of ours as a
//                 matter of course (7 to 25 bases a war). An attack that adds
//                 a star keeps its full marks — clean-up is the job, not a
//                 lesser attack. One that adds none earns no star marks and
//                 nothing for hitting up. Read from the order of attacks (063).
//
//   TARGET RANK   their last base +1, their #1 always +5.2, evenly between,
//                 whatever the war's size — these run from 5 to 50 bases.
//
//   THE PERIOD    there is no week. A player's shares are added over the wars
//                 that started in a calendar month.
//
// ATTACK-ONLY WARS. The enemy's attacks and the order of ours are stored from
// 063 on; the API serves the current war only, so nothing older can be filled
// in. A war from before it is rated on its attacks alone — no defence marks,
// no heroic defence, and a base hit twice scored as a first hit each time —
// and is marked so. A share is a share of ONE war's plus marks, so such a war
// is fair in itself; it is the months that mix both kinds that the page labels.
//
// Derived, never stored, like the CWL rating.

import type {
  WarMemberRow,
  WarOpponentAttackRow,
  WarOpponentRow,
  WarRatingAttackRow,
} from "@/repositories/war";
import { baseNumbers } from "@/services/cwl";
import type { BaseRef, DayAttack, DayBase, DayDefence } from "@/services/cwl-day";
import {
  attackLines,
  CWL_MARKS,
  defenceLines,
  heroicAttack,
  heroicDefence,
  round1,
  type AttackRules,
  type MarkLine,
} from "@/services/cwl-rating";

export const WAR_RULES: AttackRules = { sameBase: "fullIfNew", rankTop: 5.2 };

export const WAR_MARKS = {
  /** What a player's better attack is multiplied by, when it is above zero. */
  bestAttack: 1.5,
  /** Per attack not used, once the war is over. */
  missed: CWL_MARKS.missed,
} as const;

/** One of our bases in a regular war: up to two attacks, and the enemy's hits on it. */
export interface WarBase {
  playerId: string;
  tag: string;
  name: string;
  thLevel: number | null;
  /** This base's number on the war map. */
  base: number | null;
  attacksAllowed: number;
  /** The owner's attacks, first then second. */
  attacks: DayAttack[];
  /** Every enemy attack on this base, the one that counts first. */
  defences: DayDefence[];
}

export interface WarBoard {
  /** Our bases in map order. */
  bases: WarBase[];
  /** How many bases the enemy fielded. */
  enemyBases: number | null;
  /** False for a war from before 063: the enemy's attacks were never recorded. */
  defenceKnown: boolean;
}

export function warBoard(input: {
  members: readonly WarMemberRow[];
  attacks: readonly WarRatingAttackRow[];
  opponents: readonly WarOpponentRow[];
  opponentAttacks: readonly WarOpponentAttackRow[];
  /** wars.opponent_attacks_captured_at is set — see 063. */
  defenceKnown: boolean;
  teamSize: number | null;
}): WarBoard {
  const { members, attacks, opponents, opponentAttacks, defenceKnown, teamSize } = input;

  // A regular war's map positions already run 1 to N. Ranked all the same: it
  // costs nothing, and CWL is what assuming otherwise looked like.
  const ourBase = baseNumbers(members);
  const enemyBase = baseNumbers(opponents);
  const enemyByTag = new Map(opponents.map((o) => [o.tag, o]));
  const enemyRef = (tag: string): BaseRef => {
    const member = enemyByTag.get(tag);
    return { tag, base: enemyBase.get(tag) ?? null, name: member?.name ?? null, thLevel: member?.thLevel ?? null };
  };

  // What each attack found already taken, by the order of the war. Keyed by
  // the attack itself: the same player has two.
  const key = (a: { playerId: string; attackOrder: number }) => `${a.playerId}:${a.attackOrder}`;
  const onTarget = new Map<string, WarRatingAttackRow[]>();
  for (const attack of attacks) {
    if (!attack.defenderTag) continue;
    const list = onTarget.get(attack.defenderTag) ?? [];
    list.push(attack);
    onTarget.set(attack.defenderTag, list);
  }
  const alreadyTaken = new Map<string, number | null>();
  for (const hits of onTarget.values()) {
    if (hits.length === 1) {
      alreadyTaken.set(key(hits[0]!), 0);
      continue;
    }
    if (hits.some((h) => h.warOrder === null)) {
      for (const h of hits) alreadyTaken.set(key(h), null);
      continue;
    }
    let best = 0;
    for (const h of [...hits].sort((a, b) => (a.warOrder as number) - (b.warOrder as number))) {
      alreadyTaken.set(key(h), best);
      best = Math.max(best, h.stars);
    }
  }

  const hitsOn = new Map<string, DayDefence[]>();
  if (defenceKnown) {
    for (const hit of opponentAttacks) {
      if (!hit.defenderTag) continue;
      const list = hitsOn.get(hit.defenderTag) ?? [];
      list.push({ stars: hit.stars, destruction: hit.destruction, by: enemyRef(hit.attackerTag) });
      hitsOn.set(hit.defenderTag, list);
    }
  }

  const bases = members
    .map((m): WarBase => ({
      playerId: m.playerId,
      tag: m.tag,
      name: m.name,
      thLevel: m.thLevel,
      base: ourBase.get(m.tag) ?? null,
      attacksAllowed: m.attacksAllowed,
      attacks: attacks
        .filter((a) => a.playerId === m.playerId)
        .sort((a, b) => a.attackOrder - b.attackOrder)
        .map((a) => ({
          stars: a.stars,
          destruction: a.destruction,
          target: a.defenderTag ? enemyRef(a.defenderTag) : null,
          alreadyTaken: alreadyTaken.has(key(a)) ? (alreadyTaken.get(key(a)) as number | null) : 0,
        })),
      defences: (hitsOn.get(m.tag) ?? []).sort((a, b) => b.stars - a.stars || b.destruction - a.destruction),
    }))
    .sort((a, b) => (a.base ?? 999) - (b.base ?? 999) || a.name.localeCompare(b.name));

  return { bases, enemyBases: opponents.length || teamSize, defenceKnown };
}

/** One attack of a player's, scored. */
export interface RatedAttack {
  stars: number;
  destruction: number;
  target: BaseRef | null;
  lines: MarkLine[];
  marks: number;
  /** The better of the player's attacks — the one that counts 1.5 times. */
  best: boolean;
}

export interface PlayerWarRating {
  playerId: string;
  tag: string;
  name: string;
  thLevel: number | null;
  base: number | null;
  attacks: RatedAttack[];
  /** "Best attack × 1.5", or null when there is no attack above zero. */
  bonus: MarkLine | null;
  /** Attacks not used, as one line. Null while the war runs, or with none unused. */
  missed: MarkLine | null;
  defence: MarkLine[];
  attackMarks: number;
  defenceMarks: number;
  marks: number;
  /** Their share of the clan's plus marks in this war, as a percentage. */
  share: number;
  /** Average destruction over their attacks, for the month's tie-break. Null with none. */
  destruction: number | null;
  heroicAttack: boolean;
  heroicDefence: boolean;
}

/**
 *   counted      the war is over; its shares are in the month's rating
 *   provisional  battle day; shown, not counted
 *   notStarted   preparation day
 */
export type WarRatingStatus = "counted" | "provisional" | "notStarted";

export interface WarRating {
  status: WarRatingStatus;
  /** No defence marks: the enemy's attacks were never recorded (before 063). */
  attackOnly: boolean;
  /** A base was hit by several of ours and the order was never recorded. */
  orderMissing: boolean;
  /** The marks of everyone above zero, added up — what a share is a share of. */
  total: number;
  players: PlayerWarRating[];
}

const sum = (lines: readonly MarkLine[]) => round1(lines.reduce((t, l) => t + l.marks, 0));

/** A WarBase with one of its attacks, as the shared CWL functions read a base. */
function asDayBase(base: WarBase, attack: DayAttack | null): DayBase {
  return {
    playerId: base.playerId,
    tag: base.tag,
    name: base.name,
    thLevel: base.thLevel,
    base: base.base,
    attack,
    defences: base.defences,
  };
}

/** One war's marks and shares. `state` is the war's stored state. */
export function warRating(board: WarBoard, state: string | null): WarRating {
  if (state === "preparation") {
    return { status: "notStarted", attackOnly: !board.defenceKnown, orderMissing: false, total: 0, players: [] };
  }
  const over = state === "warEnded";

  // The heroic attack is one ATTACK, so every attack stands for itself here.
  const attempts = board.bases.flatMap((base) => base.attacks.map((attack) => asDayBase(base, attack)));
  const heroic = heroicAttack(attempts);
  const bestDefence = board.defenceKnown ? heroicDefence(board.bases.map((b) => asDayBase(b, null))) : null;

  const rows = board.bases.map((base) => {
    const scored = base.attacks.map((attack) => {
      const lines = attackLines(asDayBase(base, attack), over, board.enemyBases, WAR_RULES);
      if (heroic && heroic.playerId === base.playerId && heroic.attack === attack) {
        lines.push({ label: "Heroic attack", marks: CWL_MARKS.heroicAttack });
      }
      return { stars: attack.stars, destruction: attack.destruction, target: attack.target, lines, marks: sum(lines) };
    });

    // The better attack, the first on a tie. Counted 1.5 times only above zero:
    // multiplying a minus would make a bad best attack cost more.
    const top = scored.reduce<number>((best, a, i) => (best < 0 || a.marks > scored[best]!.marks ? i : best), -1);
    const bonus: MarkLine | null =
      top >= 0 && scored[top]!.marks > 0
        ? { label: `Best attack × ${WAR_MARKS.bestAttack}`, marks: round1(scored[top]!.marks * (WAR_MARKS.bestAttack - 1)) }
        : null;

    const unused = Math.max(0, base.attacksAllowed - base.attacks.length);
    const missed: MarkLine | null =
      over && unused > 0
        ? { label: unused === 1 ? "1 attack not used" : `${unused} attacks not used`, marks: unused * WAR_MARKS.missed }
        : null;

    const defence = board.defenceKnown ? defenceLines(asDayBase(base, null), over) : [];
    const isHeroicDefence = bestDefence?.playerId === base.playerId;
    if (isHeroicDefence) defence.push({ label: "Heroic defence", marks: CWL_MARKS.heroicDefence });

    const attackMarks = round1(
      scored.reduce((t, a) => t + a.marks, 0) + (bonus?.marks ?? 0) + (missed?.marks ?? 0),
    );
    const defenceMarks = sum(defence);
    return {
      playerId: base.playerId,
      tag: base.tag,
      name: base.name,
      thLevel: base.thLevel,
      base: base.base,
      attacks: scored.map((a, i): RatedAttack => ({ ...a, best: i === top && bonus !== null })),
      bonus,
      missed,
      defence,
      attackMarks,
      defenceMarks,
      marks: round1(attackMarks + defenceMarks),
      destruction: scored.length ? scored.reduce((t, a) => t + a.destruction, 0) / scored.length : null,
      heroicAttack: heroic?.playerId === base.playerId,
      heroicDefence: isHeroicDefence,
    };
  });

  // Plus marks only, and never worse than the floor — as CWL (DAY % there).
  const total = round1(rows.reduce((t, r) => t + Math.max(0, r.marks), 0));
  return {
    status: over ? "counted" : "provisional",
    attackOnly: !board.defenceKnown,
    orderMissing: board.bases.some((b) => b.attacks.some((a) => a.alreadyTaken === null)),
    total,
    players: rows.map((r) => ({
      ...r,
      share: total > 0 ? Math.max(CWL_MARKS.worstShare, (r.marks / total) * 100) : 0,
    })),
  };
}

/** One war of the month, as the table heads its column. */
export interface RatedWar {
  id: string;
  startTime: string;
  opponentName: string | null;
  status: WarRatingStatus;
  attackOnly: boolean;
  orderMissing: boolean;
  total: number;
}

export interface PlayerMonthRating {
  playerId: string;
  tag: string;
  name: string;
  thLevel: number | null;
  /** One entry per war given, null where they were not in the lineup. */
  wars: Array<PlayerWarRating | null>;
  /** The finished wars' shares added up — the rating. */
  rating: number;
  /** The finished wars' marks added up. */
  marks: number;
  warsCounted: number;
  /** The rating per finished war they were in. Null before their first. */
  perWar: number | null;
  /** Average destruction over their attacks in finished wars. Null with none. */
  averageDestruction: number | null;
  /** The war being fought, when there is one and they are in it. Not in `rating`. */
  provisional: PlayerWarRating | null;
}

export interface MonthWarRating {
  wars: RatedWar[];
  /** Best first: rating, then marks, then average destruction. */
  players: PlayerMonthRating[];
  /** At least one war is counted. */
  started: boolean;
}

export function monthWarRating(
  wars: ReadonlyArray<{
    id: string;
    startTime: string;
    opponentName: string | null;
    state: string | null;
    board: WarBoard;
  }>,
): MonthWarRating {
  const rated = wars.map((w) => warRating(w.board, w.state));
  const byPlayer = new Map<string, PlayerMonthRating & { destroyed: number[] }>();

  rated.forEach((war, index) => {
    for (const p of war.players) {
      const row = byPlayer.get(p.playerId) ?? {
        playerId: p.playerId,
        tag: p.tag,
        name: p.name,
        thLevel: p.thLevel,
        wars: wars.map((): PlayerWarRating | null => null),
        rating: 0,
        marks: 0,
        warsCounted: 0,
        perWar: null,
        averageDestruction: null,
        provisional: null,
        destroyed: [],
      };
      row.wars[index] = p;
      row.name = p.name;
      row.thLevel = p.thLevel ?? row.thLevel;
      if (war.status === "counted") {
        row.rating += p.share;
        row.marks += p.marks;
        row.warsCounted += 1;
        for (const attack of p.attacks) row.destroyed.push(attack.destruction);
      } else if (war.status === "provisional") {
        row.provisional = p;
      }
      byPlayer.set(p.playerId, row);
    }
  });

  const players = [...byPlayer.values()].map(({ destroyed, ...row }): PlayerMonthRating => ({
    ...row,
    marks: round1(row.marks),
    perWar: row.warsCounted ? row.rating / row.warsCounted : null,
    averageDestruction: destroyed.length ? destroyed.reduce((t, v) => t + v, 0) / destroyed.length : null,
  }));

  return {
    wars: rated.map((war, index) => ({
      id: wars[index]!.id,
      startTime: wars[index]!.startTime,
      opponentName: wars[index]!.opponentName,
      status: war.status,
      attackOnly: war.attackOnly,
      orderMissing: war.orderMissing,
      total: war.total,
    })),
    players: players.sort(
      (a, b) =>
        b.rating - a.rating ||
        b.marks - a.marks ||
        (b.averageDestruction ?? -1) - (a.averageDestruction ?? -1) ||
        (b.provisional?.share ?? 0) - (a.provisional?.share ?? 0) ||
        a.name.localeCompare(b.name),
    ),
    started: rated.some((war) => war.status === "counted"),
  };
}
