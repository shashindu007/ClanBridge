// T2.1 — Capture real API responses into fixtures/.
//
//   npm run fixtures:capture -- '#YOURCLANTAG'
//
// Everything downstream is written against these shapes: the Zod schemas (T2.2),
// the mappers (T2.4), and every sync job. IMPLEMENTATION.md is explicit that a
// guessed shape is the shape your parser will be wrong about, which is why this
// script exists rather than hand-written fixtures.
//
// Deliberately does NOT use src/integration/coc-client.ts. The client validates
// against schemas that do not exist yet, and it reads fixtures when
// USE_FIXTURES=true — which is exactly the file we are trying to create.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { encodeTag, normaliseTag } from "../src/lib/tags";

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

async function save(file: string, body: unknown): Promise<void> {
  await writeFile(
    join(FIXTURES_DIR, file),
    `${JSON.stringify(body, null, 2)}\n`,
    "utf8",
  );
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

async function main(): Promise<void> {
  const raw = process.argv[2];
  if (!raw) {
    console.error("Usage: npm run fixtures:capture -- '#YOURCLANTAG'");
    process.exit(1);
  }
  if (!TOKEN) {
    console.error(
      "COC_API_TOKEN is not set. Put it in .env.local first (T0.4), then re-run.",
    );
    process.exit(1);
  }

  let clanTag: string;
  try {
    clanTag = normaliseTag(raw);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : error}`);
    console.error("Remember: a tag never contains the letter O — that is a zero.");
    process.exit(1);
  }

  await mkdir(FIXTURES_DIR, { recursive: true });
  console.log(`Capturing fixtures for ${clanTag} from ${BASE}\n`);

  const captured: string[] = [];
  const skipped: string[] = [];
  let failed = false;
  let firstMemberTag: string | undefined;
  let firstWarTag: string | undefined;

  for (const target of TARGETS) {
    const path = target.path(clanTag);
    const { status, body } = await get(path);

    if (status === 200) {
      await save(target.file, body);
      captured.push(target.file);
      console.log(`  ok       ${target.file}`);

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
    } else if (status === 404 && target.cwlOnly) {
      // R10 — this is the ordinary state for three weeks of every month.
      skipped.push(target.file);
      console.log(`  skipped  ${target.file} — not CWL week (normal)`);
    } else {
      failed = true;
      console.error(`  FAILED   ${target.file} — ${explain(status, path)}`);
    }

    await new Promise((r) => setTimeout(r, 250)); // be polite to the API
  }

  // player.json — any member will do; the shape is what matters.
  if (firstMemberTag) {
    const { status, body } = await get(`/players/${encodeTag(firstMemberTag)}`);
    if (status === 200) {
      await save("player.json", body);
      captured.push("player.json");
      console.log(`  ok       player.json (${firstMemberTag})`);
    } else {
      failed = true;
      console.error(`  FAILED   player.json — ${explain(status, "/players")}`);
    }
  }

  // cwlwar.json — only reachable when the league group was captured.
  if (firstWarTag) {
    const { status, body } = await get(`/clanwarleagues/wars/${encodeTag(firstWarTag)}`);
    if (status === 200) {
      await save("cwlwar.json", body);
      captured.push("cwlwar.json");
      console.log(`  ok       cwlwar.json (${firstWarTag})`);
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
    process.exit(1);
  }

  console.log("\nDone. These files are gitignored? No — they are committed on purpose,");
  console.log("so the sync jobs run offline in CI. Check them for anything private first.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
