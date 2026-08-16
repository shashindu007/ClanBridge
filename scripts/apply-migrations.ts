// Apply migrations to Supabase directly, over the Postgres connection.
//
//   npm run migrations:apply            apply anything not yet recorded
//   npm run migrations:apply -- --list  show what is applied and what is pending
//
// Replaces pasting SQL into the dashboard by hand. Pasting works, but it has no
// memory: nothing records which files ran, so "did 014 get applied?" is answered
// by guessing. This keeps a ledger.
//
// Each file runs inside its own transaction, so a failure rolls that file back
// and stops — you never end up half-applied.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import {
  LIVE_ONLY_MIGRATIONS,
  PHASE1_MIGRATIONS,
  RETIRED_MIGRATIONS,
} from "../test/pg-harness";

const DIR = join(process.cwd(), "supabase", "migrations");

/**
 * What this script applies: the harness's list, then the ones only Supabase can
 * run (the Storage bucket, 029). Numeric order is preserved because LIVE_ONLY
 * files are always later than the schema they depend on — 029 needs
 * public.clan_roles, which 001 created.
 */
const TO_APPLY = [...PHASE1_MIGRATIONS, ...LIVE_ONLY_MIGRATIONS];

/**
 * Refuse to run if any .sql file is in none of the three lists.
 *
 * This exists because of a near miss. 029 was written, committed, tested as far
 * as it could be, and left out of PHASE1_MIGRATIONS on purpose — and
 * `migrations:apply` then read that list and printed "Nothing to do", which was
 * a true statement about the list and a false one about the database. Nothing
 * anywhere said the word 029.
 *
 * A missing migration has no symptom at apply time. It surfaces later as a
 * feature that fails for one user, in production, with an error from Postgres or
 * the storage service that names a table or a bucket and never names a file. So
 * the check is a hard stop rather than a warning: the cost of stopping is
 * re-reading this comment, and the cost of continuing is a bug that looks like
 * anything except what it is.
 */
function assertEveryFileIsAccountedFor(): void {
  const known = new Set<string>([
    ...PHASE1_MIGRATIONS,
    ...LIVE_ONLY_MIGRATIONS,
    ...RETIRED_MIGRATIONS,
  ]);

  const orphans = readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !known.has(f))
    .sort();

  if (!orphans.length) return;

  console.error(
    `\n  ${orphans.length} migration file(s) are in no list, so this script does not\n` +
      "  know whether to apply them:\n\n" +
      orphans.map((f) => `    ${f}`).join("\n") +
      "\n\n  Add each one to test/pg-harness.ts:\n\n" +
      "    PHASE1_MIGRATIONS     runs on PGlite and on Supabase — the normal case\n" +
      "    LIVE_ONLY_MIGRATIONS  Supabase only (touches storage, auth, or another\n" +
      "                          schema plain Postgres does not have)\n" +
      "    RETIRED_MIGRATIONS    comment-only; nothing applies it\n",
  );
  process.exit(1);
}

/**
 * Records which migrations have run. Section 4: never edit an applied file.
 *
 * RLS on with no policy = default deny, so this is invisible to anon and
 * authenticated no matter what the grants say. Today it happens to be denied
 * anyway, because it was created before 014's ALTER DEFAULT PRIVILEGES took
 * effect — but relying on that ordering is luck, and a recreated ledger would
 * silently inherit anon read access. Schema history is not much of a secret, but
 * default-deny is the rule everywhere else in this database and tooling should
 * not be the exception.
 *
 * service_role bypasses RLS, so this script keeps working.
 */
const LEDGER = `
create table if not exists schema_migrations (
  filename    text primary key,
  applied_at  timestamptz not null default now(),
  checksum    text
);

alter table schema_migrations enable row level security;
revoke all on schema_migrations from anon, authenticated;
`;

/** Cheap change-detection, so an edited-after-applying file is caught (section 4). */
function checksum(sql: string): string {
  let hash = 0;
  for (const ch of sql) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}

