// T3.2 — Session middleware.
//
// Refreshes the Supabase session cookie on every request and redirects
// unauthenticated users to /login. Delegates to lib/supabase/middleware.ts (T1.11).
//
// This file must live at src/middleware.ts — Next.js will not pick it up anywhere else.
//
// This is authentication, not authorisation. It proves there is a session; it
// says nothing about whether the account is approved (T3.8, enforced in
// (app)/layout.tsx) or which clans it may see (R3, enforced by RLS and by every
// service-layer query). A session is the floor, not the ceiling.

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Skip static assets, images, and the service worker (T5.4).
  //
  // T10.9 — the trailing `\..*$` clause is new, and it is the one that matters.
  //
  // The named exclusions only covered the files this project knew it had.
  // Browsers ask for others unprompted — /favicon.ico, /apple-touch-icon.png,
  // /robots.txt — and because `[clanTag]` is a dynamic segment at the ROOT of
  // the routing tree, every one of those matched it. The dev log showed the
  // result: `GET /favicon.ico 307 in 2965ms`, a full session lookup and a
  // redirect, for an icon, on every single page load.
  //
  // ONLY REAL STATIC EXTENSIONS, AT THE END OF THE PATH (QA, 046). The first
  // version excluded any path with a dot ANYWHERE, on the grounds that a clan
  // tag never contains one. True of valid URLs, not of requests: `/%23TAG.x/war`
  // still routed to [clanTag]/war — whose module holds Server Actions — with no
  // middleware at all. No session refresh, no login redirect, and no rewrite of
  // the forwarded user-id header that lib/auth.ts trusts precisely BECAUSE the
  // middleware always rewrites it. Skipping must mean "a file", never
  // "anything that looks a bit like one".
  matcher: [
    "/((?!_next/static|_next/image|icons/|manifest.json|sw.js|.*\\.(?:ico|png|jpe?g|gif|svg|webp|avif|txt|xml|webmanifest|js|mjs|css|map|woff2?|ttf)$).*)",
  ],
};
