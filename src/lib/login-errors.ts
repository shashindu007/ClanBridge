// What /login may say when a sign-in link fails.
//
// Codes, not sentences. /auth/callback used to pass its message through the query
// string and /login printed whatever arrived, so a crafted link could put any
// sentence on the sign-in page: "Your account is locked, call this number". React
// escapes it, which stops scripts and not lies. A page asking for a password is the
// one place that must only ever say things this codebase wrote.

const LOGIN_ERRORS = {
  // Supabase's otp_expired covers more than age: it is also what a link gets once
  // a newer one was requested, or once anything — the member, or a mail app's
  // link scanner — has opened it.
  expired:
    "Supabase rejected this link (expired, already opened once, or replaced by a newer link). Send yourself a new one and open only the newest email.",
  // Kept distinct from `expired` on purpose: when the #fragment carries a reason,
  // the login page replaces this with it, so seeing THIS text means the link
  // really arrived with nothing at all.
  "no-code": "That link arrived without a sign-in code. Send yourself a new one.",
  incomplete: "Sign-in did not complete. Try again.",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERRORS;

/** The sentence for a code from a URL, or null for anything this file did not write. */
export function loginError(code: string | null | undefined): string | null {
  if (!code || !Object.hasOwn(LOGIN_ERRORS, code)) return null;
  return LOGIN_ERRORS[code as LoginErrorCode];
}
