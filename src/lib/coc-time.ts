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

// ---------------------------------------------------------------------------
// T4.4 — when the next Clan War League starts
// ---------------------------------------------------------------------------

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * THE API PUBLISHES NO CWL START DATE EITHER, so this comes from the calendar
 * for the same reason the Clan Games window above does. /clanwarleague/group
 * describes a league that has ALREADY begun and 404s the rest of the month —
 * there is no "next season" field anywhere on the clan, the player or the
 * league endpoints.
 *
 * THE RISK IS THE OPPOSITE WAY ROUND FROM CLAN GAMES, and that difference is
 * the whole reason these constants are ordinary rather than deliberately
 * conservative.
 *
 * Nothing syncs off this window. scripts/sync/cwl.ts already runs every two
 * hours regardless of the date and exits cleanly when there is no league group
 * (R10), so it finds the season on its own within two hours of the season
 * existing, whatever this file believes. Clan Games cannot work that way — its
 * score has to be differenced between two snapshots taken at the right moments,
 * so a window that is a day late loses a month of points permanently.
 *
 * This one is a DISPLAY VALUE. Being wrong by a day tells a leader "signup
 * opens tomorrow" on the day it opened, which is recoverable the moment they
 * open the game, and costs no data at all. So it is stated as an approximation
 * everywhere it renders — "around the 1st" — and never as a promise.
 *
 * R11 IS NOT AT RISK. cwlWindow() is pure and nothing writes its result
 * anywhere: not to cwl_seasons, not to any column beside a sync-written one. A
 * derived display value is neither a game fact nor a human decision, and it
 * stays out of the tables that hold those. This is also why it is not a
 * leader-entered date — see the Clan Games header above, which argues it in
 * full.
 *
 * R12 APPLIES AT THE CALL SITE, not here. Callers compare this window to what
 * cwl_seasons actually holds and let reality win: once a season row exists for
 * the month, CWL has started and the guess is irrelevant. The plan is compared
 * to reality, never substituted for it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const CWL_SIGNUP_OPENS_ON = 1;
const CWL_SIGNUP_DAYS = 2;
const CWL_WAR_DAYS = 7;
const CWL_HOUR_UTC = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CwlWindow {
  /** 'YYYY-MM' — the same natural key cwl_seasons uses, so callers can compare. */
  season: string;
  /** Signup opens; the roster has to be picked between here and `warsStart`. */
  signupOpens: Date;
  /** The first war day. */
  warsStart: Date;
  /** After this the season is over and its data starts disappearing. */
  warsEnd: Date;
}

/** 'YYYY-MM' for a date, in UTC. The shape normaliseCwlSeason produces. */
export function cwlSeason(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/**
 * The CWL window for whatever month `now` falls in.
 *
 * Always returns one, like clanGamesWindow — "when does the next one start" is
 * worth answering during the three weeks when the answer is "not yet", and a
 * function returning null then would leave the page with nothing to say.
 */
export function cwlWindow(now: Date): CwlWindow {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();

  const signupOpens = new Date(
    Date.UTC(year, month, CWL_SIGNUP_OPENS_ON, CWL_HOUR_UTC, 0, 0),
  );
  const warsStart = new Date(signupOpens.getTime() + CWL_SIGNUP_DAYS * DAY_MS);

  return {
    season: cwlSeason(signupOpens),
    signupOpens,
    warsStart,
    warsEnd: new Date(warsStart.getTime() + CWL_WAR_DAYS * DAY_MS),
  };
}

/**
 * The next window that has not finished — this month's, or next month's.
 *
 * "Next" deliberately includes one already running: a member asking when CWL
 * starts, during CWL, wants to be told it has started, not handed a date four
 * weeks away. Callers separate the two with {@link cwlPhase}.
 *
 * Date.UTC normalises month 12 to January of the following year, so December
 * needs no special case — asserted in the test anyway, because that is exactly
 * the kind of thing a later refactor breaks silently.
 */
export function nextCwlWindow(now: Date): CwlWindow {
  const thisMonth = cwlWindow(now);
  if (now < thisMonth.warsEnd) return thisMonth;

  return cwlWindow(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, CWL_SIGNUP_OPENS_ON)),
  );
}

/**
 * Which part of CWL is running right now, if any.
 *
 * `"signup"` is the phase that matters: it is the only one where a leader can
 * still change who is in, and it is two days out of thirty.
 */
export function cwlPhase(now: Date): "signup" | "wars" | null {
  const { signupOpens, warsStart, warsEnd } = cwlWindow(now);
  if (now >= signupOpens && now < warsStart) return "signup";
  if (now >= warsStart && now < warsEnd) return "wars";
  return null;
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
