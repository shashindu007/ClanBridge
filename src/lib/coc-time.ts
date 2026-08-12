// T1.13 — Parsing Supercell's timestamp format.
//
// The API returns times as `20260729T063000.000Z`. That is ISO 8601 basic
// format, and JavaScript's Date only understands the extended format with
// separators. `new Date("20260729T063000.000Z")` returns an Invalid Date —
// it does NOT throw, does NOT warn, and compares false against everything.
//
// Section 7 lists "Invalid Date everywhere" as a pitfall that costs a day,
// precisely because the failure is silent. Every timestamp from the API goes
// through this module.
//
// Section 4: everything is stored timestamptz in UTC. Converting to Sri Lanka
// time is a display concern only (T9.9).

/** Thrown when a string is not a Supercell timestamp. Never throw bare strings (section 4). */
export class InvalidCocTimeError extends Error {
  readonly input: string;

  constructor(input: string, reason: string) {
    super(`Invalid Clash of Clans timestamp: ${reason}`);
    this.name = "InvalidCocTimeError";
    this.input = input;
  }
}

// YYYYMMDD 'T' HHMMSS ['.' mmm] 'Z'
// The fractional part is optional: some endpoints send it, some do not.
const COC_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{1,3}))?Z$/;

/**
 * Parse `20260729T063000.000Z` into a `Date`.
 *
 * @throws {InvalidCocTimeError} rather than returning an Invalid Date. This is
 * the entire point of the module — a thrown error is findable, an Invalid Date
 * silently poisons every calculation downstream of it.
 */
export function parseCocTime(input: string): Date {
  if (typeof input !== "string") {
    throw new InvalidCocTimeError(String(input), "not a string");
  }

  const match = COC_TIME.exec(input.trim());
  if (!match) {
    throw new InvalidCocTimeError(input, "does not match YYYYMMDDTHHMMSS[.mmm]Z");
  }

  const [, year, month, day, hour, minute, second, ms = "0"] = match;

  // Rebuild in extended ISO form, which Date parses reliably and always as UTC.
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.${ms.padEnd(3, "0")}Z`;
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    throw new InvalidCocTimeError(input, "is not a real date");
  }

  // The regex accepts month 13 and day 32; Date silently rolls those over into
  // the next month. Comparing back catches it instead of storing a wrong day.
  if (date.toISOString().slice(0, 10) !== `${year}-${month}-${day}`) {
    throw new InvalidCocTimeError(input, "is not a real calendar date");
  }

  return date;
}

/** Non-throwing variant, for optional fields the API may omit. */
export function parseCocTimeOrNull(input: string | null | undefined): Date | null {
  if (input === null || input === undefined || input === "") return null;
  try {
    return parseCocTime(input);
  } catch {
    return null;
  }
}

/**
 * Inverse of {@link parseCocTime}, for building fixtures and test data.
 * Nothing in the application writes this format — we store timestamptz.
 */
export function formatCocTime(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new InvalidCocTimeError(String(date), "is an Invalid Date");
  }
  return date.toISOString().replace(/[-:]/g, "");
}

// ---------------------------------------------------------------------------
// T7.4 — the Clan Games period
// ---------------------------------------------------------------------------

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE API PUBLISHES NOTHING ABOUT CLAN GAMES. NOT THE SCORE, NOT THE DATES.
 *
 * There is no endpoint, no field on the clan, and no field on the player. The
 * score has to be derived by differencing each player's "Games Champion"
 * achievement between a snapshot taken when the period opens and one taken when
 * it closes — and to know WHEN to take those snapshots, the window has to come
 * from somewhere too.
 *
 * It comes from the calendar. Clan Games have run 22nd to 28th of the month,
 * starting and ending at 08:00 UTC, for years.
 *
 * WHY NOT LET A LEADER TYPE THE DATES IN
 *
 * Because clan_games is a game-fact table, and R11 exists to keep the two kinds
 * of data apart. A leader-entered date sitting in a column beside sync-written
 * ones makes the table's provenance unanswerable six months later: nobody can
 * tell which rows the game supplied and which a person guessed, and the guess
 * looks exactly as authoritative as the fact. It would also mean a month where
 * the leader is busy is a month with no score at all.
 *
 * WHAT HAPPENS WHEN SUPERCELL MOVES IT
 *
 * They have, occasionally, by a day. The failure is bounded and self-correcting
 * in one direction only, which is worth being precise about:
 *
 *   period opens EARLIER than we think  -> the start snapshot is late, and the
 *                                          points earned before it are lost from
 *                                          that month. Permanently.
 *   period opens LATER than we think    -> the start snapshot is early, which is
 *                                          harmless: nobody has scored yet, so
 *                                          the value is the same one we would
 *                                          have read on the day.
 *
 * The asymmetry is why STARTS_ON is deliberately conservative. Being a day early
 * costs nothing; being a day late costs a month of scores that cannot be
 * re-fetched from anywhere — the same permanence that makes CWL this project's
 * whole reason to exist.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const GAMES_STARTS_ON = 22;
const GAMES_ENDS_ON = 28;
const GAMES_HOUR_UTC = 8;

export interface ClanGamesWindow {
  /** 'YYYY-MM' — the natural key of clan_games, and the month the points belong to. */
  season: string;
  start: Date;
  end: Date;
}

/** 'YYYY-MM' for a date, in UTC. */
export function gamesSeason(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * The Clan Games window for whatever month `now` falls in.
 *
 * Always returns a window, even when `now` is nowhere near it — callers ask
 * `isDuringClanGames` separately. Keeping the two apart means the page can say
 * "the next games open on the 22nd" during the three weeks when nothing is
 * running, rather than having nothing to show.
 */
export function clanGamesWindow(now: Date): ClanGamesWindow {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  return {
    season: gamesSeason(now),
    start: new Date(Date.UTC(year, month, GAMES_STARTS_ON, GAMES_HOUR_UTC, 0, 0)),
    end: new Date(Date.UTC(year, month, GAMES_ENDS_ON, GAMES_HOUR_UTC, 0, 0)),
  };
}

/** Is the period running right now? Inclusive of the start, exclusive of the end. */
export function isDuringClanGames(now: Date): boolean {
  const { start, end } = clanGamesWindow(now);
  return now >= start && now < end;
}

/**
 * Which snapshot, if any, today's run should take.
 *
 * `"start"` on the day the period opens, `"end"` once it has closed, and null
 * for the three weeks in between when there is nothing to do.
 *
 * BOTH WINDOWS ARE A DAY WIDE, NOT AN INSTANT, because the job runs once a day
 * and GitHub delays scheduled runs by up to twenty minutes — an exact-time check
 * would miss the boundary on any day the runner was busy, and missing the start
 * boundary costs the month. The sync's own settled_at guard is what stops the
 * width turning into repeated writes.
 */
export function clanGamesPhase(now: Date): "start" | "end" | null {
  const { start, end } = clanGamesWindow(now);
  const DAY = 24 * 60 * 60 * 1000;

  // The opening day. Note the lower bound is the start itself, not start-minus-
  // a-day: snapshotting early is harmless, but a run BEFORE the period opens
  // would be indistinguishable from last month's leftover state.
  if (now >= start && now < new Date(start.getTime() + DAY)) return "start";

  // Any time after the period closes, until the next month's window opens. Wide
  // on purpose — the end snapshot can be taken late without losing anything,
  // because the achievement value only moves while the games are running.
  if (now >= end) return "end";

  return null;
}
