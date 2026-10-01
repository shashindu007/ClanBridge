// T5.5 — Store a Web Push subscription in push_subscriptions.
//
// Called after the permission prompt, which is shown post-login rather than on
// first paint. Subscriptions expire; a 410 Gone from the push service later
// means soft delete the row (R4), not throw — that half lives in lib/push.ts.
//
// R3 does not apply here: a subscription belongs to a user, not a clan. The clan
// filter enters at send time, in push_targets() (023).
//
// THE WRITE IS A PLAIN UPSERT, not a definer function like 021 and 022 use,
// because the subject and the actor are the same person and there is no clan to
// record an audit entry against. Migration 023 makes that argument in full.
// What actually protects this is the policy pinning user_id to auth.uid(): if
// this handler were ever wrong about whose subscription it is writing, the
// database still is not.
//
// T9.7 — rate limited. An endpoint that accepts arbitrary strings and stores
// them, reachable by anyone with a session, does not get to be unlimited.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { rateLimitHeaders, sharedRateLimiter, WRITE_LIMIT } from "@/lib/rate-limit";

/**
 * The browser's PushSubscription.toJSON() shape.
 *
 * `endpoint` must be https and bounded: this server will later POST to that URL,
 * so accepting an arbitrary scheme would turn the send path into a request
 * forger aimed at whatever a caller stored. The key bounds are generous enough
 * not to reject a push service that pads its base64 differently.
 */
const bodySchema = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1000).startsWith("https://"),
    keys: z.object({
      p256dh: z.string().min(16).max(256),
      auth: z.string().min(8).max(256),
    }),
  }),
  /** Set by pushsubscriptionchange in sw.js when replacing a revoked endpoint. */
  replaces: z.string().url().max(1000).optional(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().url().max(1000),
});

function json(body: unknown, status: number, headers?: Record<string, string>) {
  return NextResponse.json(body, { status, headers });
}

/** Shared by both handlers: identify the caller, then spend a little budget. */
async function guard(): Promise<
  | { ok: true; userId: string; headers: Record<string, string> }
  | { ok: false; response: Response }
> {
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) {
    return { ok: false, response: json({ error: "Sign in first." }, 401) };
  }

  let limited;
  try {
    const limiter = await sharedRateLimiter(WRITE_LIMIT);
    limited = await limiter.limit(`push-subscribe:${userId}`);
  } catch {
    // Production without Upstash (T0.9). rate-limit.ts throws on purpose rather
    // than falling back to a per-instance counter that limits nothing.
    return {
      ok: false,
      response: json({ error: "Temporarily unavailable. Try again later." }, 503),
    };
  }

  const headers = rateLimitHeaders(limited);
  if (!limited.success) {
    return {
      ok: false,
      response: json({ error: "Too many requests. Slow down." }, 429, headers),
    };
  }

  return { ok: true, userId, headers };
}

export async function POST(request: Request): Promise<Response> {
  const guarded = await guard();
  if (!guarded.ok) return guarded.response;
  const { userId, headers } = guarded;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "That is not a valid push subscription." }, 400, headers);
  }

  const { subscription, replaces } = parsed.data;
  const supabase = await createClient();

  // Through claim_push_subscription() (056), which upserts on the endpoint 004
  // made unique.
  //
  // Re-subscribing on an endpoint already held is the normal case, not an error:
  // the browser hands back the same endpoint every time until it rotates one, so
  // a member opening the app twice on one device arrives here twice. This also
  // revives a row previously retired by a 410, by clearing deleted_at.
  //
  // NOT A PLAIN UPSERT ANY MORE. A browser has one endpoint, so a second account
  // signing in on the same device arrives with an endpoint the FIRST account's
  // row already holds. RLS refused to hand that row over, this route answered
  // 500, and the device went on receiving the first account's notifications.
  // The function gives the endpoint to whoever is signed in now. The user id is
  // auth.uid() inside it, so this handler cannot claim for anybody else.
  const { data: claimed, error } = await supabase.rpc("claim_push_subscription", {
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.keys.p256dh,
    p_auth: subscription.keys.auth,
  });

  if (error || claimed !== true) {
    // Logged without the endpoint — an endpoint is a capability URL and does
    // not go in a log.
    console.error(
      `push/subscribe: claim failed — ${error?.message ?? "refused by claim_push_subscription"}`,
    );
    return json({ error: "Could not save that subscription." }, 500, headers);
  }

  // A rotated endpoint leaves its predecessor behind, and the push service will
  // never accept that one again. Retiring it here saves the send path a request
  // per notification discovering the same thing.
  if (replaces && replaces !== subscription.endpoint) {
    await supabase
      .from("push_subscriptions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("endpoint", replaces)
      .eq("user_id", userId)
      .is("deleted_at", null);
  }

  return json({ ok: true }, 200, headers);
}

/**
 * Turning notifications off on this device.
 *
 * The HTTP method is DELETE; the statement is an UPDATE setting deleted_at (R4).
 * The row stays, so re-subscribing later revives it rather than colliding with
 * the unique index on endpoint.
 */
export async function DELETE(request: Request): Promise<Response> {
  const guarded = await guard();
  if (!guarded.ok) return guarded.response;
  const { userId, headers } = guarded;

  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "Send the endpoint to remove." }, 400, headers);
  }

  const supabase = await createClient();

  // Scoped to the caller as well as to the endpoint. The policy enforces the
  // same restriction, so this is the second of two checks rather than the only
  // one — but without it the statement would read "retire this endpoint" rather
  // than "retire my endpoint", and those differ the day the policy is edited.
  const { error } = await supabase
    .from("push_subscriptions")
    .update({ deleted_at: new Date().toISOString() })
    .eq("endpoint", parsed.data.endpoint)
    .eq("user_id", userId)
    .is("deleted_at", null);

  if (error) {
    console.error(`push/subscribe: unsubscribe failed — ${error.message}`);
    return json({ error: "Could not remove that subscription." }, 500, headers);
  }

  // Deliberately 200 whether or not a row matched. Reporting which endpoints
  // exist would answer a probe, and to the member "it is off now" is true either
  // way.
  return json({ ok: true }, 200, headers);
}
