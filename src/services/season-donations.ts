// 052 — season donations that survive a clan move. No SQL; this takes what
// repositories/season-donations.ts returned and works out what it means.
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO SOURCES, AND WHAT EACH ONE CAN AND CANNOT SAY
//
// A — STAYS. donation_segments() cuts each player's hourly clan-counter readings
// into one piece per stay in a clan; a stay's last reading is what they gave
// there. Per clan, but blind to two things: what they gave after our last
// reading and before leaving (the counter is wiped on leaving), and anything
// given in a clan we do not read.
//
// B — LIFETIME ACHIEVEMENTS. donation_counters holds one daily reading of the
// achievements that never reset, taken in the same response as the clan
// counter. They see every donation anywhere, but not where it was made.
//
// THE CONSTANT THAT JOINS THEM. While a player stays in one clan,
//
//     K = achievement - clan counter
//
// does not change: every troop donated raises both by the same amount. K is the
// achievement value at the moment that stay's counter was zero. So for two
// stays p then q,
//
//     K(q) - K(p) - given(p)
//
// is exactly what was donated after p's last reading and before q began. If q
// began within an hour or two of p ending, the player was never anywhere else
// and that is p's missed tail — credited to p's clan in full. If there was a gap,
// it is their tail plus whatever they gave elsewhere, which cannot be told apart,
// and is reported as `other` — the part a ranking gives a small weight.
//
// IF K IS NOT CONSTANT, the achievements and the clan counter are not counting
// the same thing, and B is not used for that stay rather than used wrongly.
// Which sum of the three achievements matches the clan counter is chosen by the
// data (chooseFormula), because the game does not document it: "Friend in Need"
// is troop capacity, "Sharing is caring" spell capacity, "Siege Sharer" a count.
// ─────────────────────────────────────────────────────────────────────────────

const HOUR = 3_600_000;

/**
 * A stay ending and the next beginning within this are one continuous run in
 * the family: nobody can join an outside clan, donate, and come back between
 * two hourly readings often enough to matter. Three hours rather than one,
 * because GitHub starts scheduled runs late.
 */
export const CONTINUOUS_MS = 3 * HOUR;

/**
 * How far a daily counter reading may sit outside a stay's first and last
 * hourly reading and still be matched to it. The players sync runs at :11 and
 * the clans sync at :17, so a reading taken just after a join lands before the
 * stay's first snapshot.
 */
const MATCH_SLACK_MS = 90 * 60_000;

/** One stay in one clan, as donation_segments() returns it. */
export interface DonationSegment {
  playerId: string;
  clanId: string;
  startedAt: string;
  endedAt: string;
  /** 'first' = first reading in the window; 'clan' = moved; 'drop' = counter fell. */
  startReason: "first" | "clan" | "drop";
  given: number;
  received: number;
}

/** One daily donation_counters row. */
export interface CounterReading {
  playerId: string;
  clanId: string;
  capturedAt: string;
  troops: number | null;
  spells: number | null;
  sieges: number | null;
  clanDonations: number | null;
}

export type CounterFormula = "troops+spells+sieges" | "troops+spells";

const FORMULAS: Record<CounterFormula, (r: CounterReading) => number | null> = {
  "troops+spells+sieges": (r) =>
    r.troops === null || r.spells === null || r.sieges === null
      ? null
      : r.troops + r.spells + r.sieges,
  "troops+spells": (r) => (r.troops === null || r.spells === null ? null : r.troops + r.spells),
};

/** A season, as instants. `start` null: before our data. `end` null: still running. */
export interface Season {
  start: string | null;
  end: string | null;
}

const ms = (iso: string) => Date.parse(iso);

function floorHour(iso: string): number {
  return Math.floor(ms(iso) / HOUR) * HOUR;
}

function inSeason(iso: string, season: Season): boolean {
  const t = ms(iso);
  return (
    (season.start === null || t >= ms(season.start)) &&
    (season.end === null || t < ms(season.end))
  );
}

/**
 * When the monthly reset happened, found in the data rather than a calendar.
 *
 * A reset drops every member's counter in the same hour; a member leaving and
 * rejoining drops one. So a reset is an hour in which a good share of the
 * players seen had a stay begin with a drop. Readings of neighbouring hours are
 * merged, because clans are read one after another and a reset can fall
 * between two of them.
 *
 * Read from the data because Supercell has moved the season boundary before,
 * and a hardcoded "last Monday, 05:00 UTC" would split every month wrongly the
 * day it changes again, with nothing to say so. Returns the first hour after
 * each reset, ascending: the season boundary.
 */
