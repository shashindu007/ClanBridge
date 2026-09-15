// T11.10 — the signed-in member's own picture, as a URL the shell can point at.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A ROUTE AND NOT A SIGNED URL IN THE LAYOUT
//
// (app)/layout.tsx runs on every navigation in the product. Minting a signed URL
// there would add a Storage round trip to every page load — which is exactly the
// cost T10.9 spent a phase removing from that file, and it would be paid on every
// page to render a 32-pixel circle. A redirect here is cached by the browser for
// the life of the signature instead.
//
// THERE IS NO ID PARAMETER, and that is the security design rather than an
// omission. The route signs `users.avatar_path` for whoever is asking and has no
// way to be asked about anybody else, so there is no IDOR to get wrong — the
// usual shape, /avatar?user=<id> with a permission check, is one forgotten check
// away from serving any member's photograph to any other. 035's storage policy is
// the second layer underneath: it refuses to sign a path outside the caller's own
// folder even if this file were wrong.
//
// A PUBLIC BUCKET WAS THE OTHER OPTION AND IS REJECTED. It would need no route at
// all. It also serves every object to anyone who ever sees a URL, forever, and
// these are photographs of people — 035's header makes the argument that a face
// is not a base screenshot.
// ─────────────────────────────────────────────────────────────────────────────
//
// R1 — reads PostgreSQL and Storage, never the game API. R6 — holds no secret;
// the signature is minted by Supabase under the caller's own session.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { accountProfile, currentUserId } from "@/lib/auth";

/**
 * An hour, matching /account and [clanTag]/layouts.
 *
 * The browser is told to cache for slightly less, so a cached redirect can never
 * outlive the signature it points at — an expired signed URL renders as a broken
 * image, and a member would have no way to tell that from a lost picture.
 */
const SIGNED_URL_TTL = 60 * 60;
const CACHE_SECONDS = SIGNED_URL_TTL - 60;

export async function GET(): Promise<Response> {
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  // The middleware already turned away anonymous requests, so arriving here
  // without a user means the session expired mid-flight. 401 rather than a
  // redirect to /login: this URL is only ever the src of an <img>, and sending
  // HTML to an image tag produces a broken image plus a confusing log line.
  if (!userId) return new NextResponse(null, { status: 401 });

  // cache()d per request and already awaited by the layout on a page load, so on
  // the common path this costs nothing extra.
  const profile = await accountProfile(supabase, userId);
  if (!profile?.avatarPath) return new NextResponse(null, { status: 404 });

  const { data, error } = await supabase.storage
    .from("avatars")
    .createSignedUrl(profile.avatarPath, SIGNED_URL_TTL);

  // A path that will not sign is the deliberate hole 034 records: the column is
  // owner-writable, so a member can point it at an object that does not exist or
  // is not theirs. 404 is the honest answer and the shell simply shows no picture.
  if (error || !data?.signedUrl) return new NextResponse(null, { status: 404 });

  return NextResponse.redirect(data.signedUrl, {
    // PRIVATE, not public. A shared cache holding this would serve one member's
    // picture to the next person behind the same proxy. `private` also keeps it
    // out of any CDN, which is the same reason the layouts page refuses to put
    // signed URLs through next/image.
    headers: { "Cache-Control": `private, max-age=${CACHE_SECONDS}` },
  });
}
