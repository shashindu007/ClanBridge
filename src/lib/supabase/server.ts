// T1.11 — Supabase client for Server Components, Server Actions and route handlers.
//
// Uses the ANON key and the caller's session cookie, so every query runs under
// RLS (006_rls.sql). That is the safety net for a query that forgets its clan
// filter (R3) — it is not a reason to omit the filter.
//
// R6 — this file must never reference SUPABASE_SERVICE_KEY. The service client
// lives in admin.ts and is imported only by scripts/.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. This is expected and safe to
            // ignore, because src/middleware.ts (T3.2) refreshes the session on
            // every request before the component ever runs.
          }
        },
      },
    },
  );
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Fail loudly at startup. A missing URL otherwise surfaces much later as an
    // empty result set, which looks identical to "RLS denied you everything".
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}
