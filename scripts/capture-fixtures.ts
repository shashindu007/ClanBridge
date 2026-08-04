// T2.1 — Capture real API responses into fixtures/.
//
//   npm run fixtures:capture              every active clan, read from the database
//   npm run fixtures:capture -- '#TAG'    one specific clan, overriding that
//
// Everything downstream is written against these shapes: the Zod schemas (T2.2),
// the mappers (T2.4), and every sync job. IMPLEMENTATION.md is explicit that a
// guessed shape is the shape your parser will be wrong about, which is why this
// script exists rather than hand-written fixtures.
//
// THE TAG COMES FROM THE DATABASE, not from an argument and not from a list
// written down somewhere. Migration 015 made clans data the leader owns, added
// through /admin after signing in — so `clans` is the one source of truth for
// which clans exist, and every sync job already reads it through activeClans().
// This script asking a human to retype a tag it could look up was the last place
// that assumption did not hold.
//
// The argument survives as an override for the case the database cannot serve:
// capturing from a clan nobody has added yet, or reproducing a shape from
// someone else's clan.
//
// Deliberately does NOT use src/integration/coc-client.ts. The client validates
// against schemas that do not exist yet, and it reads fixtures when
// USE_FIXTURES=true — which is exactly the file we are trying to create.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createAdminClient } from "../src/lib/supabase/admin";
import { encodeTag, normaliseTag } from "../src/lib/tags";
import { FIXTURE_SCHEMAS } from "../src/integration/coc-schemas";
import { createScrubber } from "./scrub-fixtures";

// Identity is stripped before anything is written. fixtures/ is committed so CI
// can run offline, so no real member data may enter it. See scrub-fixtures.ts.
const scrubber = createScrubber();

const FIXTURES_DIR = join(process.cwd(), "fixtures");
const BASE = process.env.COC_API_BASE ?? "https://api.clashofclans.com/v1";
const TOKEN = process.env.COC_API_TOKEN;

interface Target {
  file: string;
  path: (clanTag: string) => string;
  /** Absent for most of the month; a 404 here is normal, not a failure (R10). */
  cwlOnly?: boolean;
  /** Derives its path from a previous response rather than the clan tag. */
  derived?: boolean;
}

const TARGETS: Target[] = [
  { file: "clan.json", path: (t) => `/clans/${encodeTag(t)}` },
  { file: "currentwar.json", path: (t) => `/clans/${encodeTag(t)}/currentwar` },
  {
    file: "cwlgroup.json",
    path: (t) => `/clans/${encodeTag(t)}/currentwar/leaguegroup`,
    cwlOnly: true,
  },
  {
    file: "capitalraids.json",
    path: (t) => `/clans/${encodeTag(t)}/capitalraidseasons?limit=5`,
  },
];

async function get(path: string): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { status: response.status, body };
}

/**
 * THE VALIDATION GATE.
 *
 * src/integration/coc-schemas.ts was written from Supercell's *documented*
 * shapes, because no API key existed at the time. This is where those
 * assumptions meet reality: every captured response is parsed against its schema
 * and any disagreement is reported with the exact field path.
 *
 * A failure here is not a bug in the capture — it means the schema is wrong and
 * needs correcting. That is the whole point, and it is far cheaper to learn it
 * now than from a CWL sync that silently wrote nulls.
 */
