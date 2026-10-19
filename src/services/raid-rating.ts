// The raid rating: marks for every raid attack and for each player's weekend,
// turned into each player's share of the clan's marks for the weekend, and the
// shares added up over the month.
//
// The clan set these rules; this file is the one place they are written down.
// RAID_MARKS holds every number, and the page that explains the rating prints
// from the same constants, so the explanation cannot drift from the sums.
//
//   EACH ATTACK
//            destruction   +1.00 for every 100% of a district it destroyed
//                          (38% is +0.38) — its OWN share, see SHARE below
//            finished      +0.50 for the attack that took the district to 100%
//            solo clear    +3.00 more for 0% to 100% in one attack
//            big hit       +0.50 for 40% or more of a district in one attack,
//                          +1.00 for 50% or more (the higher one only)
//            weak          −2.00 for less than 20%, unless it finished the
//                          district — a small clean-up that finishes is the job
//            league        +0.10 per step of the raided clan's capital league:
//                          Bronze League III +0.10 … Legend League +2.20
//
//   EACH PLAYER, ONCE A WEEKEND
//            capital gold  +1.00 for every 10,000 looted (28,732 is +2.87)
//            unused        −4.00 for each attack not used, once the weekend is
//                          over — only for a player who attacked at least once.
//                          A player who never attacked gets nothing either way.
//
//   SHARE    The API gives a district's destruction AFTER each attack. One
//            attack's own share is that minus the attack before it on the
//            same district: 0→38 is 38, then 38→78 is 40, then 78→100 is 22.
//
//   WEEKEND %  a player's marks ÷ the clan's PLUS marks that weekend — the
//            marks of everyone who finished above zero, as the CWL and war
//            ratings. Plus shares add up to 100; a minus total is a minus
//            share, never worse than −100%.
//
//   MONTH    the weekend shares added up, over the weekends that STARTED in
//            the month — finished weekends only. The weekend being raided is
//            worked out the same way and shown beside it as provisional.
//
// NOT RATED. The API sends who attacked what for the latest weekend only. A
// weekend whose attacks were never captured (064) has its totals and nothing
// to mark, and counts for nothing rather than being rated on loot alone.
//
// DERIVED, NEVER STORED, like the war and CWL ratings: it is a reading of the
// attacks already kept, and a stored copy would be a second source that could
// disagree with them.

import type { RaidAttackRow, RaidOpponentRow, RaidParticipantRow } from "@/repositories/raids";
import type { MarkLine } from "@/services/cwl-rating";
import { attacksOwed } from "@/services/raids";

export const RAID_MARKS = {
  /** For destroying 100% of a district; any share is this in proportion. */
  fullDistrict: 1,
  /** The attack that took the district to 100%. */
  finished: 0.5,
  /** On top of finishing, for taking a district from 0% to 100% in one attack. */
  soloClear: 3,
  /** By the share one attack destroyed, highest first: only the first step reached counts. */
  bigHit: [
    { from: 50, marks: 1 },
    { from: 40, marks: 0.5 },
  ],
  /** An attack below this share, that did not finish the district. */
  weak: { under: 20, marks: -2 },
  /** Per step of the raided clan's capital league — see LEAGUES. */
  leagueStep: 0.1,
  /** Capital gold over the weekend: `marks` for every `per`. */
  gold: { per: 10_000, marks: 1 },
  /** Per attack not used, once the weekend is over, by a player who attacked at all. */
  unused: -4,
  /** A weekend share is never worse than this. */
  worstShare: -100,
} as const;

/**
 * The Clan Capital leagues, lowest first. A league's step is its place here
 * plus one, and is also its API id less 85000000: Bronze League III is
 * 85000001, Legend League 85000022.
 */
export const LEAGUES = [
  "Bronze League III",
  "Bronze League II",
  "Bronze League I",
  "Silver League III",
  "Silver League II",
  "Silver League I",
  "Gold League III",
  "Gold League II",
  "Gold League I",
  "Crystal League III",
  "Crystal League II",
  "Crystal League I",
  "Master League III",
  "Master League II",
  "Master League I",
  "Champion League III",
  "Champion League II",
  "Champion League I",
  "Titan League III",
  "Titan League II",
  "Titan League I",
  "Legend League",
] as const;

const LEAGUE_ID_BASE = 85_000_000;

/** Marks to two decimals: 0.1 × 9 is 0.9, not 0.9000000000000001. */
export const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (lines: readonly MarkLine[]) => round2(lines.reduce((t, l) => t + l.marks, 0));

/**
 * A league's step, 1 (Bronze League III) to 22 (Legend League), or 0 when it
 * is unknown or Unranked. Read from the id, and from the name when the id is
 * missing — the id is what the API promises to keep.
 */
export function leagueStep(id: number | null, name: string | null): number {
  if (id !== null) {
    const step = id - LEAGUE_ID_BASE;
    return step >= 1 && step <= LEAGUES.length ? step : 0;
  }
  const index = name ? LEAGUES.indexOf(name as (typeof LEAGUES)[number]) : -1;
  return index + 1;
}

