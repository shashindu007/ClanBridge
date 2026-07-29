// T1.11 — Supabase client for Client Components.
//
// Anon key only. It is public by design: RLS (T1.9) is what protects the data,
// not the secrecy of this key.
//
// R6 — never import admin.ts from anywhere this file can reach. Anything a
// Client Component imports is shipped to the browser.

"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    requireEnv(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  );
}

// Next.js inlines process.env.NEXT_PUBLIC_* at build time only when written as a
// static member expression, so the values are passed in rather than looked up by
// name the way server.ts does.
function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`);
  }
  return value;
}
