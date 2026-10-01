// T9.4 — restore a backup into a scratch database and check what arrived.
//
//   npm run restore:verify -- --dump backups/clanbridge-2026....dump.gpg \
//                             --into "postgresql://postgres:...@...:5432/postgres"
//
// backup.yml has produced a weekly dump since T2.8. That proves a file is
// written. It does not prove the file can be read back, that pg_restore accepts
// it, or that the rows inside are the rows that were in the database — and those
// are three separate ways for a backup to be worthless while still appearing on
// the Actions page as a green tick every Sunday.
//
// WHY THIS IS A SCRIPT AND NOT A ONE-OFF. T9.4 could be discharged by restoring
// a dump once, by hand, and ticking the box. But the thing being tested is not
// the dump, it is the PROCEDURE — the one that has to work on the worst day this
// project ever has, run by somebody who is not calm. A procedure that has been
// executed once, months ago, from memory, is not one you want to meet then.
// Written down, it can be re-run after any change to the schema.
//
// SAFETY: --into is checked against SUPABASE_DB_URL and refused if they match.
// Restoring a week-old dump over the live database would destroy exactly the
// data this task exists to protect.

import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Client } from "pg";
import { PHASE1_TABLES } from "../test/pg-harness";

/**
 * The tables whose contents cannot be re-fetched from anywhere.
 *
 * Everything else in this database is a copy of something Supercell will still
 * tell us: the member list, the current war, the clan's level. If those were
 * lost, the next sync would put them back within the hour.
 *
 * These would not come back. Supercell's CWL endpoints serve the current season
 * and nothing older; a war leaves `currentwar` when the next one starts;
 * `audit_log` and the roster tables are this project's own record of human
 * decisions and exist in no external system at all (R11, R12). A restore that
 * brings back the clan list and loses these has restored the replaceable half.
 */
const IRREPLACEABLE = [
  "audit_log",
  "clan_games",
  "clan_games_scores",
  "cwl_attacks",
  "cwl_bonuses",
  "cwl_roster_members",
  "cwl_rosters",
  "cwl_seasons",
  "cwl_war_members",
  "cwl_wars",
  "member_snapshots",
  "poll_responses",
  "raid_participants",
  "raid_seasons",
  "war_attacks",
  "war_members",
  "wars",
] as const;

/**
 * pg_restore complains about things a managed Postgres already owns. None of
 * these mean the data failed to arrive.
 *
 * Matched narrowly on purpose: a broad filter here would hide the one line that
 * matters, and this script exists precisely to read that line.
 */
