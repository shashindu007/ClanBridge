// T10.4 — Password sign-in.
//
// The magic link (T3.1) still exists and is still how an account is created.
// This is the returning member's door: email and password, no inbox, so
// switching between two accounts is two clicks rather than two emails.
//
// WHY A ROUTE HANDLER RATHER THAN CALLING signInWithPassword IN THE BROWSER.
// The browser client would work — @supabase/ssr writes the session to cookies
// either way. It would also be unlimited. Every credential guess would go
// straight from the attacker to Supabase without passing through anything this
// project controls, which is exactly the position the magic link is still in and
// the position T9.7's middleware limiter exists to avoid for writes. Putting the
// password path here gives it a budget (SIGN_IN_LIMIT) and gives us one place to
// make sure the response says nothing useful about which half was wrong.
//
// Structure follows /api/verify: identify, limit, act. The one deliberate
// difference from that route is what happens when the limiter is unreachable —
// see below.
//
// PUBLIC_PATHS in lib/supabase/middleware.ts must list /api/auth or this route
// is unreachable: the middleware redirects every unauthenticated request that is
// not public to /login, and an unauthenticated request is the only kind that
// ever arrives here.

import { NextResponse } from "next/server";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { PASSWORD_MAX_LENGTH } from "@/lib/account";
import { rateLimitHeaders, sharedRateLimiter, SIGN_IN_LIMIT } from "@/lib/rate-limit";
import { safeNext } from "@/lib/safe-next";

const bodySchema = z.object({
  // .trim() BEFORE .email(), so an address pasted with a trailing space is
  // signed in rather than rejected as malformed. A member who pastes from their
  // password manager and is told "send an email address and a password" has no
  // way to see what is wrong with the one they sent.
  email: z.string().trim().email().max(320),
  // min(1) rather than the real minimum: this is the sign-in form, not the
  // setup form. An old password shorter than today's rule must still be able to
  // fail on being wrong rather than on being short, which would tell the person
  // typing it that the rule changed.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  next: z.string().optional(),
});

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers });
}

/**
 * The one sentence returned for every credential failure.
 *
 * Never Supabase's message. "Invalid login credentials" and "Email not
 * confirmed" are different strings for different states, and handing both back
 * turns this route into an oracle that says which email addresses have accounts.
 */
const REFUSED = "Wrong email or password.";

/**
 * What to say when the auth server could not be reached at all.
 *
 * WHY THIS IS NOT A CREDENTIAL FAILURE, AND WHY SAYING SO LEAKS NOTHING.
 *
 * REFUSED above exists so this route cannot be used to discover which addresses
 * have accounts. That argument is about the ANSWER to a credential check. A
 * transport failure happens BEFORE any account is looked up: the request never
 * reached Supabase, so the reply is identical whether the address exists, does
 * not exist, or was never typed. It carries no information to leak, and
 * collapsing it into REFUSED buys no secrecy while costing the member the truth.
 *
 * What it cost in practice: a network drop produced
 * `AuthRetryableFetchError: fetch failed` with `status: 0`, this route returned
 * 401 "Wrong email or password", and the member retyped a password that had
 * never been checked. 503 plus Retry-After says wait; 401 says you are wrong.
 */
const UNREACHABLE = "Could not reach the server. Check your connection and try again.";

export async function POST(request: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Send an email address and a password." }, 400);
  }

  // Folded, or "Member@example.com" and "member@example.com" each get their own
  // rate-limit budget and the per-address limit counts for nothing.
  const email = parsed.data.email.toLowerCase();

  // Two keys, because they stop different attacks. Per email, so one account
  // cannot be ground down from a thousand hosts; per IP, so one host cannot walk
  // a list of addresses trying "password123" against each. Either being out of
  // budget refuses the attempt.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  let limited;
  try {
    const limiter = await sharedRateLimiter(SIGN_IN_LIMIT);
    const [byEmail, byIp] = await Promise.all([
      limiter.limit(`signin:${email}`),
      limiter.limit(`signin-ip:${ip}`),
    ]);
    limited = byEmail.success ? byIp : byEmail;
  } catch (error) {
    // FAILS OPEN, and this is a deliberate disagreement with /api/verify, which
    // fails closed on the same condition.
    //
    // Verify fails closed because failing open exposes the game API key to
    // unlimited use, and there is nothing underneath it. Sign-in has something
    // underneath it: Supabase rate-limits its own token endpoint per IP whether
    // this code runs or not. So the choice here is not "limited or unlimited",
    // it is "our budget plus theirs, or theirs alone" — and the cost of failing
    // closed is that nobody can get into the product at all because Upstash had
    // a bad minute. Same reasoning as hasWriteBudget() in
    // lib/supabase/middleware.ts.
    console.error(
      `sign-in: rate limit unavailable, allowing attempt — ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    limited = null;
  }

  const headers = limited ? rateLimitHeaders(limited) : undefined;

  if (limited && !limited.success) {
    return json(
      { error: "Too many sign-in attempts. Try again in fifteen minutes." },
      429,
      {
        ...headers,
        "Retry-After": String(Math.ceil(SIGN_IN_LIMIT.windowMs / 1000)),
      },
    );
  }

  const supabase = await createClient();

  // The cookies land on THIS response. That is the whole reason this is a route
  // handler and not a Server Component — server.ts swallows cookie writes when
  // they are not permitted, so a sign-in from the wrong context succeeds and
  // then silently has no session.
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });

  // Reached Supabase and been told no? Or never reached it? The two need
  // different answers, and separating them is the whole of UNREACHABLE's note.
  //
  // isAuthRetryableFetchError is the library's own guard — it is what marks the
  // AuthRetryableFetchError that a DNS failure, a dropped connection or a
  // timeout produces. Matching on the message text would break the first time
  // undici rewords "fetch failed".
  if (error && isAuthRetryableFetchError(error)) {
    console.error(`sign-in: could not reach the auth server — ${error.message}`);
    return json({ error: UNREACHABLE }, 503, {
      ...headers,
      // Seconds, and deliberately short: the caller is a member staring at a
      // form, not a crawler. Long enough that an instant retry does not hit the
      // same dead connection.
      "Retry-After": "5",
    });
  }

  if (error || !data.user) {
    // Logged, not returned. Whoever is debugging needs to know the difference
    // between a wrong password and a project misconfiguration; the person at the
    // keyboard does not get to.
    console.error(`sign-in: refused for a submitted address — ${error?.message}`);
    return json({ error: REFUSED }, 401, headers);
  }

  // The same upsert /auth/callback performs, for the same reason: nothing else
  // creates public.users, there is no trigger on auth.users, and a session
  // without a profile row is unrecoverable — accountStatus() returns null, the
  // T3.8 gate treats them as unapproved forever, and no leader can see them to
  // approve. Password sign-in is now a second path that can produce a session,
  // so it needs the same guarantee.
  //
  // In practice the row always exists by now, because a password can only be set
  // from inside a session the callback already created. It is here for the case
  // that is not true yet rather than for the case that is.
  const { error: profileError } = await supabase
    .from("users")
    .upsert({ id: data.user.id, email: data.user.email ?? email }, { ignoreDuplicates: true });

  if (profileError) {
    console.error(
      `sign-in: could not ensure profile for ${data.user.id} — ${profileError.message}`,
    );
  }

  // The client navigates rather than this route redirecting, so the middleware
  // re-runs against the cookies this response just set. safeNext keeps
  // `?next=//evil.com` from turning the login form into an open redirect.
  return json({ ok: true, next: safeNext(parsed.data.next) }, 200, headers);
}
