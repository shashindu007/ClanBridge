// The CWL player rating: marks for every attack and every defence, turned into
// each player's share of the clan's marks for the day, and the shares added up
// over the week.
//
// The clan set these rules; this file is the one place they are written down.
// CWL_MARKS holds every number, and the page that explains the rating prints
// from the same constants, so the explanation cannot drift from the sums.
//
//   ATTACK   3★ +5 · 2★ +1 · 1★ −3 · 0★ −10 · no attack −10
//            a higher Town Hall than their own   +3 a level   } only with
//            a base higher on the map than theirs +1 a base   } 2 stars or more
//            their mirror +1 · a base below their own −1 (flat)
//            the same Town Hall +1 · a lower one nothing
//
//   DEFENCE  the enemy's BEST hit on the base, the one that scores in the war:
//            held to 0★ +10 · 1★ +5 · 2★ +3 · 3★ 0
//            3-starred by an enemy lower on the map −2 · not attacked 0
//
//   DAY %    a player's marks ÷ everyone's marks that day. A minus day is a
//            minus share; a day the whole clan ends at 0 or less counts 0.
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
  /** Per Town Hall level the target stood above the attacker's own. */
  thUp: 3,
  /** Per base the target stood above the attacker's own on the map. */
  baseUp: 1,
  /** The up marks are given only for at least this many stars. */
  upNeedsStars: 2,
  mirror: 1,
  /** Flat, however far below. */
  baseBelow: -1,
  sameTh: 1,
  /** By the stars the enemy's best hit took, 0 to 3. */
  defence: [10, 5, 3, 0],
  /** 3-starred by an enemy whose base is lower on the map than the defender's. */
  tripledFromBelow: -2,
} as const;

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
  /** Everyone's marks added up — what a share is a share of. */
  total: number;
  /** In map order. Empty unless counted or provisional. */
  players: PlayerDayRating[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const sum = (lines: MarkLine[]) => lines.reduce((t, l) => t + l.marks, 0);

/** The lines for one player's attack. `over` — the day has ended, so no attack is a miss. */
export function attackLines(base: DayBase, over: boolean): MarkLine[] {
  const attack = base.attack;
  if (!attack) return over ? [{ label: "Did not attack", marks: CWL_MARKS.missed }] : [];

  const lines: MarkLine[] = [
    { label: plural(attack.stars, "star"), marks: CWL_MARKS.stars[attack.stars] ?? 0 },
  ];
  const earnedUp = attack.stars >= CWL_MARKS.upNeedsStars;
  const target = attack.target;

  if (target && target.base !== null && base.base !== null) {
    const up = base.base - target.base;
    if (up > 0) {
      lines.push(
        earnedUp
          ? { label: `${plural(up, "base")} up`, marks: up * CWL_MARKS.baseUp }
          : { label: `${plural(up, "base")} up, under ${CWL_MARKS.upNeedsStars} stars`, marks: 0 },
      );
    } else if (up === 0) {
      lines.push({ label: "Mirror", marks: CWL_MARKS.mirror });
    } else {
      lines.push({ label: "Base below", marks: CWL_MARKS.baseBelow });
    }
  }

  if (target && target.thLevel !== null && base.thLevel !== null) {
    const up = target.thLevel - base.thLevel;
    if (up > 0) {
      lines.push(
        earnedUp
          ? { label: `${up} TH up`, marks: up * CWL_MARKS.thUp }
          : { label: `${up} TH up, under ${CWL_MARKS.upNeedsStars} stars`, marks: 0 },
      );
    } else if (up === 0) {
      lines.push({ label: "Same TH", marks: CWL_MARKS.sameTh });
    }
  }
  return lines;
}

/** The lines for one player's base in defence. Empty when nobody attacked it. */
export function defenceLines(base: DayBase): MarkLine[] {
  // dayBoard() puts the hit that scores first.
  const best = base.defences[0];
  if (!best) return [];

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
 * One day's marks and shares.
 *
 * `state` is the war day's stored state; `final` is true once the season has
 * ended, so a day the sync never saw finish still counts instead of staying
 * "running" for ever.
 */
export function dayRating(board: DayBoard, state: string | null, final = false): DayRating {
  if (state === "preparation") return { status: "notStarted", total: 0, players: [] };
  if (!board.enemyKnown) return { status: "notRated", total: 0, players: [] };

  const over = state === "warEnded" || final;
  const rows = board.bases.map((base) => {
    const attack = attackLines(base, over);
    const defence = defenceLines(base);
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
      marks: attackMarks + defenceMarks,
    };
  });

  const total = rows.reduce((t, r) => t + r.marks, 0);
  return {
    status: over ? "counted" : "provisional",
    total,
    // A clan total of 0 or less has no shares to hand out: the day counts 0.
    players: rows.map((r) => ({ ...r, share: total > 0 ? (r.marks / total) * 100 : 0 })),
  };
}

export interface RatedDay {
  dayNumber: number | null;
  status: DayRatingStatus;
  total: number;
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
  /** The running day, when there is one and they are in it. Not in `rating`. */
  provisional: PlayerDayRating | null;
}

export interface SeasonRating {
  days: RatedDay[];
  /** Best first: rating, then marks, then the running day's share. */
  players: PlayerSeasonRating[];
  /** At least one day is counted — otherwise every rating is still 0. */
  started: boolean;
}

export function seasonRating(
  days: ReadonlyArray<{ dayNumber: number | null; state: string | null; board: DayBoard }>,
  final = false,
): SeasonRating {
  const rated = days.map((d) => dayRating(d.board, d.state, final));
  const byPlayer = new Map<string, PlayerSeasonRating>();

  rated.forEach((day, index) => {
    for (const p of day.players) {
      const row: PlayerSeasonRating = byPlayer.get(p.playerId) ?? {
        playerId: p.playerId,
        tag: p.tag,
        name: p.name,
        thLevel: p.thLevel,
        days: days.map(() => null),
        rating: 0,
        marks: 0,
        daysCounted: 0,
        provisional: null,
      };
      row.days[index] = p;
      row.name = p.name;
      row.thLevel = p.thLevel ?? row.thLevel;
      if (day.status === "counted") {
        row.rating += p.share;
        row.marks += p.marks;
        row.daysCounted += 1;
      } else if (day.status === "provisional") {
        row.provisional = p;
      }
      byPlayer.set(p.playerId, row);
    }
  });

  return {
    days: rated.map((day, index) => ({
      dayNumber: days[index]!.dayNumber,
      status: day.status,
      total: day.total,
    })),
    players: [...byPlayer.values()].sort(
      (a, b) =>
        b.rating - a.rating ||
        b.marks - a.marks ||
        (b.provisional?.share ?? 0) - (a.provisional?.share ?? 0) ||
        a.name.localeCompare(b.name),
    ),
    started: rated.some((day) => day.status === "counted"),
  };
}

/** "+5", "−3", "0" — marks as a row prints them. */
export function signed(marks: number): string {
  if (marks > 0) return `+${marks}`;
  return marks < 0 ? `−${Math.abs(marks)}` : "0";
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
