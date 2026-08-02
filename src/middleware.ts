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
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js).*)",
  ],
};
