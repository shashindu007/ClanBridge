// The war rating: the CWL player rating (services/cwl-rating.ts), applied to
// regular wars.
//
// The marks are CWL's, from the same constants and the same functions — a
// 3-star, a Town Hall up, a base held to one star are worth here what they are
// worth there. A regular war differs in these ways, and they are the whole of
// this file:
//
//   TWO ATTACKS   each is scored and the two are added. An attack not used
//                 costs 4, and so does one that takes no star (CWL: 10 — one
//                 failure out of two is not one out of one).
//
//   THE SAME BASE A base is hit by several of ours as a matter of course (7 to
//                 25 bases a war). An attack that adds a star keeps its full
//                 marks — clean-up is the job. One that adds none earns no star
//                 marks and nothing for hitting up.
//
//   BEST ATTACK   Every enemy base that was attacked has ONE best attack: the
//                 most stars, and of several with the same stars, the first —
//                 the second found the base already cleared. That attack counts
//                 1.5 times when it is above zero. It is per enemy base, not per
//                 player: a player can earn it on both attacks, or on neither.
//
//   TARGET RANK   three stars on their last base +1, and +0.1 for each place
//                 higher: their #1 of 40 is +4.9.
//
//   THE PERIOD    there is no week. A player's shares are added over the wars
//                 that started in a calendar month.
//
// WHO WAS FIRST. Two of the rules above turn on the order of attacks. From 063
// the sync keeps the game's own order. A war from before it has none — but each
// attack row was written by the sync that first SAW the attack, and the sync
// runs about hourly, so the time on the row orders most of them: of the 217
// bases hit more than once in the wars stored before 063, it fully orders 133.
// Attacks first seen in the same run cannot be told apart; they are scored as
// if neither had seen the other, and a tie for best attack between them goes to
// the higher destruction, then to the attacker lower on our map.
//
// ATTACK-ONLY WARS. The enemy's attacks are stored from 063 on, and the API
// serves the current war only. A war from before it has no defence marks and no
// heroic defence, and is marked so. A share is a share of ONE war's plus marks,
// so such a war is fair in itself.
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

export const WAR_RULES: AttackRules = {
  sameBase: "fullIfNew",
  // 0 stars costs what an unused attack costs; the rest are CWL's.
  stars: [-4, CWL_MARKS.stars[1], CWL_MARKS.stars[2], CWL_MARKS.stars[3]],
  rankStep: 0.1,
};

export const WAR_MARKS = {
  /** What the best attack on an enemy base is multiplied by, when it is above zero. */
  bestAttack: 1.5,
  /** Per attack not used, once the war is over. */
  missed: -4,
} as const;

/** One of our attacks in a regular war. */
export interface WarAttack extends DayAttack {
  /** The one best attack on the enemy base it hit — see BEST ATTACK above. */
  bestOnBase: boolean;
}

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
  attacks: WarAttack[];
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
  /**
   * False when some enemy base was hit by several of ours and which attack came
   * first could not be told for all of them — see WHO WAS FIRST above.
   */
  orderKnown: boolean;
}

/**
 * When each of several attacks on one base came, as numbers that compare: the
 * game's order where every one of them has it, else the time the sync first
 * saw each. Null when neither covers them all. Equal numbers are attacks that
 * cannot be told apart.
 */
