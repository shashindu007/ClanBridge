// T3.2 — Session middleware.
//
// Refreshes the Supabase session cookie on every request and redirects
// unauthenticated users to /login. Delegates to lib/supabase/middleware.ts (T1.11).
//
// This file must live at src/middleware.ts — Next.js will not pick it up anywhere else.

import { type NextRequest, NextResponse } from "next/server";

export async function middleware(_request: NextRequest) {
  // TODO T3.2: return await updateSession(request)
  return NextResponse.next();
}

export const config = {
  // Skip static assets, images, and the service worker (T5.4).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json|sw.js).*)",
  ],
};
