// T10 — what a valid username and a valid password are.
//
// Stated once because two pages ask the question: /account/setup, which every
// account passes through exactly once, and /settings/account, where it is
// changed afterwards. Two copies of a validation rule is how a username the
// setup page accepts becomes one the settings page rejects.
//
// The username rule is also written as a check constraint in migration 030. Both
// have to exist: the constraint is the one that is actually enforced, and this is
// the one that produces a sentence a member can act on instead of
// `violates check constraint "users_username_check"`.

/** Matches the check constraint in 030. Lowercase, because usernames are folded. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/**
 * Minimum password length.
 *
 * Ten, not Supabase's default of six. Six is two evenings of offline guessing.
 * This is a courtesy check only — the enforced minimum is the one set in the
 * Supabase dashboard, because updateUser() is what actually stores the password
 * and it applies the project setting regardless of what this file says. Raise
 * both together or the app promises something the backend does not keep.
 */
export const PASSWORD_MIN_LENGTH = 10;

/**
 * Maximum password length.
 *
 * bcrypt silently truncates its input at 72 bytes, so a longer password is not
 * more secure — it is the same password with an invisible cut. Refusing it is
 * honest; accepting it and saying nothing is not.
 */
export const PASSWORD_MAX_LENGTH = 72;

/**
 * Fold a submitted username to its stored form.
 *
 * Lowercased and trimmed, so "Shashi" and "shashi " are the same handle. The
 * unique index in 030 is on lower(username), so this must agree with it or a
 * collision surfaces as a database error rather than a sentence.
 */
export function normaliseUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** null when fine, otherwise the sentence to show the member. */
export function usernameProblem(username: string): string | null {
  if (username.length < 3) return "A username needs at least 3 characters.";
  if (username.length > 20) return "A username can be at most 20 characters.";
  if (!USERNAME_PATTERN.test(username)) {
    return "A username can use lowercase letters, numbers and underscores only.";
  }
  return null;
}

/** null when fine, otherwise the sentence to show the member. */
export function passwordProblem(password: string, confirmation: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `A password needs at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  // Byte length, not character length: bcrypt counts bytes, so an emoji costs
  // four of the 72 and a password of 72 characters can be well over the limit.
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_LENGTH) {
    return `A password can be at most ${PASSWORD_MAX_LENGTH} bytes.`;
  }
  if (password !== confirmation) return "The two passwords do not match.";
  return null;
}