/** One attack's marks, from its own share and what the district stood at before it. */
export function attackLines(attack: {
  /** The district's destruction before this attack. */
  before: number;
  /** And after it. */
  after: number;
  /** The raided clan's league step, 0 when unknown. */
  league: number;
  leagueName?: string | null;
}): MarkLine[] {
  const share = Math.max(0, attack.after - attack.before);
  const finished = attack.after >= 100 && attack.before < 100;
  const lines: MarkLine[] = [
    { label: `Destroyed ${share}%`, marks: round2((share / 100) * RAID_MARKS.fullDistrict) },
  ];

  if (finished) lines.push({ label: "Finished the district", marks: RAID_MARKS.finished });
  if (finished && attack.before === 0) lines.push({ label: "Solo clear", marks: RAID_MARKS.soloClear });

  const big = RAID_MARKS.bigHit.find((step) => share >= step.from);
  if (big) lines.push({ label: `${big.from}% or more in one attack`, marks: big.marks });

  if (share < RAID_MARKS.weak.under && !finished) {
    lines.push({ label: `Under ${RAID_MARKS.weak.under}%`, marks: RAID_MARKS.weak.marks });
  }

  if (attack.league > 0) {
    lines.push({
      label: attack.leagueName ?? LEAGUES[attack.league - 1]!,
      marks: round2(attack.league * RAID_MARKS.leagueStep),
    });
  }
  return lines;
}

/** One attack of a player's, scored. */
export interface RatedRaidAttack {
  raidNumber: number;
  opponentName: string | null;
  districtName: string | null;
  districtHallLevel: number | null;
  attackNumber: number;
  /** What this attack itself destroyed, 0 to 100. */
  share: number;
  /** The district after it. */
  after: number;
  finished: boolean;
  lines: MarkLine[];
  marks: number;
}

export interface PlayerRaidWeekend {
  playerId: string;
  tag: string;
  name: string;
  attacks: RatedRaidAttack[];
  /** Attacks used, as the API counts them; falls back to the attacks kept. */
  used: number;
  /** Attacks offered (limit + bonus), or null when the limit is unknown. */
  offered: number | null;
  loot: number;
  /** The once-a-weekend lines: capital gold, attacks not used. */
  weekendLines: MarkLine[];
  attackMarks: number;
  marks: number;
  /** Their share of the clan's plus marks this weekend, as a percentage. */
  share: number;
}

/**
 *   counted      the weekend is over; its shares are in the month's rating
 *   provisional  the weekend is being raided; shown, not counted
 *   notRated     its attacks were never captured — see NOT RATED above
 */
export type RaidWeekendStatus = "counted" | "provisional" | "notRated";

export interface RaidWeekendRating {
  status: RaidWeekendStatus;
  /** The marks of everyone above zero, added up — what a share is a share of. */
  total: number;
  /** Best first. */
  players: PlayerRaidWeekend[];
}

/** One weekend's marks and shares. */
export function raidWeekendRating(input: {
  state: string | null;
  /** raid_seasons.attacks_captured_at is set. */
  captured: boolean;
  participants: readonly RaidParticipantRow[];
  attacks: readonly RaidAttackRow[];
  opponents: readonly RaidOpponentRow[];
}): RaidWeekendRating {
  if (!input.captured) return { status: "notRated", total: 0, players: [] };
  const over = input.state !== "ongoing";

  const opponents = new Map(input.opponents.map((o) => [o.raidNumber, o]));

  // Each district's attacks in order, so every attack knows the one before it.
  const byDistrict = new Map<string, RaidAttackRow[]>();
  for (const attack of input.attacks) {
    const key = `${attack.raidNumber}:${attack.districtId}`;
    const list = byDistrict.get(key) ?? [];
    list.push(attack);
    byDistrict.set(key, list);
  }

  const rated = new Map<string, { tag: string; name: string; attacks: RatedRaidAttack[] }>();
  for (const list of byDistrict.values()) {
    list.sort((a, b) => a.attackNumber - b.attackNumber);
    let before = 0;
    for (const attack of list) {
      const opponent = opponents.get(attack.raidNumber);
      const lines = attackLines({
        before,
        after: attack.destruction,
        league: opponent ? leagueStep(opponent.capitalLeagueId, opponent.capitalLeague) : 0,
        leagueName: opponent?.capitalLeague,
      });
      const row = rated.get(attack.playerId) ?? { tag: attack.tag, name: attack.name, attacks: [] };
      row.attacks.push({
        raidNumber: attack.raidNumber,
        opponentName: opponent?.defenderName ?? null,
        districtName: attack.districtName,
        districtHallLevel: attack.districtHallLevel,
        attackNumber: attack.attackNumber,
        share: Math.max(0, attack.destruction - before),
        after: attack.destruction,
        finished: attack.destruction >= 100 && before < 100,
        lines,
        marks: sum(lines),
      });
      rated.set(attack.playerId, row);
      // Never backwards: a district's destruction only climbs, and a row that
      // says otherwise must not hand the next attack a share it did not take.
      before = Math.max(before, attack.destruction);
    }
  }

  const participants = new Map(input.participants.map((p) => [p.playerId, p]));
  const ids = new Set([...participants.keys(), ...rated.keys()]);

  const rows = [...ids].map((playerId) => {
    const p = participants.get(playerId) ?? null;
    const own = rated.get(playerId);
    const attacks = (own?.attacks ?? []).sort(
      (a, b) => a.raidNumber - b.raidNumber || a.attackNumber - b.attackNumber,
    );
    const used = p?.attacksUsed ?? attacks.length;
    const loot = p?.loot ?? 0;

    const weekendLines: MarkLine[] = [];
    if (loot > 0) {
      weekendLines.push({
        label: `${loot.toLocaleString("en-GB")} capital gold`,
        marks: round2((loot / RAID_MARKS.gold.per) * RAID_MARKS.gold.marks),
      });
    }
    // Only once the weekend is over, and only for a player who attacked at all.
    const owed = p ? attacksOwed(p) : null;
    if (over && used > 0 && owed !== null && owed > 0) {
      weekendLines.push({
        label: owed === 1 ? "1 attack not used" : `${owed} attacks not used`,
        marks: owed * RAID_MARKS.unused,
      });
    }

    const attackMarks = round2(attacks.reduce((t, a) => t + a.marks, 0));
    return {
      playerId,
      tag: p?.tag || own?.tag || "",
      name: p?.name || own?.name || "Unknown player",
      attacks,
      used,
      offered: p ? (p.attackLimit === null ? null : p.attackLimit + (p.bonusAttackLimit ?? 0)) : null,
      loot,
      weekendLines,
      attackMarks,
      marks: round2(attackMarks + sum(weekendLines)),
    };
  });

  const total = round2(rows.reduce((t, r) => t + Math.max(0, r.marks), 0));
  return {
    status: over ? "counted" : "provisional",
    total,
    players: rows
      .map((r) => ({
        ...r,
        share: total > 0 ? Math.max(RAID_MARKS.worstShare, (r.marks / total) * 100) : 0,
      }))
      .sort((a, b) => b.marks - a.marks || a.name.localeCompare(b.name)),
  };
}

