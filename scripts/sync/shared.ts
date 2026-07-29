// T2.5 — Shared plumbing for every sync job.
// 
//   supabase        the service-role client from lib/supabase/admin.ts
//   startSyncLog()  insert a running row, return its id
//   finishSyncLog() set status and error text
//   a top-level error trap so a thrown exception still closes the log row
// 
// R9 — every job writes to sync_log at start and finish. A job that fails silently
// during CWL costs a season of data that cannot be re-fetched from anywhere.

export {};
