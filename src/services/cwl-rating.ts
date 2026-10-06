// The CWL player rating: marks for every attack and every defence, turned into
// each player's share of the clan's marks for the day, and the shares added up
// over the week.
//
// The clan set these rules; this file is the one place they are written down.
// CWL_MARKS holds every number, and the page that explains the rating prints
// from the same constants, so the explanation cannot drift from the sums.
//
//   ATTACK   3★ +5 · 2★ +1 · 1★ −3 · 0★ −10 · no attack −10
//            2★ with 90% or more +1
//            Town Hall:  each level above their own +3 (2★ or more)
//                        the same +1 · each level below −1
//            War map:    each base above their own +1 (2★ or more)
//                        their mirror, or any base above it, +1
//                        each base below −1
//                        — never more than +10 for bases up, nor more
//                          than −2 for bases below: a top base sent down
//                          to clean up is doing a job, not dodging one
//            Their map:  3★ on their last base +1, and +0.3 for each place
//                        higher — their #1 of 15 is +5.2. Everything above
//                        measures a target against the attacker; this is
//                        the target itself, so a mirror at #1 is worth more
//                        than a mirror at #15.
//            Falling short away from the mirror, on top of the stars:
//                        hitting up    2★ −2 (under 2★ the up marks are
//                                      already lost, and that is the cost)
//                        hitting down  2★ −3 · 1★ −6 · 0★ −10
//            the day's heroic attack +4
//
//   NEW STARS ONLY. A base a clanmate already hit gave the clan its best result
//   once. So a 2★ or 3★ loses a mark for each star already taken (3★ on a base
//   already at 2★ is 5 − 2 = +3), and one that adds no new star earns no star
//   marks and nothing for hitting up. A 1★ or 0★ is what it always was.
//
//   DEFENCE  the enemy's BEST hit on the base, the one that scores in the war:
//            held to 0★ +10 · 1★ +5 · 2★ +3 · 3★ 0
//            3-starred by an enemy lower on the map −2
//            not attacked +2, once the day is over — a base the enemy chose
//            to leave alone held as surely as one they failed on
//            the day's heroic defence +5
//
//   HEROIC   one attack and one defence per clan per day, as the game shows
//            them. The API does not say which — an attack carries stars,
//            destruction, order and duration and nothing else — so they are
//            chosen here, by the comparisons in heroicAttack / heroicDefence.
//
//   DAY %    a player's marks ÷ the clan's PLUS marks that day — the marks
//            of everyone who finished above zero. Minus marks are left out of
//            what is divided by: inside it they shrank it, so one player's
//            bad day pushed every other share up, past 100% on a day bad
//            enough. Now the plus shares add up to exactly 100.
//            A minus day is a minus share, never worse than −100%. A day
//            nobody finished above zero counts 0.
//
//   SEASON   the day shares added up — FINISHED days only. A running day is
//            worked out the same way and shown as provisional: early on, three
//            attackers would each hold a third of the clan's marks.
//
// DERIVED, NEVER STORED, like missed attacks (002) and defence (057): it is a
// reading of the attacks already kept, and a stored copy would be a second
// source that could disagree with them. 061 keeps the purge off its inputs.
//
// A day whose enemy lineup was never recorded cannot be rated — no base
// numbers, no Town Halls, no defence — and counts for nothing rather than
// being rated on stars alone and compared with days that were rated in full.

import type { DayBase, DayBoard } from "@/services/cwl-day";

