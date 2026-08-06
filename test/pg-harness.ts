// QA harness — runs the real migrations against a real Postgres.
//
// PGlite is Postgres compiled to WASM, running in-process. No Docker daemon and
// no Supabase project needed, which is what makes this runnable today.
//
// PGlite is stock Postgres, NOT Supabase. Everything Supabase provides that the
// migrations depend on has to be recreated here: the auth schema, auth.uid(),
// the anon and authenticated roles, and the table grants that Supabase's default
// privileges normally hand out. Where this file guesses, it is noted.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/**
 * Every migration written so far, in the order the SQL editor must apply them.
 *
 * TWO NUMBERS ARE ABSENT, both retired rather than reused, so that apply order
 * stays equal to numeric order:
 *
 *   009  held cwl_signups from the superseded T4.9, which Phase 4B replaced
 *        with polls and rosters.
 *   012  reserved war_lineups for T6.8 and was never written. 024 delivered
 *        those tables instead and says so in its header.
 *
 * 010 must precede 011 and 022: it defines auth_leadership_clan_ids(), which
 * both of their policies depend on.
 */
export const PHASE1_MIGRATIONS = [
  "001_core.sql",
  "002_cwl.sql",
  "003_war.sql",
  "004_features.sql",
  "005_operational.sql",
  "006_rls.sql",
  "007_member_snapshots.sql", // T2.9
  "008_player_left_at.sql", // T3.9
  "010_polls.sql", // T4B.1 polls, options, responses
  "011_cwl_rosters.sql", // T4B.6 the leader's CWL selection + double-booking guard
  "013_user_status.sql", // T3.8
  "014_service_role_grants.sql", // fixes a missing grant in 006
  "015_platform_admin.sql", // leader-managed clans, superseding T1.10's seed
  "016_player_verification.sql", // T3.3 link_verified_player() + requested_clan_id guard
  "017_approval_grants_membership.sql", // T3.8 approval also grants clan_roles
  "018_admin_may_approve_clanless.sql", // restores 015's platform-admin capability
  "019_cwl_war_members.sql", // T4.1 the API-reported CWL roster; missed attacks derive from it
  "020_clan_details.sql", // T3B.0 level, war league, member count, war-log visibility
  "021_announcements.sql", // T5.1 post/edit/remove as audited definer functions
  "022_cwl_bonus_awards.sql", // T4.7/T4B.13 bonus awards in the leader's order
  "023_notifications.sql", // T5.5/T5.9/T5.6 push write policies, preferences, push_targets()
  "024_war.sql", // Phase 6 war_members, war lineups, and war_targets' write path
  "025_war_target_claim.sql", // T6.4 the member-claim path 024 left with no write route
] as const;

export function readMigration(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8");
}

export function readSeed(): string {
  return readFileSync(join(process.cwd(), "supabase", "seed.sql"), "utf8");
}

/**
 * Recreate the parts of a Supabase database the migrations rely on.
 *
 * auth.uid() is implemented the way Supabase implements it — reading the `sub`
 * claim out of the `request.jwt.claims` setting — so the RLS policies exercise
 * the same code path they will in production.
 */
async function installSupabaseScaffolding(db: PGlite): Promise<void> {
  await db.exec(`
    create schema if not exists auth;

    -- 001_core.sql has a foreign key to this table.
    create table auth.users (
      id    uuid primary key,
      email text
    );

    create or replace function auth.uid()
    returns uuid
    language sql
    stable
    as $$
      -- The inner nullif is load-bearing. Casting '' to json raises
      -- "invalid input syntax for type json", so the empty setting must be
      -- turned into NULL BEFORE the cast, not after. An earlier version had the
      -- nullif on the outside and blew up the moment anything called auth.uid()
      -- while no session was set — which a trigger does.
      select nullif(
        nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub',
        ''
      )::uuid
    $$;

    -- The three roles Supabase ships. anon is an unauthenticated visitor holding
    -- only the public key; authenticated is a signed-in user; service_role is
    -- what the sync jobs use and it bypasses RLS.
    --
    -- service_role was missing here originally, and that omission is exactly why
    -- the missing grant in 006_rls.sql survived every test and only surfaced on
    -- first contact with real Supabase. A role the harness never assumes is a
    -- role whose privileges are never checked.
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;

    grant usage on schema public to anon, authenticated, service_role;
    grant usage on schema auth   to anon, authenticated, service_role;
  `);
}

// NOTE: table grants are deliberately NOT issued here. 006_rls.sql grants them
// itself, so this harness exercises the migration's own grants rather than
// papering over their absence.

export interface Harness {
  db: PGlite;
  /** Act as a signed-in user. RLS applies. */
  asUser(userId: string): Promise<void>;
  /** Act as an unauthenticated visitor. RLS applies, auth.uid() is null. */
  asAnon(): Promise<void>;
  /** Act as a sync job. Bypasses RLS, but table privileges still apply. */
  asServiceRole(): Promise<void>;
  /** Drop back to superuser for fixture setup. RLS is bypassed. */
  asSuperuser(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Boot Postgres, apply 001-006, and return a handle.
 *
 * @param migrations override for tests that need a deliberately broken schema.
 */
export async function createHarness(
  migrations: readonly string[] | { sql: string[] } = PHASE1_MIGRATIONS,
): Promise<Harness> {
  const db = new PGlite();
  await installSupabaseScaffolding(db);

  const statements = Array.isArray(migrations)
    ? (migrations as readonly string[]).map(readMigration)
    : (migrations as { sql: string[] }).sql;

  for (const sql of statements) {
    await db.exec(sql);
  }

  return {
    db,

    async asUser(userId: string) {
      // reset role first: `set role` from a non-superuser cannot climb back up.
      await db.exec(`reset role;`);
      await db.query(`select set_config('request.jwt.claims', $1, false)`, [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      await db.exec(`set role authenticated;`);
    },

    async asAnon() {
      await db.exec(`reset role;`);
      await db.exec(`select set_config('request.jwt.claims', '', false);`);
      await db.exec(`set role anon;`);
    },

    async asServiceRole() {
      await db.exec(`reset role;`);
      await db.exec(`select set_config('request.jwt.claims', '', false);`);
      await db.exec(`set role service_role;`);
    },

    async asSuperuser() {
      await db.exec(`reset role;`);
      await db.exec(`select set_config('request.jwt.claims', '', false);`);
    },

    async close() {
      await db.close();
    },
  };
}

/** Every table the Phase 1 migrations create. Kept explicit so a new table must be added here consciously. */
export const PHASE1_TABLES = [
  "announcements",
  "audit_log",
  "base_layouts",
  "clan_games",
  "clan_games_scores",
  "clan_roles",
  "clans",
  "cwl_attacks",
  "cwl_bonuses",
  "cwl_roster_members",
  "cwl_rosters",
  "cwl_seasons",
  "cwl_war_members",
  "cwl_wars",
  "member_snapshots",
  "notification_preferences",
  "players",
  "poll_options",
  "poll_responses",
  "polls",
  "push_subscriptions",
  "raid_participants",
  "raid_seasons",
  "sync_log",
  "users",
  "war_attacks",
  "war_lineup_members",
  "war_lineups",
  "war_members",
  "war_targets",
  "wars",
] as const;
