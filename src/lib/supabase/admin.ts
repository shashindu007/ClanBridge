// T1.11 — Service-role Supabase client.
//
// ===========================================================================
// THIS CLIENT BYPASSES ROW LEVEL SECURITY ENTIRELY.
//
// It is imported ONLY by scripts/sync/. If anything under src/app/ imports this
// file, the architecture has drifted and R6 is broken — SUPABASE_SERVICE_KEY
// would have to exist as a Vercel environment variable for it to work, and the
// web application has no reason to hold it.
//
// Because RLS does not apply here, the clan filter in a sync job is the ONLY
// thing keeping clans apart (R3). There is no safety net on this side.
// ===========================================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function createAdminClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!url) {
    throw new Error("Missing SUPABASE_URL. See .env.example.");
  }
  if (!serviceKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_KEY. It belongs in GitHub Actions secrets and " +
        ".env.local only, never in Vercel (R6).",
    );
  }

  cached = createClient(url, serviceKey, {
    auth: {
      // A script has no user and no browser. Persisting or refreshing a session
      // would write token files onto the CI runner for no reason.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return cached;
}