export function seasonResets(segments: readonly DonationSegment[]): string[] {
  const players = new Set(segments.map((s) => s.playerId)).size;
  // A tiny clan cannot supply "a quarter of the family"; half of it will do.
  const threshold =
    players >= 12 ? Math.max(3, Math.ceil(players * 0.25)) : Math.max(1, Math.ceil(players * 0.5));

  const byHour = new Map<number, number>();
  for (const s of segments) {
    if (s.startReason !== "drop") continue;
    const hour = floorHour(s.startedAt);
    byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
  }

  const resets: string[] = [];
  let first: number | null = null;
  let last = 0;
  let count = 0;
  const flush = () => {
    if (first !== null && count >= threshold) resets.push(new Date(first).toISOString());
  };

  for (const hour of [...byHour.keys()].sort((a, b) => a - b)) {
    if (first !== null && hour - last <= 2 * HOUR) {
      last = hour;
      count += byHour.get(hour)!;
    } else {
      flush();
      first = hour;
      last = hour;
      count = byHour.get(hour)!;
    }
  }
  flush();

  return resets;
}

/**
 * The seasons the data covers, newest first. The stretch before the first reset
 * found is not offered: it began before our window, so its totals are partial.
 */
export function seasonsFrom(resets: readonly string[]): Season[] {
  if (resets.length === 0) return [{ start: null, end: null }];
  const seasons: Season[] = [{ start: resets[resets.length - 1]!, end: null }];
  for (let i = resets.length - 1; i > 0; i -= 1) {
    seasons.push({ start: resets[i - 1]!, end: resets[i]! });
  }
  return seasons;
}

/**
 * The stay a counter reading belongs to: same player, same clan, inside the
 * stay give or take the slack. Null when none — or when two stays qualify,
 * which happens at a reset boundary, where guessing wrong would give the old
 * stay a K computed from the new one's counter.
 */
function stayOf(reading: CounterReading, stays: readonly DonationSegment[]): number | null {
  const t = ms(reading.capturedAt);
  const matches: number[] = [];
  stays.forEach((s, i) => {
    if (
      s.clanId === reading.clanId &&
      t >= ms(s.startedAt) - MATCH_SLACK_MS &&
      t <= ms(s.endedAt) + MATCH_SLACK_MS
    ) {
      matches.push(i);
    }
  });
  return matches.length === 1 ? matches[0]! : null;
}

/** Every K each stay produced under one formula, indexed like the stays. */
function stayConstants(
  stays: readonly DonationSegment[],
  readings: readonly CounterReading[],
  formula: CounterFormula,
): number[][] {
  const ks: number[][] = stays.map(() => []);
  for (const r of readings) {
    const achievement = FORMULAS[formula](r);
    if (achievement === null || r.clanDonations === null) continue;
    const i = stayOf(r, stays);
    if (i !== null) ks[i]!.push(achievement - r.clanDonations);
  }
  return ks;
}

export interface CounterCheck {
  formula: CounterFormula;
  /** Stays with two or more readings, which is what it takes to test K at all. */
  checked: number;
  /** Of those, how many kept K exactly constant. */
  consistent: number;
}

function groupByPlayer<T extends { playerId: string }>(items: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(item.playerId) ?? [];
    list.push(item);
    map.set(item.playerId, list);
  }
  return map;
}

/**
 * Which sum of the achievements moves in step with the clan counter.
 *
 * Tried against every stay that has two or more readings; the formula that
 * keeps K exactly constant in the most stays wins. `consistent / checked` is
 * shown on the page, so a mismatch is visible rather than silently absorbed.
 */
export function chooseFormula(
  segments: readonly DonationSegment[],
  readings: readonly CounterReading[],
): CounterCheck {
  const staysByPlayer = groupByPlayer(sortedStays(segments));
  const readingsByPlayer = groupByPlayer(readings);

  const results = (Object.keys(FORMULAS) as CounterFormula[]).map((formula) => {
    let checked = 0;
    let consistent = 0;
    for (const [playerId, stays] of staysByPlayer) {
      for (const ks of stayConstants(stays, readingsByPlayer.get(playerId) ?? [], formula)) {
        if (ks.length < 2) continue;
        checked += 1;
        if (Math.min(...ks) === Math.max(...ks)) consistent += 1;
      }
    }
    return { formula, checked, consistent };
  });

  // Stable on a tie: the first formula, which counts every kind of donation.
  return results.reduce((best, r) => (r.consistent > best.consistent ? r : best));
}

