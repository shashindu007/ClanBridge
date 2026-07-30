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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { PHASE1_MIGRATIONS } from "../test/pg-harness";

const DIR = join(process.cwd(), "supabase", "migrations");

/** Records which migrations have run. Section 4: never edit an applied file. */
const LEDGER = `
create table if not exists schema_migrations (
  filename    text primary key,
  applied_at  timestamptz not null default now(),
  checksum    text
);
`;

/** Cheap change-detection, so an edited-after-applying file is caught (section 4). */
function checksum(sql: string): string {
  let hash = 0;
  for (const ch of sql) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash.toString(16);
}

async function main(): Promise<void> {
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
    for (const file of PHASE1_MIGRATIONS) {
      const sql = readFileSync(join(DIR, file), "utf8");
      const sum = checksum(sql);
      const previous = applied.get(file);

      if (previous === sum) {
        console.log(`  applied   ${file}`);
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
        console.log(`  PENDING   ${file}`);
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
