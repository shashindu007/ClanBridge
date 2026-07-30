// Connectivity and RLS check against the real Supabase project.
//
//   npm run supabase:check
//
// Two things this proves that PGlite never could:
//
//   1. The project is reachable and the migrations are applied.
//   2. T1.9's done-when, for real: with the ANON key and no session, every table
//      returns zero rows. That has only ever been asserted against a stand-in,
//      and finding F6 (whether Supabase's default privileges grant what
//      006_rls.sql assumes) is only answerable here.
//
// Uses the anon key only. It needs no service key, so it is safe to run before
// the privileged credentials are in place.

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** Every table migrations 001-008 and 013 create. */
const TABLES = [
  "clans",
  "users",
  "players",
  "clan_roles",
  "cwl_seasons",
  "cwl_wars",
  "cwl_attacks",
  "cwl_bonuses",
  "wars",
  "war_targets",
  "war_attacks",
  "raid_seasons",
  "raid_participants",
  "clan_games",
  "clan_games_scores",
  "base_layouts",
  "announcements",
  "push_subscriptions",
  "sync_log",
  "audit_log",
  "member_snapshots",
];

interface Probe {
  table: string;
  status: number;
  rows: number | null;
  detail?: string;
}

async function probe(table: string): Promise<Probe> {
  const response = await fetch(`${URL_}/rest/v1/${table}?select=*&limit=5`, {
    headers: { apikey: ANON!, Authorization: `Bearer ${ANON}` },
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 160);
    try {
      const parsed = JSON.parse(text) as { message?: string; code?: string };
      detail = `${parsed.code ?? ""} ${parsed.message ?? ""}`.trim();
    } catch {
      /* keep the raw text */
    }
    return { table, status: response.status, rows: null, detail };
  }

  const body = JSON.parse(text) as unknown[];
  return { table, status: response.status, rows: body.length };
}

async function main(): Promise<void> {
  if (!URL_ || !ANON) {
    console.error(
      "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is missing from .env.local.",
    );
    process.exit(1);
  }

  console.log(`Checking ${URL_}\n`);

  // Reachability first: a wrong URL or a paused project should not look like 21
  // separate table failures.
  try {
    const root = await fetch(`${URL_}/rest/v1/`, {
      headers: { apikey: ANON },
      signal: AbortSignal.timeout(15_000),
    });
    console.log(`  REST endpoint reachable (HTTP ${root.status})\n`);
  } catch (error) {
    console.error(
      `  UNREACHABLE — ${error instanceof Error ? error.message : String(error)}\n` +
        "  Check the project URL, and that the project is not paused.",
    );
    process.exit(1);
  }

  const results: Probe[] = [];
  for (const table of TABLES) results.push(await probe(table));

  const missing = results.filter((r) => r.status === 404);
  const leaking = results.filter((r) => r.rows !== null && r.rows > 0);
  const denied = results.filter((r) => r.status === 401 || r.status === 403);
  const empty = results.filter((r) => r.rows === 0);
  const other = results.filter(
    (r) => r.status !== 404 && r.status !== 401 && r.status !== 403 && r.rows === null,
  );

  for (const r of results) {
    const verdict =
      r.status === 404
        ? "NOT CREATED"
        : r.rows === 0
          ? "ok, 0 rows"
          : r.rows !== null
            ? `LEAKING ${r.rows} rows`
            : `HTTP ${r.status}`;
    console.log(`  ${verdict.padEnd(18)} ${r.table}${r.detail ? ` — ${r.detail}` : ""}`);
  }

  console.log(
    `\n  ${empty.length}/${TABLES.length} return zero rows to anon` +
      `${missing.length ? `, ${missing.length} not created` : ""}` +
      `${denied.length ? `, ${denied.length} permission-denied` : ""}`,
  );

  if (missing.length === TABLES.length) {
    console.error(
      "\nNo tables exist yet. Apply the migrations in the SQL editor, in order:\n" +
        "  001 002 003 004 005 006 007 008 013   (skip 010-012, still stubs)",
    );
    process.exit(1);
  }

  if (missing.length) {
    console.error(
      `\n${missing.length} table(s) are missing. Re-check that every migration ran ` +
        "without error, in numeric order.",
    );
    process.exit(1);
  }

  // The finding that matters most. A populated table here would mean RLS is not
  // doing its job and the anon key alone exposes clan data.
  if (leaking.length) {
    console.error(
      "\n" + "=".repeat(70) +
        "\nT1.9 FAILED — the anon key can read data with no session." +
        "\n" + "=".repeat(70) +
        `\n\nLeaking: ${leaking.map((r) => r.table).join(", ")}\n\n` +
        "Either RLS was not enabled or a policy is wrong. Re-apply 006_rls.sql\n" +
        "and confirm it reported no errors.",
    );
    process.exit(1);
  }

  // F6 — Supabase normally grants anon/authenticated on new public tables via
  // default privileges, and 006_rls.sql grants them explicitly too. A 401/403
  // here would mean policies are never even evaluated.
  if (denied.length) {
    console.error(
      `\n${denied.length} table(s) returned permission-denied rather than an empty ` +
        "result.\nThat is finding F6: the grants in 006_rls.sql did not take effect. " +
        "Re-run\nthe grant block at the end of that migration.",
    );
    process.exit(1);
  }

  if (other.length) {
    console.error(`\nUnexpected responses: ${other.map((r) => r.table).join(", ")}`);
    process.exit(1);
  }

  console.log(
    "\nT1.9 PASSES against the real platform: with the anon key and no session, " +
      "every\ntable returns zero rows. That assertion was previously only proven " +
      "against PGlite.",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
