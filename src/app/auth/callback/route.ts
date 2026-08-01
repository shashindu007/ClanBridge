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

/**
 * Only ever redirect within this site.
 *
 * `next` arrives in a URL that is emailed out, so treating it as a bare
 * destination would turn every magic link into an open redirect: a link that
 * genuinely comes from ClanBridge, genuinely signs the member in, and then drops
 * them on someone else's page. Anything not a single-slash-prefixed relative
 * path is discarded rather than repaired.
 */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

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
  const type = params.get("type") as EmailOtpType | null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return errorRedirect(request, error.message);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) return errorRedirect(request, error.message);
  } else {
    return errorRedirect(request, "That link is missing its sign-in code.");
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
