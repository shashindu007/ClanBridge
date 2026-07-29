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
