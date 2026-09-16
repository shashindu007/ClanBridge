// T11B.3 — generate src/data/game/*.json from two pinned open-source datasets.
//
//   npm run game-data
//
// WHY THIS EXISTS AT ALL
//
// Phase 11B was first planned with no game data, on the belief that the API's
// `maxLevel` is the cap for the player's Town Hall. It is not: fixtures/player.json
// is a TH17 account whose Barbarian King reads 100/110, and 110 is the game's
// ceiling. "How far along is this base FOR ITS TOWN HALL" — the question the page
// exists to answer — therefore needs a table of caps per hall level, and that
// table is game data this repository has to carry.
//
// WHY GENERATED RATHER THAN TYPED IN
//
// About 150 units and 70 buildings, each with a cap at every hall level, changes
// every game update. Typed by hand it is a thousand numbers nobody re-checks.
// Generated, an update is: bump a pin below, re-run, read the diff.
//
// THE TWO SOURCES, AND WHY TWO
//
//   clashofclans.js  raw.json — units only, with a ready-made `levels` array giving
//                    the cap at each hall level. Newer: it has Dragon Duke.
//   coc.py           static_data.json — buildings and traps, the numeric ids the
//                    in-game village export uses, and the Builder Barracks levels
//                    the Builder Base troop caps are indexed by. Older.
//
// Both are MIT-licensed and derived from the game's own files. Neither ships
// artwork, so nothing here touches the Fan Content Policy's concern (T0.12).
// A unit either source lacks is simply absent from the output, and the app treats
// an absent unit as "cap unknown" rather than failing — see src/data/game/README.md.
//
// Run on a developer machine, never in CI or a page: it fetches from the network,
// and the output is committed so the build does not.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Bump these, re-run, and review the diff of src/data/game/. */
const CLASHOFCLANS_JS_VERSION = "4.0.5";
const COC_PY_COMMIT = "12e8230dbdc93afcf65dde937cdf75dcbe11e506";

const UNITS_URL = `https://cdn.jsdelivr.net/npm/clashofclans.js@${CLASHOFCLANS_JS_VERSION}/dist/util/raw.json`;
const STATIC_URL = `https://raw.githubusercontent.com/mathsman5133/coc.py/${COC_PY_COMMIT}/coc/static/static_data.json`;

const OUT_DIR = join(process.cwd(), "src", "data", "game");

// ---------------------------------------------------------------------------
// Source shapes — only the fields read here.
// ---------------------------------------------------------------------------

interface RawUnit {
  id: number;
  name: string;
  village: "home" | "builderBase";
  category: "troop" | "spell" | "hero" | "equipment";
  subCategory: string;
  upgrade: { resource: string };
  allowedCharacters: string[];
  /** The cap at each hall level, index 0 = level 1. Builder troops: Builder Barracks level. */
  levels: number[];
}

interface RawData {
  RAW_UNITS: RawUnit[];
  RAW_SUPER_UNITS: Array<{ name: string }>;
}

interface StaticLevel {
  level: number;
  required_townhall?: number;
  weapon?: { levels: unknown[] };
}

interface StaticEntity {
  _id: number;
  name: string;
  village?: "home" | "builderBase";
  type?: string;
  levels?: StaticLevel[];
}

interface StaticData {
  buildings: StaticEntity[];
  traps: StaticEntity[];
  guardians: StaticEntity[];
}

// ---------------------------------------------------------------------------
// Output shapes — mirrored by the types in src/data/game/index.ts.
// ---------------------------------------------------------------------------

type Village = "home" | "builder";

type UnitGroup =
  | "hero"
  | "equipment"
  | "pet"
  | "elixirTroop"
  | "darkTroop"
  | "superTroop"
  | "siege"
  | "elixirSpell"
  | "darkSpell"
  | "guardian"
  | "builderTroop"
  | "builderHero";

interface UnitOut {
  name: string;
  village: Village;
  group: UnitGroup;
  /** Equipment only: the hero who wears it. */
  hero?: string;
  /** The numeric id the in-game village export uses for this unit. */
  exportId: number;
  /** Max level at each hall level, index 0 = hall 1. 0 = not unlocked yet. */
  caps: number[];
}

interface BuildingOut {
  exportId: number;
  name: string;
  village: Village;
  kind: "trap" | string;
  caps: number[];
  /** Town Hall only: how many weapon levels each Town Hall level has. */
  weaponCaps?: number[];
}

/**
 * Supercell's global id is `class * 1_000_000 + row`. clashofclans.js carries the
 * row and the category; coc.py carries the full id. The class numbers are
 * cross-checked against coc.py below rather than trusted.
 */
const CLASS_PREFIX = {
  troop: 4_000_000,
  spell: 26_000_000,
  hero: 28_000_000,
  pet: 73_000_000,
  equipment: 90_000_000,
} as const;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Cap at each hall level from per-level `required_townhall`: the highest level
 * whose requirement is at or below that hall. Levels with no requirement are
 * treated as available from hall 1.
 */
function capsByHall(levels: StaticLevel[] | undefined, halls: number): number[] {
  const caps: number[] = [];
  for (let hall = 1; hall <= halls; hall++) {
    let cap = 0;
    for (const l of levels ?? []) {
      if ((l.required_townhall ?? 1) <= hall && l.level > cap) cap = l.level;
    }
    caps.push(cap);
  }
  return caps;
}