/** One weekend of the month, as the page heads it. */
export interface RatedRaidWeekend {
  id: string;
  startTime: string;
  status: RaidWeekendStatus;
  total: number;
}

export interface PlayerRaidMonth {
  playerId: string;
  tag: string;
  name: string;
  /** One entry per weekend given, null where they did not raid it. */
  weekends: Array<PlayerRaidWeekend | null>;
  /** The finished weekends' shares added up — the rating. */
  rating: number;
  /** The finished weekends' marks added up. */
  marks: number;
  weekendsCounted: number;
  /** The rating per finished weekend they raided. Null before their first. */
  perWeekend: number | null;
  /** The weekend being raided, when there is one and they are in it. Not in `rating`. */
  provisional: PlayerRaidWeekend | null;
}

export interface MonthRaidRating {
  weekends: RatedRaidWeekend[];
  /** Best first: rating, then marks. */
  players: PlayerRaidMonth[];
  /** At least one weekend is counted. */
  started: boolean;
}

export function monthRaidRating(
  weekends: ReadonlyArray<{ id: string; startTime: string; rating: RaidWeekendRating }>,
): MonthRaidRating {
  const byPlayer = new Map<string, PlayerRaidMonth>();

  weekends.forEach(({ rating }, index) => {
    for (const p of rating.players) {
      const row = byPlayer.get(p.playerId) ?? {
        playerId: p.playerId,
        tag: p.tag,
        name: p.name,
        weekends: weekends.map((): PlayerRaidWeekend | null => null),
        rating: 0,
        marks: 0,
        weekendsCounted: 0,
        perWeekend: null,
        provisional: null,
      };
      row.weekends[index] = p;
      row.name = p.name;
      row.tag = p.tag || row.tag;
      if (rating.status === "counted") {
        row.rating += p.share;
        row.marks += p.marks;
        row.weekendsCounted += 1;
      } else if (rating.status === "provisional") {
        row.provisional = p;
      }
      byPlayer.set(p.playerId, row);
    }
  });

  const players = [...byPlayer.values()].map((row) => ({
    ...row,
    marks: round2(row.marks),
    perWeekend: row.weekendsCounted ? row.rating / row.weekendsCounted : null,
  }));

  return {
    weekends: weekends.map(({ id, startTime, rating }) => ({
      id,
      startTime,
      status: rating.status,
      total: rating.total,
    })),
    players: players.sort(
      (a, b) =>
        b.rating - a.rating ||
        b.marks - a.marks ||
        (b.provisional?.share ?? 0) - (a.provisional?.share ?? 0) ||
        a.name.localeCompare(b.name),
    ),
    started: weekends.some(({ rating }) => rating.status === "counted"),
  };
}

/** "+0.38", "+13.24", "−17.62", "0" — raid marks to two decimals, as the rules are written. */
export function signed2(marks: number): string {
  const value = round2(marks);
  const text = Math.abs(value).toFixed(2);
  if (value > 0) return `+${text}`;
  return value < 0 ? `−${text}` : "0";
}