function times(hits: readonly WarRatingAttackRow[]): number[] | null {
  if (hits.every((h) => h.warOrder !== null)) return hits.map((h) => h.warOrder as number);
  if (hits.every((h) => h.seenAt !== null)) return hits.map((h) => Date.parse(h.seenAt as string));
  return null;
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
  const baseOfPlayer = new Map(members.map((m) => [m.playerId, ourBase.get(m.tag) ?? null]));

  // Keyed by the attack itself: the same player has two.
  const key = (a: { playerId: string; attackOrder: number }) => `${a.playerId}:${a.attackOrder}`;
  const onTarget = new Map<string, WarRatingAttackRow[]>();
  for (const attack of attacks) {
    if (!attack.defenderTag) continue;
    const list = onTarget.get(attack.defenderTag) ?? [];
    list.push(attack);
    onTarget.set(attack.defenderTag, list);
  }

  const alreadyTaken = new Map<string, number | null>();
  const best = new Set<string>();
  let orderKnown = true;

  for (const hits of onTarget.values()) {
    const when = hits.length === 1 ? [0] : times(hits);
    if (when === null || new Set(when).size !== when.length) orderKnown = false;

    // What each found already taken: the best result of the attacks before it.
    hits.forEach((hit, i) => {
      if (when === null) {
        alreadyTaken.set(key(hit), null);
        return;
      }
      const before = hits.filter((_, j) => when[j]! < when[i]!).map((h) => h.stars);
      alreadyTaken.set(key(hit), before.length ? Math.max(...before) : 0);
    });

    // The one best attack: the most stars, and the first to get there. Only
    // where "first" cannot be told does anything else decide it.
    const top = Math.max(...hits.map((h) => h.stars));
    const winner = hits
      .map((hit, i) => ({ hit, at: when === null ? 0 : when[i]! }))
      .filter(({ hit }) => hit.stars === top)
      .sort(
        (a, b) =>
          a.at - b.at ||
          b.hit.destruction - a.hit.destruction ||
          (baseOfPlayer.get(b.hit.playerId) ?? 0) - (baseOfPlayer.get(a.hit.playerId) ?? 0) ||
          a.hit.attackOrder - b.hit.attackOrder,
      )[0]!;
    best.add(key(winner.hit));
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
          bestOnBase: best.has(key(a)),
        })),
      defences: (hitsOn.get(m.tag) ?? []).sort((a, b) => b.stars - a.stars || b.destruction - a.destruction),
    }))
    .sort((a, b) => (a.base ?? 999) - (b.base ?? 999) || a.name.localeCompare(b.name));

  return { bases, enemyBases: opponents.length || teamSize, defenceKnown, orderKnown };
}

/** One attack of a player's, scored. */
export interface RatedAttack {
  stars: number;
  destruction: number;
  target: BaseRef | null;
  lines: MarkLine[];
  /** The lines added up, before the bonus. */
  marks: number;
  /** The best attack on its enemy base. */
  best: boolean;
  /** "Best attack on their #5 × 1.5" — only for the best attack, and only above zero. */
  bonus: MarkLine | null;
}

export interface PlayerWarRating {
  playerId: string;
  tag: string;
  name: string;
  thLevel: number | null;
  base: number | null;
  attacks: RatedAttack[];
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
  /** Which of several attacks on a base came first could not be told for all of them. */
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
    const scored = base.attacks.map((attack): RatedAttack => {
      const lines = attackLines(asDayBase(base, attack), over, board.enemyBases, WAR_RULES);
      if (heroic && heroic.playerId === base.playerId && heroic.attack === attack) {
        lines.push({ label: "Heroic attack", marks: CWL_MARKS.heroicAttack });
      }
      const marks = sum(lines);
      // Counted 1.5 times only above zero: multiplying a minus would make the
      // best attack on a base cost more for being the best.
      // Worked in whole tenths, so half of 8.1 is 4.1 every time and never
      // whichever side of 4.05 a float happens to land on.
      const bonus: MarkLine | null =
        attack.bestOnBase && marks > 0
          ? {
              label: `Best attack on their #${attack.target?.base ?? "?"} × ${WAR_MARKS.bestAttack}`,
              marks: Math.round(Math.round(marks * 10) * (WAR_MARKS.bestAttack - 1)) / 10,
            }
          : null;
      return {
        stars: attack.stars,
        destruction: attack.destruction,
        target: attack.target,
        lines,
        marks,
        best: attack.bestOnBase,
        bonus,
      };
    });

    const unused = Math.max(0, base.attacksAllowed - base.attacks.length);
    const missed: MarkLine | null =
      over && unused > 0
        ? { label: unused === 1 ? "1 attack not used" : `${unused} attacks not used`, marks: unused * WAR_MARKS.missed }
        : null;

    const defence = board.defenceKnown ? defenceLines(asDayBase(base, null), over) : [];
    const isHeroicDefence = bestDefence?.playerId === base.playerId;
    if (isHeroicDefence) defence.push({ label: "Heroic defence", marks: CWL_MARKS.heroicDefence });

    const attackMarks = round1(
      scored.reduce((t, a) => t + a.marks + (a.bonus?.marks ?? 0), 0) + (missed?.marks ?? 0),
    );
    const defenceMarks = sum(defence);
    return {
      playerId: base.playerId,
      tag: base.tag,
      name: base.name,
      thLevel: base.thLevel,
      base: base.base,
      attacks: scored,
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
    orderMissing: !board.orderKnown,
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
