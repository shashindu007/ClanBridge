// T2.5 — Shared plumbing for every sync job.
// 
//   supabase        the service-role client from lib/supabase/admin.ts
//   startSyncLog()  insert a running row, return its id
//   finishSyncLog() set status and error text
//   a top-level error trap so a thrown exception still closes the log row
// 
// R9 — every job writes to sync_log at start and finish. A job that fails silently
// during CWL costs a season of data that cannot be re-fetched from anywhere.
//
// ─────────────────────────────────────────────────────────────────────────────
// R11 — WHAT SYNC JOBS MAY WRITE
//
// These scripts hold the service-role key and bypass RLS entirely, so nothing in
// the database stops them. This list is the only boundary that exists.
//
//   MAY WRITE (game facts, from Supercell):
//     clans, players, clan_roles, member_snapshots
//     cwl_seasons, cwl_wars, cwl_attacks
//     wars, war_attacks
//     raid_seasons, raid_participants, clan_games, clan_games_scores
//     sync_log
//
//   MUST NEVER WRITE (human decisions, entered by people):
//     polls, poll_options, poll_responses
//     cwl_rosters, cwl_roster_members
//     war_lineups, war_lineup_members
//     war_targets, cwl_bonuses, announcements, base_layouts
//
// Sync jobs re-run every few minutes and overwrite. If a leader's roster
// selection sits in a table a job touches, a routine 2 AM run silently erases an
// hour of their work — and R4 means there is no deleted row to recover.
//
// R12 — the plan is compared to reality, never replaced by it. A job that
// "reconciles" cwl_roster_members against the API roster has destroyed the exact
// comparison T4B.11 exists to show.
// ─────────────────────────────────────────────────────────────────────────────

export {};
