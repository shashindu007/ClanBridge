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

/**
 * Every table the applied migrations create.
 *
 * Hardcoded rather than discovered, so adding a table is a deliberate act here
 * too — a new table missing from this list is one the live RLS check silently
 * never probes, which is exactly how the coverage rots.
 */
const TABLES = [
  "clans",
  "users",
  "players",
  "clan_roles",
  "cwl_seasons",
  "cwl_wars",
  "cwl_war_members", // 019
  "cwl_attacks",
  "cwl_bonuses",
  "cwl_rosters", // 011
  "cwl_roster_members", // 011
  "polls", // 010
  "poll_options", // 010
  "poll_responses", // 010
  "wars",
  "war_members", // 024
  "war_opponent_members", // 026
  "war_targets",
  "war_attacks",
  "war_lineups", // 024
  "war_lineup_members", // 024
  "raid_seasons",
  "raid_participants",
  "clan_games",
  "clan_games_scores",
  "base_layouts",
  "announcements",
  "push_subscriptions",
  "notification_preferences", // 023
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

/**
 * fetch with patient retries.
 *
 * This connection drops requests in bursts lasting several seconds — the same
 * flakiness that killed an `npm install` mid-run earlier. Measured: `curl`
 * succeeded while Node's fetch failed four times in a row, then both worked
 * moments later, so it is not an IPv6/NAT64 ordering problem, just loss.
 *
 * Hence 6 attempts backing off to ~16s rather than a token 3. A diagnostic that
 * reports "UNREACHABLE" during a blip is worse than useless: it sends you
 * checking a project URL that was never wrong.
 */
async function fetchRetry(
  url: string,
  init: RequestInit = {},
  attempts = 6,
): Promise<Response> {
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      lastError = error;
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (i - 1), 16_000)));
      }
    }
  }
  throw lastError;
}

async function probe(table: string): Promise<Probe> {
  const response = await fetchRetry(`${URL_}/rest/v1/${table}?select=*&limit=5`, {
    headers: { apikey: ANON!, Authorization: `Bearer ${ANON}` },
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
    const root = await fetchRetry(`${URL_}/rest/v1/`, { headers: { apikey: ANON } });
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
      "\nNo tables exist yet. Apply every migration in supabase/migrations/, in\n" +
        "numeric order:\n\n" +
        "  npm run migrations:apply\n\n" +
        "009 and 012 are absent by design — 012 was superseded by 024_war.sql and\n" +
        "its number retired rather than reused, so apply order stays equal to\n" +
        "numeric order. If the connection will not cooperate, `npm run\n" +
        "migrations:bundle` writes supabase/apply-all.sql for one paste into the\n" +
        "SQL editor.",
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
    `\n  ${empty.length}/${TABLES.length} tables exist, are readable without error, ` +
      "and return nothing to anon.",
  );

  // ── The part that makes the above meaningful ──────────────────────────────
  //
  // While every table is empty, "zero rows" cannot distinguish "RLS denied you"
  // from "there is nothing here". The only way to tell them apart is to put a row
  // in and confirm anon still cannot see it.
  await probeRls();
}

/**
 * Insert one row with the service key, confirm anon cannot see it, soft delete it.
 *
 * Soft delete, not hard: migration 014 deliberately withholds DELETE from
 * service_role so R4 is enforced by privilege rather than by remembering. This
 * probe is therefore subject to the same rule as everything else, which is the
 * right outcome — the diagnostic should not need an exemption from the project's
 * own most important constraint.
 *
 * The row is left with deleted_at set. `activeClans()` filters it out, so it is
 * inert, and it re-uses the same tag on every run rather than accumulating.
 */
async function probeRls(): Promise<void> {
  const service = process.env.SUPABASE_SERVICE_KEY;
  if (!service) {
    console.warn(
      "\n  INCONCLUSIVE — every table is empty, so an empty result proves only that\n" +
        "  the query succeeded, not that RLS denied anything. Set SUPABASE_SERVICE_KEY\n" +
        "  to let this script insert a probe row and prove it properly.",
    );
    return;
  }

  const svc = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const PROBE_TAG = "#20000000"; // valid alphabet, obviously not a real clan

  console.log("\n  Proving RLS actually denies, rather than the table being empty:");

  // Re-uses the same tag each run. `on_conflict` makes that idempotent (R5)
  // rather than failing the second time on the unique constraint.
  const created = await fetchRetry(
    `${URL_}/rest/v1/clans?on_conflict=tag`,
    {
      method: "POST",
      headers: { ...svc, Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ tag: PROBE_TAG, name: "RLS probe", deleted_at: null }),
    },
  );

  if (!created.ok) {
    const detail = (await created.text()).slice(0, 300);
    console.error(`    service key could not insert (HTTP ${created.status}): ${detail}`);
    if (created.status === 403) {
      console.error(
        "\n    This is the missing-grant defect. Apply migration\n" +
          "    supabase/migrations/014_service_role_grants.sql in the SQL editor.",
      );
    }
    process.exit(1);
  }
  console.log("    service key inserted a probe clan (bypasses RLS, as designed)");

  try {
    const asService = await fetchRetry(`${URL_}/rest/v1/clans?select=tag`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` },
    });
    const serviceRows = (await asService.json()) as unknown[];

    const asAnon = await fetchRetry(`${URL_}/rest/v1/clans?select=tag`, {
      headers: { apikey: ANON!, Authorization: `Bearer ${ANON}` },
    });
    const anonRows = (await asAnon.json()) as unknown[];

    console.log(`    service key sees ${serviceRows.length} row(s)`);
    console.log(`    anon key    sees ${anonRows.length} row(s)`);

    if (serviceRows.length === 0) {
      console.error("\n    Probe row vanished. Cannot conclude anything.");
      process.exit(1);
    }

    if (anonRows.length > 0) {
      console.error(
        "\n" + "=".repeat(70) +
          "\nT1.9 FAILED — anon can read a row that exists." +
          "\n" + "=".repeat(70) +
          "\n\nRLS is not denying. Re-apply 006_rls.sql and confirm no errors.",
      );
      process.exit(1);
    }

    console.log(
      "\n  T1.9 PROVEN against the real platform: a row exists, the service key\n" +
        "  sees it, and the anon key with no session sees nothing. RLS is denying,\n" +
        "  not merely returning an empty table.",
    );
  } finally {
    // Soft delete (R4). 014 withholds DELETE from service_role on purpose.
    await fetchRetry(`${URL_}/rest/v1/clans?tag=eq.${encodeURIComponent(PROBE_TAG)}`, {
      method: "PATCH",
      headers: svc,
      body: JSON.stringify({ deleted_at: new Date().toISOString() }),
    });
    console.log("  probe row soft-deleted (R4 — activeClans() filters it out)");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