function validate(file: string, body: unknown): string[] {
  const schema = FIXTURE_SCHEMAS[file as keyof typeof FIXTURE_SCHEMAS];
  if (!schema) return [];

  const result = schema.safeParse(body);
  if (result.success) return [];

  return result.error.issues
    .slice(0, 10)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

async function save(file: string, body: unknown): Promise<string[]> {
  // Validate the RAW response, before scrubbing — scrubbing only rewrites string
  // values, but validating the real thing removes any doubt about what was checked.
  const issues = validate(file, body);

  await writeFile(
    join(FIXTURES_DIR, file),
    `${JSON.stringify(scrubber.scrub(body), null, 2)}\n`,
    "utf8",
  );
  return issues;
}

function explain(status: number, path: string): string {
  switch (status) {
    case 403:
      return path.includes("currentwar")
        ? "403 — this clan's WAR LOG IS PRIVATE. Clan Settings -> War Log -> Public (T0.1)."
        : "403 — the key's registered IP does not match. Your public IP changed, or a VPN is on.";
    case 404:
      return "404 — wrong tag, or the '#' was not encoded as %23.";
    case 429:
      return "429 — rate limited. Wait a minute and re-run.";
    default:
      return `${status} — unexpected.`;
  }
}

/**
 * A stop with an explanation already written for the operator.
 *
 * Thrown rather than exiting on the spot, because process.exit() while the
 * Supabase client still holds an open socket trips a libuv assertion on Windows
 * — the script prints the right thing and then appears to crash, which is a poor
 * way to deliver instructions. Every exit path below sets process.exitCode and
 * lets Node drain instead.
 */
class Aborted extends Error {}

/**
 * Which clans to capture from — the database, unless told otherwise.
 *
 * Not activeClans() from scripts/sync/shared.ts, though the query is the same
 * one: that helper calls skip(), which throws a SyncSkipped that only means
 * anything inside runSyncJob(). Here an empty list is a plain instruction to the
 * operator, not a job outcome to log.
 *
 * Returns several because the CWL endpoints only exist for a clan currently IN
 * a league group. With three clans that may be one of them, and which one is not
 * knowable in advance — see the cwlOnly handling in main().
 */
async function resolveClanTags(override?: string): Promise<string[]> {
  if (override) return [normaliseTag(override)];

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("clans")
    .select("tag, name")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("tag");

  if (error) throw new Error(`Could not read clans: ${error.message}`);

  const rows = (data ?? []) as Array<{ tag: string; name: string }>;
  if (!rows.length) {
    throw new Aborted(
      "No clans in the database, so there is nothing to capture from.\n\n" +
        "  Clans are added by a leader, not seeded (migration 015):\n" +
        "    1. set OWNER_EMAIL in .env.local to the address you will sign in with\n" +
        "    2. npm run dev, then sign in at /login\n" +
        "    3. /admin -> claim ownership -> add the clans\n\n" +
        "  Or pass a tag directly to capture without adding one:\n" +
        "    npm run fixtures:capture -- '#YOURCLANTAG'",
    );
  }

  console.log(
    `Read ${rows.length} clan${rows.length === 1 ? "" : "s"} from the database: ` +
      rows.map((r) => `${r.name} ${r.tag}`).join(", "),
  );
  return rows.map((r) => normaliseTag(r.tag));
}

async function main(): Promise<void> {
  if (!TOKEN) {
    throw new Aborted(
      "COC_API_TOKEN is not set. Put it in .env.local first (T0.4), then re-run.",
    );
  }

  let clanTags: string[];
  try {
    clanTags = await resolveClanTags(process.argv[2]);
  } catch (error) {
    if (error instanceof Aborted) throw error;
    // A malformed tag, from the argument or from a row that should not exist.
    throw new Aborted(
      `${error instanceof Error ? error.message : error}\n` +
        "  Remember: a tag never contains the letter O — that is a zero.",
    );
  }

  // The non-CWL fixtures only need one clan; their shapes do not vary by clan.
  const clanTag = clanTags[0]!;

  await mkdir(FIXTURES_DIR, { recursive: true });
  console.log(`\nCapturing fixtures for ${clanTag} from ${BASE}\n`);

  const captured: string[] = [];
  const schemaIssues = new Map<string, string[]>();
  const skipped: string[] = [];
  let failed = false;
  let firstMemberTag: string | undefined;
  let firstWarTag: string | undefined;

  for (const target of TARGETS) {
    // A CWL-only endpoint exists for a clan currently in a league group, and
    // with several clans that may be none of them, or only the third. Trying
    // just the first would report "not CWL week" while a season we cannot
    // re-fetch was running in another clan — the one failure this whole script
    // exists to prevent. Non-CWL shapes do not vary by clan, so they use one.
    const candidates = target.cwlOnly ? clanTags : [clanTag];
    let done = false;

    for (const tag of candidates) {
      const path = target.path(tag);
      const { status, body } = await get(path);
      await new Promise((r) => setTimeout(r, 250)); // be polite to the API

      if (status === 200) {
        const issues = await save(target.file, body);
        captured.push(target.file);
        if (issues.length) schemaIssues.set(target.file, issues);
        console.log(
          `  ${issues.length ? "SCHEMA?  " : "ok       "}${target.file}` +
            (target.cwlOnly && clanTags.length > 1 ? ` (${tag})` : ""),
        );

        // Harvest the two tags that the remaining fixtures need.
        if (target.file === "clan.json") {
          const members = (body as { memberList?: Array<{ tag?: string }> }).memberList;
          firstMemberTag = members?.[0]?.tag;
        }
        if (target.file === "cwlgroup.json") {
          const rounds = (body as { rounds?: Array<{ warTags?: string[] }> }).rounds;
          firstWarTag = rounds
            ?.flatMap((r) => r.warTags ?? [])
            .find((t) => t && t !== "#0");
        }
        done = true;
        break;
      }

      if (status === 404 && target.cwlOnly) continue; // try the next clan
      failed = true;
      console.error(`  FAILED   ${target.file} — ${explain(status, path)}`);
      done = true;
      break;
    }

    if (!done && target.cwlOnly) {
      // R10 — the ordinary state for three weeks of every month, now known for
      // every clan rather than assumed from one.
      skipped.push(target.file);
      console.log(
        `  skipped  ${target.file} — no clan is in CWL right now (normal)`,
      );
    }
  }

  // player.json — any member will do; the shape is what matters.
  if (firstMemberTag) {
    const { status, body } = await get(`/players/${encodeTag(firstMemberTag)}`);
    if (status === 200) {
      const issues = await save("player.json", body);
      captured.push("player.json");
      if (issues.length) schemaIssues.set("player.json", issues);
      console.log(
        `  ${issues.length ? "SCHEMA?  " : "ok       "}player.json (${firstMemberTag})`,
      );
    } else {
      failed = true;
      console.error(`  FAILED   player.json — ${explain(status, "/players")}`);
    }
  }

  // cwlwar.json — only reachable when the league group was captured.
  if (firstWarTag) {
    const { status, body } = await get(`/clanwarleagues/wars/${encodeTag(firstWarTag)}`);
    if (status === 200) {
      const issues = await save("cwlwar.json", body);
      captured.push("cwlwar.json");
      if (issues.length) schemaIssues.set("cwlwar.json", issues);
      console.log(
        `  ${issues.length ? "SCHEMA?  " : "ok       "}cwlwar.json (${firstWarTag})`,
      );
    } else {
      failed = true;
      console.error(`  FAILED   cwlwar.json — ${explain(status, "/clanwarleagues")}`);
    }
  } else if (skipped.includes("cwlgroup.json")) {
    skipped.push("cwlwar.json");
    console.log("  skipped  cwlwar.json — not CWL week (normal)");
  }

  console.log(`\nCaptured ${captured.length}: ${captured.join(", ") || "none"}`);

  if (skipped.length) {
    console.log(
      `\nSkipped ${skipped.length}: ${skipped.join(", ")}\n` +
        "  These endpoints only exist during an actual CWL week — roughly the first\n" +
        "  week of the month. Re-run this script then. Do NOT hand-write them: the\n" +
        "  shape you guess is the shape the parser will be wrong about.",
    );
  }

  if (failed) {
    console.error("\nSome fixtures failed. See the messages above.");
    process.exitCode = 1;
  }

  if (scrubber.tags || scrubber.names) {
    console.log(
      `\nScrubbed ${scrubber.names} member name(s) and ${scrubber.tags} tag(s).\n` +
        "  These files are committed so CI can run the offline suite, so no real\n" +
        "  member identity goes into them. Every number, field and array length is\n" +
        "  untouched — only names and player tags were replaced.",
    );
  }

  // ── The validation gate's verdict ────────────────────────────────────────
  if (schemaIssues.size) {
    console.error(
      "\n" +
        "=".repeat(72) +
        "\nSCHEMA MISMATCH — reality disagrees with src/integration/coc-schemas.ts\n" +
        "=".repeat(72),
    );
    for (const [file, issues] of schemaIssues) {
      console.error(`\n  ${file}`);
      for (const issue of issues) console.error(`    - ${issue}`);
    }
    console.error(
      "\nThe schemas were written from Supercell's DOCUMENTED shapes, because no\n" +
        "API key existed at the time. This is exactly the check that was supposed\n" +
        "to catch that, and it has. The fixtures above are still saved and correct —\n" +
        "it is the schema that needs fixing.\n\n" +
        "Fix src/integration/coc-schemas.ts to match, then run `npm test`.\n",
    );
    process.exitCode = 1;
    return;
  }

  if (failed) return;

  console.log(
    "\nAll captured fixtures match src/integration/coc-schemas.ts.\n" +
      "Those shapes are now verified against the live API rather than assumed.",
  );
  console.log("\nDone. Next: `npm test`, then T2.6 runs against real data.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  // exitCode rather than exit(): see Aborted. An abrupt exit here races the
  // Supabase client's open socket and turns a clear message into a crash dump.
  process.exitCode = 1;
});
