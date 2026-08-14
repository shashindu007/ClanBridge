// T10.8d — what a member is allowed to be told when a write fails.
//
// Most Server Actions in this project redirect with `?error=${error.message}`,
// where `error` came straight from PostgREST. React escapes it on render, so it
// is not XSS — but the member is shown things like
//
//   duplicate key value violates unique constraint "users_username_key"
//   new row violates row-level security policy for table "clan_roles"
//
// which tell them nothing they can act on and tell a prober the schema. The
// second one is the worse of the two: an RLS refusal is a permission boundary,
// and naming the table it guards is describing the lock to whoever is picking it.
//
// So: the raw text goes to the server log, where whoever is debugging can read
// it, and the member gets a sentence.

/** Anything with a `message`, which is what PostgREST and Supabase both return. */
type MessageLike = { message?: unknown } | null | undefined;

function rawMessage(error: MessageLike): string {
  if (!error) return "";
  const { message } = error as { message?: unknown };
  return typeof message === "string" ? message : String(message ?? "");
}

/**
 * A Postgres unique-violation, by constraint name.
 *
 * Checked by name rather than by SQLSTATE because PostgREST does not always
 * surface the code, and because the constraint name is the only thing that says
 * WHICH uniqueness was violated — "that username is taken" and "you have already
 * voted" are the same error class and different sentences.
 */
export function isUniqueViolation(error: MessageLike, constraint?: string): boolean {
  const raw = rawMessage(error);
  if (!/duplicate key value|already exists/i.test(raw)) return false;
  return constraint ? raw.includes(constraint) : true;
}

/**
 * The sentence to show, and the log line to keep.
 *
 * `context` names the operation for the log — "sign-in", "add-clan" — so a
 * console full of these is still readable. `fallback` is what the member sees
 * when nothing more specific is known; write it as a sentence about what they
 * were doing, never as a description of the failure.
 *
 * Returns the fallback for anything unrecognised, deliberately. The default has
 * to be the safe one: a helper that passes unknown messages through would leak
 * every error nobody thought to map, which is precisely the set of errors worth
 * not leaking.
 */
export function safeMessage(context: string, error: MessageLike, fallback: string): string {
  const raw = rawMessage(error);
  if (raw) console.error(`${context}: ${raw}`);
  return fallback;
}