export const CWL_MARKS = {
  /** By stars taken, 0 to 3. */
  stars: [-10, -3, 1, 5],
  /** In the lineup of a finished day, and did not attack. */
  missed: -10,
  /** Two stars that came this close to three. */
  nearMiss: { stars: 2, destruction: 90, marks: 1 },

  /** Per Town Hall level the target stood above the attacker's own. */
  thUp: 3,
  sameTh: 1,
  /** Per Town Hall level the target stood below the attacker's own. */
  thBelow: -1,

  /** Per base the target stood above the attacker's own on the map. */
  baseUp: 1,
  /**
   * For not hitting down: their mirror, or any base above it. Whatever the
   * result — it is for where the attack was aimed. It used to be the mirror
   * alone, which left a player who reached nine bases up a mark short of one
   * who stayed level.
   */
  mirror: 1,
  /** Per base the target stood below the attacker's own. */
  baseBelow: -1,
  /** The most the map can give, so a position never outweighs the stars. */
  baseUpCap: 10,
  /**
   * The most it can take. Lower than what it gives, on purpose: a top base is
   * often SENT to a low one to secure the stars, and −10 for following the
   * plan cost more than three stars earn.
   */
  baseBelowCap: 2,
  /**
   * Not finishing the job, by stars taken (0 to 3), on top of the stars' own
   * marks. Reaching for a higher base and stopping at two stars costs a
   * little — and nothing more below that, where the up marks are not given at
   * all, which is the cost already. Dropping to a lower base and still not
   * clearing it costs more, the worse the result.
   */
  shortUp: [0, 0, -2, 0],
  shortDown: [-10, -6, -3, 0],
  /**
   * How high the target sits on THEIR map, whoever attacked it: `last` for
   * their bottom base and `step` more for each place above it. Only for a
   * base cleared — three stars.
   *
   * The step is per base, not per share of the lineup, so a 30-base war's #1
   * is worth more than a 15-base war's. The clan chose that.
   */
  targetRank: { last: 1, step: 0.3, needsStars: 3 },

  /** The up marks, and the heroic attack, are only for at least this many stars. */
  upNeedsStars: 2,
  heroicAttack: 4,

  /** By the stars the enemy's best hit took, 0 to 3. */
  defence: [10, 5, 3, 0],
  /** 3-starred by an enemy whose base is lower on the map than the defender's. */
  tripledFromBelow: -2,
  /** In the lineup of a finished day, and no enemy attacked the base. */
  notAttacked: 2,
  heroicDefence: 5,

  /**
   * The worst a single day's share can be, as a percentage. The plus side
   * cannot pass 100; without this the minus side could, on a day the clan's
   * plus marks were few, and one such day would cost a player the month.
   */
  worstShare: -100,
} as const;

/** "without 3 stars", "without 2 stars", "without a star" — what a short result lacked. */
function lacking(stars: number): string {
  return stars === 0 ? "without a star" : `without ${stars + 1} stars`;
}

/** One line of the sum, in words, so a row can show where its marks came from. */
export interface MarkLine {
  label: string;
  marks: number;
}

export interface PlayerDayRating {
  playerId: string;
  tag: string;
  name: string;
  thLevel: number | null;
  /** Their base number on the war map that day. */
  base: number | null;
  attack: MarkLine[];
  defence: MarkLine[];
  attackMarks: number;
  defenceMarks: number;
  marks: number;
  /** Their share of the clan's marks that day, as a percentage. */
  share: number;
  /** Their attack's destruction, for the season's tie-break. Null without an attack. */
  destruction: number | null;
  heroicAttack: boolean;
  heroicDefence: boolean;
}

/**
 *   counted      the day is over; its shares are in the season rating
 *   provisional  the day is running; shown, not counted
 *   notStarted   preparation day
 *   notRated     the enemy lineup was never recorded
 */
export type DayRatingStatus = "counted" | "provisional" | "notStarted" | "notRated";