const BENIGN = [
  /already exists/i,
  /must be owner of (extension|schema|table|type)/i,
  /permission denied for schema (public|storage|auth)/i,
  /no privileges (were granted|could be revoked)/i,
  /schema "public" already exists/i,
];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * The target, from .env.local in preference to the command line.
 *
 * `npm run` echoes the command it is about to run, so `--into
 * "postgresql://postgres:PASSWORD@..."` prints a database password to the
 * terminal and leaves it in shell history — where it outlives the scratch
 * project it belongs to by however long that history file survives.
 *
 * RESTORE_TARGET_URL in .env.local (gitignored, and the only place this
 * project's other credentials live) avoids that. --into still works, because
 * a scratch database that exists for twenty minutes is a reasonable thing to
 * paste, and refusing would just make people paste it somewhere worse.
 */
function targetUrl(): string | undefined {
  return process.env.RESTORE_TARGET_URL ?? arg("into");
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

/**
 * The weekly dump is gpg-encrypted (backup.yml — the repository is public, and
 * an unencrypted artifact would publish every member's account data). Decrypt
 * it into a private temporary directory that is removed however this script
 * exits, including through fail()'s process.exit().
 *
 * The passphrase is read from BACKUP_PASSPHRASE and handed to gpg on stdin,
 * never as an argument, so it does not appear in the process list.
 */
function decryptIfNeeded(dump: string): string {
  if (!dump.endsWith(".gpg")) return dump;

  const passphrase = process.env.BACKUP_PASSPHRASE;
  if (!passphrase) {
    fail(
      "This dump is encrypted (.gpg). Set BACKUP_PASSPHRASE in .env.local to the\n" +
        "passphrase stored in the repository's BACKUP_PASSPHRASE secret, then re-run.",
    );
  }

  const dir = mkdtempSync(join(tmpdir(), "clanbridge-restore-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const out = join(dir, basename(dump, ".gpg"));

  const gpg = spawnSync(
    "gpg",
    [
      "--batch",
      "--yes",
      "--pinentry-mode",
      "loopback",
      "--passphrase-fd",
      "0",
      "--output",
      out,
      "--decrypt",
      dump,
    ],
    { input: passphrase, encoding: "utf8" },
  );
  if (gpg.error) {
    fail("gpg is not on PATH. Install GnuPG (gnupg.org) to decrypt the backup.");
  }
  if (gpg.status !== 0) {
    fail(`gpg could not decrypt ${dump} — wrong passphrase?\n\n${gpg.stderr ?? ""}`.trim());
  }
  return out;
}

/** Host and database only — never the password, which would end up in a log. */
function describeTarget(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`;
  } catch {
    return "(unparseable connection string)";
  }
}

function connect(url: string): Client {
  return new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 120_000,
  });
}

async function tableCounts(client: Client): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const table of PHASE1_TABLES) {
    try {
      const { rows } = await client.query<{ n: string }>(
        `select count(*)::text as n from public.${table}`,
      );
      counts.set(table, Number(rows[0]!.n));
    } catch {
      // Missing entirely — distinguished from empty below, because the two mean
      // very different things about a restore.
      counts.set(table, -1);
    }
  }
  return counts;
}

async function main(): Promise<void> {
  const dump = arg("dump");
  const into = targetUrl();

  if (!dump || !into) {
    fail(
      "Usage:\n" +
        "  npm run restore:verify -- --dump <file.dump>\n\n" +
        "  --dump  the artifact from the weekly backup workflow (GitHub -> Actions ->\n" +
        "          backup -> Artifacts -> clanbridge-backup), unzipped\n\n" +
        "  The target is RESTORE_TARGET_URL in .env.local: a SCRATCH Supabase project's\n" +
        "  session pooler string, port 5432 (Project Settings -> Database -> Connection\n" +
        "  string -> Session pooler). Put it there rather than on the command line —\n" +
        "  npm echoes the command, and that would print the password to your terminal\n" +
        "  history. `--into <url>` is accepted too if you would rather not store it.",
    );
  }

  if (!existsSync(dump)) fail(`No such file: ${dump}`);

  // ── The guard that matters more than everything below it ───────────────────
  //
  // A restore is the one operation in this project that destroys data rather
  // than adding to it, and R4's protections do not apply: pg_restore does not
  // go through a policy, a grant, or a definer function. Pointing it at
  // production would overwrite live rows with a week-old copy — the exact loss
  // this task exists to prevent, caused by the task itself.
  const live = process.env.SUPABASE_DB_URL;
  if (live && into.trim() === live.trim()) {
    fail(
      "REFUSING TO RUN. --into is the same connection string as SUPABASE_DB_URL,\n" +
        "which is the live database.\n\n" +
        "Create a scratch Supabase project and pass ITS connection string. The\n" +
        "point of this test is a database you can throw away afterwards.",
    );
  }

  const restoreBin = spawnSync("pg_restore", ["--version"], { encoding: "utf8" });
  if (restoreBin.error) {
    fail(
      "pg_restore is not on PATH.\n\n" +
        "Install the PostgreSQL client tools (postgresql.org/download) and make sure\n" +
        "the version is at least as new as Supabase's server — a custom-format dump\n" +
        "written by pg_dump 17 cannot be read by pg_restore 15, and the error it gives\n" +
        '("unsupported version in file header") does not say so.',
    );
  }

  const restorable = decryptIfNeeded(dump);
  const size = statSync(restorable).size;
  console.log("\nRestore verification (T9.4)\n");
  console.log(`  dump    ${dump}  (${(size / 1024 / 1024).toFixed(1)} MB)`);
  console.log(`  into    ${describeTarget(into)}`);
  console.log(`  client  ${restoreBin.stdout.trim()}\n`);

  // ── The target must be empty ───────────────────────────────────────────────
  //
  // Restoring over an existing schema produces a page of "already exists" and a
  // half-merged result that proves nothing: rows present could be from the dump
  // or from what was already there, and there is no way to tell them apart
  // afterwards. A fresh Supabase project has an empty public schema.
  const target = connect(into);
  await target.connect();

  const { rows: before } = await target.query<{ n: string }>(
    "select count(*)::text as n from pg_tables where schemaname = 'public'",
  );
  if (Number(before[0]!.n) > 0) {
    await target.end();
    fail(
      `The target already has ${before[0]!.n} tables in its public schema.\n\n` +
        "Use a brand-new Supabase project. A restore into a populated database\n" +
        "cannot be told apart from one that did nothing.",
    );
  }
  console.log("  target public schema is empty — good\n");

  // ── Restore ────────────────────────────────────────────────────────────────
  console.log("  restoring ...");
  const restore = spawnSync(
    "pg_restore",
    ["--no-owner", "--no-privileges", "--dbname", into, restorable],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );

  const complaints = (restore.stderr ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .filter((line) => !BENIGN.some((p) => p.test(line)));

  console.log(complaints.length ? `  restored with ${complaints.length} unexplained line(s)\n` : "  restored\n");

  // ── What actually arrived ──────────────────────────────────────────────────
  const restored = await tableCounts(target);
  await target.end();

  // Live counts are a reference, not an assertion. The dump is a snapshot and
  // the syncs have run since, so live is EXPECTED to be ahead on append-only
  // tables (R5). Restored ahead of live is the direction that means something.
  let liveCounts: Map<string, number> | null = null;
  if (live) {
    const source = connect(live);
    try {
      await source.connect();
      liveCounts = await tableCounts(source);
    } catch {
      console.log("  (could not read the live database for comparison — skipping that column)\n");
    } finally {
      await source.end().catch(() => {});
    }
  }

  const missing: string[] = [];
  const emptyButShouldNotBe: string[] = [];

  console.log("  table                      restored        live");
  console.log("  ─────────────────────────────────────────────────");
  for (const table of PHASE1_TABLES) {
    const n = restored.get(table)!;
    const l = liveCounts?.get(table) ?? null;

    if (n === -1) missing.push(table);
    if (n === 0 && l !== null && l > 0) emptyButShouldNotBe.push(table);

    const shown = n === -1 ? "MISSING" : String(n);
    const liveShown = l === null ? "" : l === -1 ? "—" : String(l);
    console.log(`  ${table.padEnd(24)} ${shown.padStart(9)}  ${liveShown.padStart(10)}`);
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  console.log("");
  let ok = true;

  if (missing.length) {
    ok = false;
    console.error(`  ✗ ${missing.length} table(s) did not come back: ${missing.join(", ")}`);
  }

  if (emptyButShouldNotBe.length) {
    ok = false;
    console.error(
      `  ✗ ${emptyButShouldNotBe.length} table(s) restored empty while live has rows:\n` +
        `      ${emptyButShouldNotBe.join(", ")}`,
    );
  }

  // Stated separately from the table-by-table result because these are the ones
  // where "restored empty" is not a smaller problem than "did not restore".
  const lostForever = IRREPLACEABLE.filter((t) => {
    const n = restored.get(t)!;
    const l = liveCounts?.get(t);
    return n <= 0 && l !== undefined && l > 0;
  });
  if (lostForever.length) {
    console.error(
      "\n  ✗ These hold data no external system can return (R11/R12):\n" +
        `      ${lostForever.join(", ")}`,
    );
  }

  if (complaints.length) {
    console.error("\n  pg_restore said things this script does not recognise:");
    for (const line of complaints.slice(0, 20)) console.error(`      ${line}`);
    if (complaints.length > 20) console.error(`      ... and ${complaints.length - 20} more`);
    console.error(
      "\n  Read them. Benign patterns are filtered already, so anything printed here\n" +
        "  is either a real failure or a pattern worth adding to BENIGN with a reason.",
    );
    ok = false;
  }

  if (!ok) {
    console.error("\n  RESTORE VERIFICATION FAILED. The backup is not yet proven.\n");
    process.exit(1);
  }

  console.log("  ✓ every table came back, and nothing restored empty that live has rows for.");
  console.log("  ✓ T9.4 satisfied for this dump. Re-run after any schema change.\n");
  console.log("  Now DELETE the scratch Supabase project — the free tier allows two,");
  console.log("  and a forgotten copy of member data is a second place to lose it from.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
