// T3.3 — Player verification.
//
// Input: a player tag plus the in-game API token. Calls Supercell's
// /players/{tag}/verifytoken, and on success sets players.verified = true
// and links user_id.
//
// R8 — the token is verified and discarded. Never stored, never logged, never
// included in an error message or a Sentry breadcrumb. It exists only as a local
// parameter in this file and as a request body to Supercell. Note that no branch
// below puts `body.token` into a response, a console call, or a thrown error.
//
// This is the one documented exception to R1: it is a verification handshake,
// not a data read, and there is no way to perform it from a sync job.
//
// Rate limited via lib/rate-limit.ts — 5 attempts per user per hour.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { rateLimitHeaders, sharedRateLimiter, VERIFY_LIMIT } from "@/lib/rate-limit";
import { InvalidTagError, normaliseTag } from "@/lib/tags";
import { verifyPlayerToken } from "@/integration/coc-client";
import { CocAuthError, CocError } from "@/integration/errors";

/**
 * The in-game token is 8+ characters of opaque text. It is length-checked only —
 * never echoed, and never pattern-matched in a way that would end up describing
 * it in a validation message.
 */
const bodySchema = z.object({
  playerTag: z.string().min(2).max(20),
  token: z.string().min(4).max(64),
});

// sharedRateLimiter, not getRateLimiter: the limiter must be process-wide or the
// count resets every request. A route module may only export request handlers, so
// that memoisation and its test seam live in lib/rate-limit.ts.

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers });
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();

  // Identity first: the rate limit is per user, so it needs one to key on, and
  // an unauthenticated caller must not be able to consume anyone's budget.
  const userId = await currentUserId(supabase);
  if (!userId) {
    return json({ error: "Sign in before verifying a player." }, 401);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Send a player tag and an in-game API token." }, 400);
  }

  // Rate limit BEFORE calling Supercell. The limit exists to stop this route
  // being used as an open proxy to the game API, so it has to sit in front of the
  // only call that reaches the game API.
  let limited;
  try {
    const limiter = await sharedRateLimiter(VERIFY_LIMIT);
    limited = await limiter.limit(`verify:${userId}`);
  } catch {
    // getRateLimiter throws in production when Upstash is unconfigured, on
    // purpose: an ineffective limiter is worse than none. Fail closed rather
    // than proceeding unlimited.
    return json(
      { error: "Verification is temporarily unavailable. Try again later." },
      503,
    );
  }

  const headers = rateLimitHeaders(limited);
  if (!limited.success) {
    return json(
      { error: "Too many verification attempts. Try again in an hour." },
      429,
      headers,
    );
  }

  let tag: string;
  try {
    tag = normaliseTag(parsed.data.playerTag);
  } catch (error) {
    if (error instanceof InvalidTagError) {
      return json({ error: "That is not a valid player tag." }, 400, headers);
    }
    throw error;
  }

  let ok: boolean;
  try {
    ok = await verifyPlayerToken(tag, parsed.data.token);
  } catch (error) {
    if (error instanceof CocAuthError) {
      // COC_API_TOKEN missing or rejected. A configuration fault on our side, so
      // it must not read as though the member typed something wrong.
      console.error("verify: game API credentials rejected or absent");
      return json(
        { error: "Verification is temporarily unavailable. Try again later." },
        503,
        headers,
      );
    }
    if (error instanceof CocError) {
      console.error(`verify: ${error.name} on ${error.endpoint}`);
      return json(
        { error: "Could not reach the game API. Try again in a moment." },
        502,
        headers,
      );
    }
    throw error;
  }

  if (!ok) {
    // A wrong or expired token. Ordinary and common — the token rotates every
    // time the member opens that screen in game.
    return json(
      {
        error:
          "That token was not accepted. Open the game and copy a fresh one — it " +
          "changes each time you view it.",
      },
      422,
      headers,
    );
  }

  // Ownership is proven. The write itself is a definer function (016), because
  // `players` is select-only for a session and must stay that way (R11).
  const { data, error } = await supabase.rpc("link_verified_player", { p_tag: tag });

  if (error) {
    if (/already linked to another account/.test(error.message)) {
      return json(
        {
          error:
            "That player is already linked to a different ClanBridge account. " +
            "Ask a leader to sort it out.",
        },
        409,
        headers,
      );
    }
    console.error(`verify: link_verified_player failed — ${error.message}`);
    return json({ error: "Could not link that player. Try again." }, 500, headers);
  }

  const result = data as { ok: boolean; reason?: string; clan_id?: string } | null;

  if (!result?.ok) {
    if (result?.reason === "not_a_member") {
      return json(
        {
          error:
            "That player is not in any clan on this platform. Join one of the " +
            "clans in game first, then verify again.",
        },
        404,
        headers,
      );
    }
    return json({ error: "Could not link that player." }, 400, headers);
  }

  // Verified, linked, and routed to that clan's leader — but NOT approved.
  // Approval is a deliberate human act (approve_account, 015). Saying so here is
  // what stops a member refreshing for an hour wondering why nothing appeared.
  return json(
    {
      ok: true,
      message:
        "Verified. A leader of your clan has been asked to approve your account.",
    },
    200,
    headers,
  );
}
