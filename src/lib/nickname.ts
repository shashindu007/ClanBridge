// T11.3 — what a valid base nickname is.
//
// The rule is also written as a check constraint in migration 033
// (player_nicknames_shape). Both have to exist, and src/lib/account.ts's header
// states the division this follows: the constraint is the one that is actually
// enforced, and this is the one that produces a sentence a member can act on
// instead of `violates check constraint "player_nicknames_shape"`.
//
// A nickname is OPTIONAL by design. Clearing it is a normal act, not an error, so
// the empty string is handled by the caller as "clear this" and never reaches
// nicknameProblem() — see the note on it below. That is the one place this file
// differs in shape from account.ts, where an empty username is simply invalid.

/** Matches the length bound in 033. */
export const NICKNAME_MAX_LENGTH = 24;

/**
 * Fold a submitted nickname to its stored form.
 *
 * Trimmed only — NOT lowercased, unlike a username. A nickname is a label the
 * member reads, not an identifier anything resolves, so "Main" and "main" are
 * both fine and there is no unique index to agree with. 033's constraint asserts
 * `nickname = btrim(nickname)`, so the trim here is what keeps a submission with
 * a trailing space from becoming a database error rather than a saved label.
 */
export function normaliseNickname(raw: string): string {
  return raw.trim();
}

/**
 * null when fine, otherwise the sentence to show the member.
 *
 * Takes an ALREADY-NORMALISED, NON-EMPTY nickname. The caller decides what an
 * empty submission means — for /account it means "clear it" — because that
 * decision belongs with the form, and a validator that returned "too short" for
 * a field the member deliberately blanked would be answering a question nobody
 * asked.
 */
export function nicknameProblem(nickname: string): string | null {
  if (nickname.length === 0) return "Give the base a name, or leave the box empty to clear it.";
  if (nickname.length > NICKNAME_MAX_LENGTH) {
    return `A base name can be at most ${NICKNAME_MAX_LENGTH} characters.`;
  }
  // 033 refuses newlines and tabs. Anything that puts a line break in a label
  // shown inside a table row is a layout bug waiting to be filed as one.
  if (/[\n\r\t]/.test(nickname)) {
    return "A base name has to be a single line.";
  }
  return null;
}

/**
 * What to show for a base: the member's own label, or the in-game name.
 *
 * Here rather than in the page because two surfaces need it — the list on
 * /account and the header of /account/bases/[tag] — and a base that is called
 * one thing in the list and another on its own page is worse than having no
 * labels at all.
 */
export function baseLabel(nickname: string | null, inGameName: string): string {
  const trimmed = nickname?.trim();
  return trimmed ? trimmed : inGameName;
}
