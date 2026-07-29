// T1.12 — Clash of Clans tag handling.
//
// Section 4: tags are stored with the hash and uppercased on write. They are
// encoded to %23 ONLY here — this module is the single place in the codebase
// that knows about percent-encoding a tag.
//
// Getting this wrong produces a 404 on a perfectly valid tag, which section 7
// lists as a pitfall that costs a day, because the failure looks like a wrong
// tag rather than a wrong encoding.

/** Thrown when a string cannot be a Clash of Clans tag. Never throw bare strings (section 4). */
export class InvalidTagError extends Error {
  readonly input: string;

  constructor(input: string, reason: string) {
    super(`Invalid Clash of Clans tag: ${reason}`);
    this.name = "InvalidTagError";
    this.input = input;
  }
}

// Supercell mints tags from this alphabet only. Note what is absent: the letters
// I, O and S, and most digits. That is deliberate on their part — the set avoids
// characters people confuse when reading a tag off a screen.
const TAG_ALPHABET = "0289PYLQGRJCUV";

// The substitution worth making. Members type O for zero constantly, and since
// the letter O cannot appear in a real tag the correction is unambiguous rather
// than a guess.
const CONFUSABLE: Record<string, string> = {
  O: "0",
};

/**
 * Canonical storage form: uppercase, leading `#`, no whitespace.
 *
 * Accepts what a member is likely to paste — with or without the hash, any case,
 * with stray spaces, and with `O` typed for `0`.
 *
 * @throws {InvalidTagError} if the result could not be a real tag.
 */
export function normaliseTag(input: string): string {
  if (typeof input !== "string") {
    throw new InvalidTagError(String(input), "not a string");
  }

  // Strip every kind of whitespace, not only the ends — a pasted tag often
  // carries a non-breaking space from a chat client.
  let tag = input.replace(/\s+/g, "");

  if (tag.length === 0) {
    throw new InvalidTagError(input, "empty");
  }

  // The tag may still be percent-encoded if it came back out of a URL.
  if (tag.toUpperCase().startsWith("%23")) {
    tag = tag.slice(3);
  } else if (tag.startsWith("#")) {
    tag = tag.slice(1);
  }

  // A remaining hash means two tags were concatenated, which is never valid.
  if (tag.includes("#")) {
    throw new InvalidTagError(input, "contains more than one '#'");
  }

  tag = tag.toUpperCase();
  tag = [...tag].map((c) => CONFUSABLE[c] ?? c).join("");

  if (tag.length < 3 || tag.length > 12) {
    throw new InvalidTagError(input, `length ${tag.length} is outside 3-12`);
  }

  for (const char of tag) {
    if (!TAG_ALPHABET.includes(char)) {
      throw new InvalidTagError(input, `'${char}' is not a valid tag character`);
    }
  }

  return `#${tag}`;
}

/**
 * URL form: `#2PP0JCCL` becomes `%232PP0JCCL`.
 *
 * For building an API path or a route segment. NEVER store the result — the
 * check constraints in 001_core.sql reject it.
 */
export function encodeTag(input: string): string {
  return `%23${normaliseTag(input).slice(1)}`;
}

/**
 * Reverse of {@link encodeTag}, for reading the `[clanTag]` and `[tag]` route
 * segments. Use this rather than a bare `decodeURIComponent`, so a malformed
 * segment fails here instead of reaching a query.
 */
export function decodeTag(segment: string): string {
  return normaliseTag(decodeURIComponent(segment));
}

/** Non-throwing check, for validating form input before submitting it. */
export function isValidTag(input: string): boolean {
  try {
    normaliseTag(input);
    return true;
  } catch {
    return false;
  }
}
