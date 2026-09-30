// T3.1 — Magic link callback.
//
// Where the emailed link lands. Three things happen here and the order matters:
//
//   1. Exchange the one-time code for a session (cookies are written by the SSR
//      client's setAll, which is why this must be a route handler and not a page).
//   2. Create the `users` profile row if it does not exist.
//   3. Redirect onward.
//
// Step 2 is not optional and is easy to miss. `users.id` references
// auth.users(id), but NOTHING creates the public.users row — there is no
// `on auth.users` trigger anywhere in supabase/migrations/. Without this insert a
// signed-in member has an auth identity and no profile, so accountStatus()
// returns null, the T3.8 gate treats them as unapproved forever, and no leader
// can ever see them to approve. 015's "own profile insert" policy exists for
// exactly this write.
//
// This route sits at /auth/callback — outside both route groups — so that the
// middleware's "/auth" public prefix matches it. It must be reachable without a
// session, because establishing the session is what it is for.

import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/safe-next";

// safeNext used to live here. It moved to lib/ when T10.4 added a second route
// that establishes a session and needs the identical guard — see the note in
// that file on why there must be exactly one copy.

// Supabase's otp_expired covers more than age: it is also what a link gets once
// a newer one was requested, or once anything — the member, or a mail app's
// link scanner — has opened it.
const EXPIRED_LINK =
  "Supabase rejected this link (expired, already opened once, or replaced by a newer link). Send yourself a new one and open only the newest email.";

// Kept distinct from EXPIRED_LINK on purpose: when the #fragment carries a
// reason, the login page replaces this with it, so seeing THIS text means the
// link really arrived with nothing at all.
const NO_CODE =
  "That link arrived without a sign-in code. Send yourself a new one.";

function errorRedirect(request: NextRequest, reason: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?error=${encodeURIComponent(reason)}`;
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));

  const supabase = await createClient();

  // Supabase sends either a PKCE `code` (what signInWithOtp uses by default) or a
  // `token_hash` + `type` pair, depending on the project's email template. Both
  // are handled so that a template edited in the dashboard cannot silently break
  // sign-in.
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  // Defaults to "email" — the type that covers both the magic link and the
  // sign-up confirmation, which are the only links this project sends. The live
  // template once sent `type=` empty (Supabase has no {{ .Type }} variable), and
  // requiring it made every link fail with a perfectly good token_hash in hand.
  const type = (params.get("type") || "email") as EmailOtpType;

  // A link Supabase already rejected (expired, used once already, or opened first
  // by a mail scanner) still lands here, carrying the reason instead of a code.
  // Sometimes that reason is in the query; more often it is in the #fragment,
  // which never reaches the server — the redirect below keeps the fragment, and
  // the login page reads it from there.
  const linkError = params.get("error_code") ?? params.get("error");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return errorRedirect(request, error.message);
  } else if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return errorRedirect(request, error.message);
  } else if (linkError === "otp_expired") {
    return errorRedirect(request, EXPIRED_LINK);
  } else if (linkError) {
    return errorRedirect(request, params.get("error_description") ?? EXPIRED_LINK);
  } else {
    return errorRedirect(request, NO_CODE);
  }

  // getUser(), not getSession() — the session was just written from a token this
  // request supplied, and it is worth one round trip to have the server confirm
  // it before a row is created against that id.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return errorRedirect(request, "Sign-in did not complete. Try again.");

  // upsert, not insert: the second and every later sign-in hits an existing row.
  // ignoreDuplicates leaves it untouched — re-writing `email` on every sign-in
  // would be harmless today but would quietly overwrite a corrected address.
  //
  // status is NOT set here. It defaults to 'pending' (013) and is only ever
  // changed by approve_account()/reject_account(); the guard trigger in 015
  // refuses a direct write, so attempting one here would raise.
  const { error: profileError } = await supabase
    .from("users")
    .upsert({ id: user.id, email: user.email ?? "" }, { ignoreDuplicates: true });

  if (profileError) {
    // Not fatal to the session, but fatal to being approvable, so it must not
    // pass silently. The member is signed in and will land on /pending either
    // way; this is the line that tells you why nobody can see them.
    console.error(`Could not create profile for ${user.id}: ${profileError.message}`);
  }

  const url = request.nextUrl.clone();
  url.pathname = next;
  url.search = "";
  return NextResponse.redirect(url);
}