export interface DayRating {
  status: DayRatingStatus;
  /**
   * The marks of everyone who finished the day above zero, added up — what a
   * share is a share of. Minus marks are not in it.
   */
  total: number;
  /** In map order. Empty unless counted or provisional. */
  players: PlayerDayRating[];
  /**
   * A base was hit more than once and the order of those attacks was never
   * recorded (062), so each was rated as a first hit.
   */
  orderMissing: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/**
 * Marks to one decimal. The target-rank steps are tenths, and tenths added in
 * binary drift — 12.2 arrives as 12.200000000000001 — so every sum is rounded
 * back to the one decimal the rules are written in.
 */
const round1 = (n: number) => Math.round(n * 10) / 10;
const sum = (lines: MarkLine[]) => round1(lines.reduce((t, l) => t + l.marks, 0));

/**
 * The lines for one player's attack. `over` — the day has ended, so no attack
 * is a miss. `enemyBases` — how many bases the enemy fielded, for the target's
 * rank; null when not known, and the rank line is then left out.
 */
export function attackLines(base: DayBase, over: boolean, enemyBases: number | null = null): MarkLine[] {
  const attack = base.attack;
  if (!attack) return over ? [{ label: "Did not attack", marks: CWL_MARKS.missed }] : [];

  const table = CWL_MARKS.stars[attack.stars] ?? 0;
  const taken = attack.alreadyTaken ?? 0;
  // New stars only — for a result worth having. A 1★ or 0★ is scored as it
  // always was: failing a base someone already opened is no better.
  const good = attack.stars >= CWL_MARKS.upNeedsStars;
  const nothingNew = good && taken >= attack.stars;
  const lines: MarkLine[] = [];

  if (nothingNew) {
    lines.push({ label: `${plural(attack.stars, "star")}, none new`, marks: 0 });
  } else if (good && taken > 0) {
    lines.push({
      label: `${plural(attack.stars, "star")}, ${taken} already taken`,
      marks: table - taken,
    });
  } else {
    lines.push({ label: plural(attack.stars, "star"), marks: table });
  }

  const { nearMiss } = CWL_MARKS;
  if (attack.stars === nearMiss.stars && attack.destruction >= nearMiss.destruction && !nothingNew) {
    lines.push({ label: `${nearMiss.destruction}% or more`, marks: nearMiss.marks });
  }

  // Hitting up is paid for a result, and for a result the clan did not have.
  const earnedUp = good && !nothingNew;
  const unearned = nothingNew ? "no new star" : `under ${CWL_MARKS.upNeedsStars} stars`;
  const target = attack.target;

  if (target && target.base !== null && base.base !== null) {
    const up = base.base - target.base;
    const cap = up > 0 ? CWL_MARKS.baseUpCap : CWL_MARKS.baseBelowCap;
    const capped = Math.min(Math.abs(up), cap);
    const limit = Math.abs(up) > cap ? `, counted as ${cap}` : "";
    if (up > 0) {
      lines.push(
        earnedUp
          ? { label: `${plural(up, "base")} up${limit}`, marks: capped * CWL_MARKS.baseUp }
          : { label: `${plural(up, "base")} up, ${unearned}`, marks: 0 },
      );
      lines.push({ label: "Mirror or above", marks: CWL_MARKS.mirror });
    } else if (up === 0) {
      lines.push({ label: "Mirror", marks: CWL_MARKS.mirror });
    } else {
      lines.push({ label: `${plural(-up, "base")} below${limit}`, marks: capped * CWL_MARKS.baseBelow });
    }

    // Falling short away from the mirror, on the attack's own stars: what a
    // clanmate took before does not make a 2★ any more of a 3★.
    const short = (up > 0 ? CWL_MARKS.shortUp : CWL_MARKS.shortDown)[attack.stars] ?? 0;
    if (up !== 0 && short !== 0) {
      lines.push({ label: `Hitting ${up > 0 ? "up" : "down"} ${lacking(attack.stars)}`, marks: short });
    }
  }

  // How high the target sits on their map — for a base cleared, and cleared
  // for the clan: a third star on a base already tripled is no harder a base.
  const rank = CWL_MARKS.targetRank;
  if (
    target &&
    target.base !== null &&
    enemyBases !== null &&
    attack.stars >= rank.needsStars &&
    !nothingNew
  ) {
    const placesUp = Math.max(0, enemyBases - target.base);
    lines.push({
      label: `Their #${target.base} of ${enemyBases}`,
      marks: round1(rank.last + rank.step * placesUp),
    });
  }

  if (target && target.thLevel !== null && base.thLevel !== null) {
    const up = target.thLevel - base.thLevel;
    if (up > 0) {
      lines.push(
        earnedUp
          ? { label: `${up} TH up`, marks: up * CWL_MARKS.thUp }
          : { label: `${up} TH up, ${unearned}`, marks: 0 },
      );
    } else if (up === 0) {
      lines.push({ label: "Same TH", marks: CWL_MARKS.sameTh });
    } else {
      lines.push({ label: `${-up} TH below`, marks: -up * CWL_MARKS.thBelow });
    }
  }
  return lines;
}

/**
 * The lines for one player's base in defence. `over` — the day has ended, so
 * a base nobody attacked was left alone for good. While the day runs it is
 * only "not attacked yet", and scores nothing, as an unused attack costs
 * nothing yet.
 */
export function defenceLines(base: DayBase, over: boolean): MarkLine[] {
  // dayBoard() puts the hit that scores first.
  const best = base.defences[0];
  if (!best) return over ? [{ label: "Not attacked", marks: CWL_MARKS.notAttacked }] : [];

  const lines: MarkLine[] = [
    {
      label: best.stars === 3 ? "3-starred" : `Held to ${plural(best.stars, "star")}`,
      marks: CWL_MARKS.defence[best.stars] ?? 0,
    },
  ];
  const ownBase = base.base;
  const fromBelow =
    ownBase === null
      ? undefined
      : base.defences.find((d) => d.stars === 3 && d.by.base !== null && d.by.base > ownBase);
  if (fromBelow) {
    lines.push({ label: `By their #${fromBelow.by.base}, a lower base`, marks: CWL_MARKS.tripledFromBelow });
  }
  return lines;
}

/**
 * The day's heroic attack: the most stars, then the furthest above their own
 * Town Hall, then the furthest up the map, then the most destruction.
 *
 * It has to be a result — at least two stars — and one the clan did not
 * already have. A day whose best attack was one star has no heroic attack.
 */
export function heroicAttack(bases: readonly DayBase[]): DayBase | null {
  const thUp = (b: DayBase) =>
    b.attack?.target?.thLevel != null && b.thLevel !== null ? b.attack.target.thLevel - b.thLevel : 0;
  const mapUp = (b: DayBase) =>
    b.attack?.target?.base != null && b.base !== null ? b.base - b.attack.target.base : 0;

  const eligible = bases.filter((b) => {
    const attack = b.attack;
    return (
      !!attack &&
      attack.stars >= CWL_MARKS.upNeedsStars &&
      (attack.alreadyTaken ?? 0) < attack.stars
    );
  });
  return (
    eligible.sort(
      (a, b) =>
        b.attack!.stars - a.attack!.stars ||
        thUp(b) - thUp(a) ||
        mapUp(b) - mapUp(a) ||
        b.attack!.destruction - a.attack!.destruction ||
        (a.base ?? 99) - (b.base ?? 99),
    )[0] ?? null
  );
}

/**
 * The day's heroic defence: the fewest stars given, then the least destruction,
 * then against the strongest attacker — the highest Town Hall over the
 * defender's own, then the highest on the map.
 *
 * Judged on the enemy's best hit, like every defence. A 3-starred base cannot
 * be heroic, and a base nobody attacked defended nothing.
 */
export function heroicDefence(bases: readonly DayBase[]): DayBase | null {
  const best = (b: DayBase) => b.defences[0]!;
  const thOver = (b: DayBase) => {
    const by = best(b).by.thLevel;
    return by !== null && b.thLevel !== null ? by - b.thLevel : 0;
  };
  return (
    bases
      .filter((b) => b.defences.length > 0 && best(b).stars < 3)
      .sort(
        (a, b) =>
          best(a).stars - best(b).stars ||
          best(a).destruction - best(b).destruction ||
          thOver(b) - thOver(a) ||
          (best(a).by.base ?? 99) - (best(b).by.base ?? 99) ||
          (a.base ?? 99) - (b.base ?? 99),
      )[0] ?? null
  );
}

/**
 * One day's marks and shares.
 *
 * `state` is the war day's stored state; `final` is true once the season has
 * ended, so a day the sync never saw finish still counts instead of staying
 * "running" for ever.
 */
export function dayRating(board: DayBoard, state: string | null, final = false): DayRating {
  if (state === "preparation") return { status: "notStarted", total: 0, players: [], orderMissing: false };
  if (!board.enemyKnown) return { status: "notRated", total: 0, players: [], orderMissing: false };

  const over = state === "warEnded" || final;
  const bestAttack = heroicAttack(board.bases);
  const bestDefence = heroicDefence(board.bases);

  const rows = board.bases.map((base) => {
    const isHeroicAttack = bestAttack?.playerId === base.playerId;
    const isHeroicDefence = bestDefence?.playerId === base.playerId;
    const attack = attackLines(base, over, board.theirs.of);
    const defence = defenceLines(base, over);
    if (isHeroicAttack) attack.push({ label: "Heroic attack", marks: CWL_MARKS.heroicAttack });
    if (isHeroicDefence) defence.push({ label: "Heroic defence", marks: CWL_MARKS.heroicDefence });
    const attackMarks = sum(attack);
    const defenceMarks = sum(defence);
    return {
      playerId: base.playerId,
      tag: base.tag,
      name: base.name,
      thLevel: base.thLevel,
      base: base.base,
      attack,
      defence,
      attackMarks,
      defenceMarks,
      marks: round1(attackMarks + defenceMarks),
      destruction: base.attack?.destruction ?? null,
      heroicAttack: isHeroicAttack,
      heroicDefence: isHeroicDefence,
    };
  });

  // Plus marks only. See DAY % at the top of the file.
  const total = round1(rows.reduce((t, r) => t + Math.max(0, r.marks), 0));
  return {
    status: over ? "counted" : "provisional",
    total,
    // Nobody above zero: there are no shares to hand out, and the day counts 0.
    players: rows.map((r) => ({
      ...r,
      share: total > 0 ? Math.max(CWL_MARKS.worstShare, (r.marks / total) * 100) : 0,
    })),
    orderMissing: board.bases.some((b) => b.attack?.alreadyTaken === null),
  };
}

export interface RatedDay {
  dayNumber: number | null;
  status: DayRatingStatus;
  total: number;
  orderMissing: boolean;
}

export interface PlayerSeasonRating {
  playerId: string;
  tag: string;
  name: string;
  thLevel: number | null;
  /** One entry per day given, null where they were not in a rated lineup. */
  days: Array<PlayerDayRating | null>;
  /** The finished days' shares added up — the rating. */
  rating: number;
  /** The finished days' marks added up. */
  marks: number;
  daysCounted: number;
  /**
   * The rating per finished day they were fielded. The rating is a sum, so
   * seven days always outweigh four; this is the two compared like for like.
   * Null before their first finished day.
   */
  perDay: number | null;
  /** Average destruction over their attacks on finished days. Null with none. */
  averageDestruction: number | null;
  /** The running day, when there is one and they are in it. Not in `rating`. */
  provisional: PlayerDayRating | null;
}

export interface SeasonRating {
  days: RatedDay[];
  /** Best first: rating, then marks, then average destruction. */
  players: PlayerSeasonRating[];
  /** At least one day is counted — otherwise every rating is still 0. */
  started: boolean;
}

export function seasonRating(
  days: ReadonlyArray<{ dayNumber: number | null; state: string | null; board: DayBoard }>,
  final = false,
): SeasonRating {
  const rated = days.map((d) => dayRating(d.board, d.state, final));
  const byPlayer = new Map<string, PlayerSeasonRating & { destroyed: number[] }>();

  rated.forEach((day, index) => {
    for (const p of day.players) {
      const row = byPlayer.get(p.playerId) ?? {
        playerId: p.playerId,
        tag: p.tag,
        name: p.name,
        thLevel: p.thLevel,
        days: days.map((): PlayerDayRating | null => null),
        rating: 0,
        marks: 0,
        daysCounted: 0,
        perDay: null,
        averageDestruction: null,
        provisional: null,
        destroyed: [],
      };
      row.days[index] = p;
      row.name = p.name;
      row.thLevel = p.thLevel ?? row.thLevel;
      if (day.status === "counted") {
        row.rating += p.share;
        row.marks += p.marks;
        row.daysCounted += 1;
        if (p.destruction !== null) row.destroyed.push(p.destruction);
      } else if (day.status === "provisional") {
        row.provisional = p;
      }
      byPlayer.set(p.playerId, row);
    }
  });

  const players = [...byPlayer.values()].map(({ destroyed, ...row }): PlayerSeasonRating => ({
    ...row,
    marks: round1(row.marks),
    perDay: row.daysCounted ? row.rating / row.daysCounted : null,
    averageDestruction: destroyed.length ? destroyed.reduce((t, v) => t + v, 0) / destroyed.length : null,
  }));

  return {
    days: rated.map((day, index) => ({
      dayNumber: days[index]!.dayNumber,
      status: day.status,
      total: day.total,
      orderMissing: day.orderMissing,
    })),
    players: players.sort(
      (a, b) =>
        b.rating - a.rating ||
        b.marks - a.marks ||
        (b.averageDestruction ?? -1) - (a.averageDestruction ?? -1) ||
        (b.provisional?.share ?? 0) - (a.provisional?.share ?? 0) ||
        a.name.localeCompare(b.name),
    ),
    started: rated.some((day) => day.status === "counted"),
  };
}

/** "+5", "+12.2", "−3", "0" — marks as a row prints them: one decimal only where there is one. */
export function signed(marks: number): string {
  const value = round1(marks);
  const size = Math.abs(value);
  const text = Number.isInteger(size) ? String(size) : size.toFixed(1);
  if (value > 0) return `+${text}`;
  return value < 0 ? `−${text}` : "0";
}

/**
 * A share or a rating to one decimal, with a real minus sign like signed() and
 * never "−0.0".
 */
export function oneDecimal(value: number): string {
  const text = value.toFixed(1);
  if (text === "-0.0") return "0.0";
  return text.startsWith("-") ? `−${text.slice(1)}` : text;
}
