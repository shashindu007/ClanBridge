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
  // Excluding anything with a file extension is safe here because a clan tag
  // never contains a dot — they arrive URL-encoded as %232G8YQYRGJ, and
  // lib/tags.ts rejects anything outside [0289PYLQGRJCUV].
  matcher: [
    "/((?!_next/static|_next/image|icons/|manifest.json|sw.js|.*\\..*$).*)",
  ],
};