function groupOf(unit: RawUnit, supers: Set<string>): UnitGroup {
  if (unit.village === "builderBase") {
    return unit.category === "hero" ? "builderHero" : "builderTroop";
  }
  if (unit.category === "hero") return "hero";
  if (unit.category === "equipment") return "equipment";
  if (unit.subCategory === "pet") return "pet";
  if (unit.subCategory === "siege") return "siege";
  const dark = unit.upgrade.resource === "Dark Elixir";
  if (unit.category === "spell") return dark ? "darkSpell" : "elixirSpell";
  if (supers.has(unit.name)) return "superTroop";
  return dark ? "darkTroop" : "elixirTroop";
}

/**
 * One entry per line. A game update then diffs as "these five units changed"
 * rather than as hundreds of lines each holding a single number.
 */
function render(source: object, key: string, rows: object[]): string {
  const body = rows.map((row) => `  ${JSON.stringify(row)}`).join(",\n");
  return `{\n "source": ${JSON.stringify(source)},\n "${key}": [\n${body}\n ]\n}\n`;
}

async function main(): Promise<void> {
  console.log(`[game-data] clashofclans.js@${CLASHOFCLANS_JS_VERSION}`);
  console.log(`[game-data] coc.py@${COC_PY_COMMIT.slice(0, 7)}`);

  const [raw, stat] = await Promise.all([
    fetchJson<RawData>(UNITS_URL),
    fetchJson<StaticData>(STATIC_URL),
  ]);

  const homeHalls = stat.buildings.find((b) => b.name === "Town Hall")!.levels!.length;
  const builderHalls = stat.buildings.find((b) => b.name === "Builder Hall")!.levels!.length;

  // Builder Base troop caps are indexed by BUILDER BARRACKS level, not Builder
  // Hall level — raw.json's arrays for them are 12 long while there are 10 Builder
  // Halls. Translating through the barracks cap at each Builder Hall is what
  // makes a BH10 Raged Barbarian correctly cap at 20 rather than 16.
  const barracks = stat.buildings.find(
    (b) => b.name === "Builder Barracks" && b.village === "builderBase",
  )!;
  const barracksAtHall = capsByHall(barracks.levels, builderHalls);

  // Everything coc.py knows by id, to verify the class prefixes.
  const knownIds = new Map<number, string>();
  const supers = new Set(raw.RAW_SUPER_UNITS.map((s) => s.name));

  const units: UnitOut[] = [];
  const mismatches: string[] = [];

  for (const u of raw.RAW_UNITS) {
    const village: Village = u.village === "builderBase" ? "builder" : "home";
    const prefix = u.subCategory === "pet" ? CLASS_PREFIX.pet : CLASS_PREFIX[u.category];
    const exportId = prefix + u.id;

    let caps: number[];
    if (village === "builder" && u.category === "troop") {
      caps = barracksAtHall.map((level) => (level > 0 ? (u.levels[level - 1] ?? 0) : 0));
    } else {
      const halls = village === "home" ? homeHalls : builderHalls;
      caps = Array.from({ length: halls }, (_, i) => u.levels[i] ?? u.levels.at(-1) ?? 0);
    }

    units.push({
      name: u.name,
      village,
      group: groupOf(u, supers),
      ...(u.category === "equipment" && u.allowedCharacters[0]
        ? { hero: u.allowedCharacters[0] }
        : {}),
      exportId,
      caps,
    });
  }

  // Guardians are TH18 defenders with levels of their own; only coc.py has them.
  for (const g of stat.guardians) {
    units.push({
      name: g.name,
      village: "home",
      group: "guardian",
      exportId: g._id,
      caps: capsByHall(g.levels, homeHalls),
    });
  }

  // The prefix check. A wrong class number would silently mis-label every unit
  // in a pasted export, so a single disagreement stops the run.
  const byKey = stat as unknown as Record<string, StaticEntity[] | undefined>;
  for (const key of ["troops", "spells", "heroes", "pets", "equipment"]) {
    for (const e of byKey[key] ?? []) knownIds.set(e._id, e.name);
  }
  for (const u of units) {
    const name = knownIds.get(u.exportId);
    if (name !== undefined && name !== u.name && u.group !== "guardian") {
      mismatches.push(`${u.name} vs ${name} @ ${u.exportId}`);
    }
  }
  if (mismatches.length) {
    throw new Error(`export id mismatch between sources:\n  ${mismatches.join("\n  ")}`);
  }

  const buildings: BuildingOut[] = [];
  for (const b of stat.buildings) {
    const village: Village = b.village === "builderBase" ? "builder" : "home";
    const halls = village === "home" ? homeHalls : builderHalls;
    const out: BuildingOut = {
      exportId: b._id,
      name: b.name,
      village,
      kind: b.type ?? "Other",
      caps: capsByHall(b.levels, halls),
    };
    if (b.name === "Town Hall" && village === "home") {
      out.weaponCaps = Array.from(
        { length: halls },
        (_, i) => b.levels?.find((l) => l.level === i + 1)?.weapon?.levels.length ?? 0,
      );
    }
    buildings.push(out);
  }
  for (const t of stat.traps) {
    const village: Village = t.village === "builderBase" ? "builder" : "home";
    buildings.push({
      exportId: t._id,
      name: t.name,
      village,
      kind: "trap",
      caps: capsByHall(t.levels, village === "home" ? homeHalls : builderHalls),
    });
  }

  const source = {
    generatedBy: "scripts/game-data.ts",
    clashofclansJs: CLASHOFCLANS_JS_VERSION,
    cocPy: COC_PY_COMMIT,
    homeHalls,
    builderHalls,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "units.json"), render(source, "units", units));
  await writeFile(join(OUT_DIR, "buildings.json"), render(source, "buildings", buildings));

  console.log(
    `[game-data] ${units.length} units, ${buildings.length} buildings and traps, ` +
      `TH1–${homeHalls}, BH1–${builderHalls}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