async function main(): Promise<void> {
  assertEveryFileIsAccountedFor();

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      "SUPABASE_DB_URL is not set in .env.local.\n" +
        "Use the SESSION pooler string (port 5432), not the transaction pooler (6543).",
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    // Supabase requires TLS; its pooler presents a cert this client will not chain
    // to a local root, which is normal for a managed service.
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120_000,
  });

  await client.connect();
  console.log("Connected to Supabase\n");

  try {
    await client.query(LEDGER);

    const { rows } = await client.query<{ filename: string; checksum: string }>(
      "select filename, checksum from schema_migrations",
    );
    const applied = new Map(rows.map((r) => [r.filename, r.checksum]));

    // Anything already in the database but not in our list — e.g. applied by hand
    // through the dashboard before this script existed.
    const listOnly = process.argv.includes("--list");

    // Files applied by hand before the ledger existed are unknown to it. Detect
    // that by asking the database whether the tables are already there.
    const { rows: existing } = await client.query<{ n: string }>(
      "select count(*)::text as n from pg_tables where schemaname = 'public'",
    );
    const tableCount = Number(existing[0]!.n);

    console.log(`  ledger: ${applied.size} recorded`);
    console.log(`  public schema: ${tableCount} tables\n`);

    let pending = 0;
    for (const file of TO_APPLY) {
      const liveOnly = (LIVE_ONLY_MIGRATIONS as readonly string[]).includes(file);
      const sql = readFileSync(join(DIR, file), "utf8");
      const sum = checksum(sql);
      const previous = applied.get(file);

      // Marked in the output because it is the one class of file the test suite
      // never saw. If it breaks, it breaks here or in production, nowhere else.
      const mark = liveOnly ? "  [supabase only — not covered by npm test]" : "";

      if (previous === sum) {
        console.log(`  applied   ${file}${mark}`);
        continue;
      }

      if (previous && previous !== sum) {
        // Section 4: a migration is never edited after it has been applied.
        console.error(
          `\n  CHANGED   ${file} was applied earlier but its contents differ now.\n` +
            "  Section 4 forbids editing an applied migration. Fix forward with a\n" +
            "  new numbered file instead.",
        );
        process.exit(1);
      }

      pending += 1;
      if (listOnly) {
        console.log(`  PENDING   ${file}${mark}`);
        continue;
      }

      // Own transaction per file: a failure rolls back that file and stops.
      process.stdout.write(`  applying  ${file} ... `);
      try {
        await client.query("begin");
        await client.query(sql);
        await client.query(
          "insert into schema_migrations (filename, checksum) values ($1, $2) " +
            "on conflict (filename) do update set checksum = excluded.checksum, applied_at = now()",
          [file, sum],
        );
        await client.query("commit");
        console.log("ok");
      } catch (error) {
        await client.query("rollback").catch(() => {});
        const message = error instanceof Error ? error.message : String(error);

        // Re-applying a file that was pasted by hand hits "already exists". That
        // is not a failure — record it and move on.
        if (/already exists/i.test(message)) {
          await client.query(
            "insert into schema_migrations (filename, checksum) values ($1, $2) " +
              "on conflict (filename) do update set checksum = excluded.checksum",
            [file, sum],
          );
          console.log("already applied by hand — recorded in the ledger");
          continue;
        }

        console.log("FAILED");
        console.error(`\n  ${message}\n\n  Rolled back. Nothing from this file was applied.`);

        // The storage schema is owned by supabase_storage_admin, and on some
        // projects the pooler's role cannot create policies on it. Postgres says
        // "must be owner of table objects", which reads like the migration is
        // wrong rather than like the connection is. It is not wrong; it is the
        // one file that has to be pasted into the dashboard's SQL editor, which
        // runs as a role that does own it.
        if (liveOnly && /must be owner|permission denied/i.test(message)) {
          console.error(
            `\n  ${file} touches a schema Supabase owns.\n` +
              "  Paste it into the dashboard SQL editor instead (SQL Editor -> New query),\n" +
              "  then re-run this script — it will see the objects already exist and\n" +
              "  record the file in the ledger.",
          );
        }

        process.exit(1);
      }
    }

    if (listOnly) {
      console.log(`\n  ${pending} pending`);
      return;
    }

    console.log(
      pending === 0
        ? "\nNothing to do — every migration is already applied."
        : `\nApplied ${pending} migration(s). Verify with: npm run supabase:check`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
