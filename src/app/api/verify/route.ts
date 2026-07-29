// T3.3 — Player verification.
//
// Input: a player tag plus the in-game API token. Calls Supercell's
// /players/{tag}/verifytoken, and on success sets players.verified = true
// and links user_id.
//
// R8 — the token is verified and discarded. Never stored, never logged, never
// included in an error message or a Sentry breadcrumb.
//
// This is the one documented exception to R1: it is a verification handshake,
// not a data read, and there is no way to perform it from a sync job.
//
// Rate limited via lib/rate-limit.ts — 5 attempts per user per hour.

export async function POST(): Promise<Response> {
  return new Response("Not implemented — T3.3", { status: 501 });
}