function sortedStays(segments: readonly DonationSegment[]): DonationSegment[] {
  return [...segments].sort(
    (a, b) => a.playerId.localeCompare(b.playerId) || ms(a.startedAt) - ms(b.startedAt),
  );
}

export interface ClanShare {
  clanId: string;
  given: number;
  received: number;
}

export interface SeasonDonation {
  playerId: string;
  /** What they gave and received in each clan this viewer can see. */
  byClan: ClanShare[];
  /**
   * Donations the achievements saw that no clan counter here accounts for:
   * given in a clan outside the platform, in one this viewer cannot see, or in
   * the hour before leaving. Null when there is no usable counter reading, which
   * is not the same as zero.
   */
  other: number | null;
  /** Sum of byClan's given, plus `other`. */
  total: number;
  /** Sum of byClan's received. Only A can see receipts — no achievement counts them. */
  received: number;
}

export interface SeasonDonationReport {
  rows: SeasonDonation[];
  check: CounterCheck;
}

/**
 * Every player's donations in one season, per clan, with the part B adds.
 *
 * `segments` should reach back before the season starts, so the stay that
 * straddles its start and the one before it are both there: a stay belongs to
 * the season its LAST reading falls in, and the missed tail of last season's
 * final stay is found through this season's first.
 */
export function seasonDonations(
  segments: readonly DonationSegment[],
  readings: readonly CounterReading[],
  season: Season,
): SeasonDonationReport {
  const check = chooseFormula(segments, readings);
  const readingsByPlayer = groupByPlayer(readings);
  const rows: SeasonDonation[] = [];

  for (const [playerId, stays] of groupByPlayer(sortedStays(segments))) {
    if (!stays.some((s) => inSeason(s.endedAt, season))) continue;

    const shares = new Map<string, ClanShare>();
    const share = (clanId: string) => {
      const existing = shares.get(clanId);
      if (existing) return existing;
      const created = { clanId, given: 0, received: 0 };
      shares.set(clanId, created);
      return created;
    };

    for (const s of stays) {
      if (!inSeason(s.endedAt, season)) continue;
      share(s.clanId).given += s.given;
      share(s.clanId).received += s.received;
    }

    // One K per stay, or null where the stay had no reading or K moved.
    const k = stayConstants(stays, readingsByPlayer.get(playerId) ?? [], check.formula).map(
      (ks) => (ks.length > 0 && Math.min(...ks) === Math.max(...ks) ? ks[0]! : null),
    );

    const known = k.flatMap((value, i) => (value === null ? [] : [i]));
    let other: number | null = known.some((i) => inSeason(stays[i]!.endedAt, season)) ? 0 : null;

    for (let n = 1; n < known.length; n += 1) {
      const a = known[n - 1]!;
      const b = known[n]!;

      let seen = 0;
      let continuous = true;
      for (let i = a; i < b; i += 1) {
        seen += stays[i]!.given;
        if (ms(stays[i + 1]!.startedAt) - ms(stays[i]!.endedAt) > CONTINUOUS_MS) continuous = false;
      }

      const between = k[b]! - k[a]! - seen;
      // Negative is noise, never a real "undonation". Nothing to credit.
      if (between <= 0) continue;

      const before = stays[b - 1]!;
      if (continuous) {
        // Never left the family: this is the tail of the stay before b.
        if (inSeason(before.endedAt, season)) share(before.clanId).given += between;
      } else if (inSeason(stays[a]!.endedAt, season) && inSeason(stays[b]!.endedAt, season)) {
        // Away, entirely inside this season. An absence that spans the season
        // boundary cannot be split between the two, so it is credited to neither.
        other = (other ?? 0) + between;
      }
    }

    const byClan = [...shares.values()];
    const familyGiven = byClan.reduce((sum, s) => sum + s.given, 0);
    rows.push({
      playerId,
      byClan,
      other,
      total: familyGiven + (other ?? 0),
      received: byClan.reduce((sum, s) => sum + s.received, 0),
    });
  }

  return { rows: rows.sort((a, b) => b.total - a.total), check };
}
