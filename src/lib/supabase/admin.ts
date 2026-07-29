// T1.11 — Service-role client. BYPASSES RLS ENTIRELY.
// 
// Imported only by scripts/. If a file under src/app/ ever imports this, the
// architecture has drifted and R6 is broken: SUPABASE_SERVICE_KEY would have to
// exist in Vercel for it to work.

export {};
