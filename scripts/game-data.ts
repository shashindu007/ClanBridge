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
//   clashofclans.js  units.json + buildings.json — every unit, and the army
//                    buildings that make them (Barracks, Hero Hall, Squad
//                    Barracks …), with each level's Town Hall requirement, cost
//                    and time. Newest: it has Town Hall 19.
//   coc.py           static_data.json — every other building and trap, the
//                    halls' `unlocks` (how many of each building), merges, the
//                    Town Hall weapon, and guardians. Older: it stops at TH18.
//
// WHERE A SOURCE STOPS SHORT
//
// A building only coc.py has gets `null` at every hall coc.py does not reach.
// null means "the game has this hall, the data does not know this cap yet", and
// the app says exactly that rather than calling the base maxed (see
// src/data/game/README.md). A cap is NEVER copied forward from the hall below:
// that would be a guess, and a guess here is a wrong number on someone's base.
//
// Both are MIT-licensed and derived from the game's own files. Neither ships
// artwork, so nothing here touches the Fan Content Policy's concern (T0.12).
//
// Run on a developer machine, never in CI or a page: it fetches from the network,
// and the output is committed so the build does not.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Bump these, re-run, and review the diff of src/data/game/. */
const CLASHOFCLANS_JS_VERSION = "5.1.19";
const COC_PY_COMMIT = "12e8230dbdc93afcf65dde937cdf75dcbe11e506";

const CJS_BASE = `https://cdn.jsdelivr.net/npm/clashofclans.js@${CLASHOFCLANS_JS_VERSION}/dist/util`;
const CJS_UNITS_URL = `${CJS_BASE}/units.json`;
const CJS_BUILDINGS_URL = `${CJS_BASE}/buildings.json`;
/**
 * The Builder Base, from the clashofclans.js release before 5.x. 5.x gives
 * every Builder Base troop a level-1 entry, which loses the Builder Base 2.0
 * rule that a late troop STARTS high (Bomber at 5 on BH3, Hog Glider at 15) —
 * a BH3 base with a Bomber would read as above its cap. TH19 did not touch the
 * Builder Base, so it keeps the source it was right with.
 */
const BUILDER_UNITS_VERSION = "4.0.5";
const BUILDER_UNITS_URL = `https://cdn.jsdelivr.net/npm/clashofclans.js@${BUILDER_UNITS_VERSION}/dist/util/raw.json`;
const STATIC_URL = `https://raw.githubusercontent.com/mathsman5133/coc.py/${COC_PY_COMMIT}/coc/static/static_data.json`;

const OUT_DIR = join(process.cwd(), "src", "data", "game");

// ---------------------------------------------------------------------------
// Source shapes — only the fields read here.
// ---------------------------------------------------------------------------

type CjsVillage = "home" | "builder_base";

interface CjsLevel {
  level: number;
  required_townhall?: number | null;
  /** Units: the cost and seconds of REACHING this level (level 1 is 0). */
  upgrade_cost?: number | { shiny_ore?: number; glowy_ore?: number; starry_ore?: number };
  upgrade_time?: number;
  /** Buildings: the cost and seconds of REACHING this level. */
  build_cost?: number;
  build_time?: number;
}

interface CjsUnit {
  id: number;
  name: string;
  village_type?: CjsVillage;
  production_building: string | null;
  production_building_level: number | null;
  upgrade_resource?: string;
  /** Event troops and spells: in the game for a season, never upgraded. */
  is_seasonal?: boolean;
  super_troop?: { original_id: number };
  squad?: unknown;
  /** Equipment: the hero who wears it. */
  hero?: string;
  levels: CjsLevel[];
}

interface CjsUnits {
  troops: CjsUnit[];
  spells: CjsUnit[];
  heroes: CjsUnit[];
  pets: CjsUnit[];
  equipment: CjsUnit[];
}

/** clashofclans.js 4.x raw.json — read for the Builder Base only. */
interface LegacyRawUnit {
  id: number;
  name: string;
  village: "home" | "builderBase";
  category: "troop" | "spell" | "hero" | "equipment";
  /** The cap at each hall level, index 0 = level 1. Builder troops: Builder Barracks level. */
  levels: number[];
}

interface CjsBuilding {
  id: number;
  name: string;
  village_type: CjsVillage;
  upgrade_resource: string;
  levels: CjsLevel[];
}

interface StaticLevel {
  level: number;
  required_townhall?: number;
  /** Buildings and traps: the cost and seconds of REACHING this level. */
  build_cost?: number;
  build_time?: number;
  /** Units: the cost and seconds of going FROM this level to the next. */
  upgrade_cost?: number;
  upgrade_time?: number;
  /** Walls from level 5: this level can also be paid for in elixir. */
  alt_upgrade_resource?: string;
  /** Town Hall and Builder Hall: what reaching this hall adds. */
  unlocks?: Array<{ name: string; quantity: number }>;
  /** What this level consumes, e.g. two level-21 Cannons for a Ricochet Cannon. */
  merge_requirement?: Array<{ name: string; level: number }>;
  weapon?: { name: string; upgrade_resource: string; levels: StaticLevel[] };
}

interface StaticEntity {
  _id: number;
  name: string;
  village?: "home" | "builderBase";
  type?: string;
  upgrade_resource?: string;
  levels?: StaticLevel[];
}

interface StaticData {
  buildings: StaticEntity[];
  traps: StaticEntity[];
  guardians: StaticEntity[];
  troops: StaticEntity[];
  spells: StaticEntity[];
  heroes: StaticEntity[];
  pets: StaticEntity[];
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
  | "squad"
  | "siege"
  | "elixirSpell"
  | "darkSpell"
  | "guardian"
  | "builderTroop"
  | "builderHero";

/** A cap per hall, index 0 = hall 1. 0 = not unlocked; null = the data does not know. */
type Caps = Array<number | null>;

interface UnitOut {
  name: string;
  village: Village;
  group: UnitGroup;
  /** Equipment only: the hero who wears it. */
  hero?: string;
  /** The numeric id the in-game village export uses for this unit. */
  exportId: number;
  caps: Caps;
}

interface BuildingOut {
  exportId: number;
  name: string;
  village: Village;
  kind: "trap" | string;
  caps: Caps;
  /** Town Hall only: how many weapon levels each Town Hall level has. */
  weaponCaps?: Caps;
  /**
   * How many of this building each hall allows, index 0 = hall 1, from the
   * halls' `unlocks`. A building merged INTO a Town Hall (Eagle Artillery at
   * TH17) drops out from that hall on. Absent for traps: the data has no counts.
   */
  counts?: Caps;
  /** A merged building: what one of it consumes, e.g. Ricochet Cannon = 2 × Cannon at 21. */
  merge?: Array<{ name: string; n: number; level: number }>;
}

type Resource = "gold" | "elixir" | "dark" | "builderGold" | "builderElixir" | "gems" | "ore";

/**
 * One cost row. `levels[L - 1]` is the price of REACHING level L, whatever the
 * source's own convention: [amount, seconds], or for equipment
 * [[shiny, glowy, starry], 0]. null where no source has it — a unit's level 1
 * is never priced, because a building unlocks it rather than an upgrade.
 */
interface CostOut {
  type: "building" | "unit" | "weapon";
  name: string;
  village: Village;
  resource: Resource;
  /** Walls: the resource the levels from `altFrom` can also be paid in. */
  alt?: Resource;
  altFrom?: number;
  /** Weapons: the Town Hall level the weapon belongs to. */
  hall?: number;
  levels: Array<[number | number[], number] | null>;
}

const RESOURCE: Record<string, Resource> = {
  Gold: "gold",
  Elixir: "elixir",
  "Dark Elixir": "dark",
  "Builder Gold": "builderGold",
  "Builder Elixir": "builderElixir",
  Gems: "gems",
  "Shiny Ore": "ore",
};

/** A new resource string means a game update this script has not been taught. */
function resourceOf(name: string | undefined, what: string): Resource {
  const r = name ? RESOURCE[name] : undefined;
  if (!r) throw new Error(`unknown upgrade resource "${name}" on ${what}`);
  return r;
}

const CJS_UNIT_CATEGORIES = ["troops", "spells", "heroes", "pets", "equipment"] as const;

/**
 * The army buildings clashofclans.js carries. The Town Hall and Builder Hall are
 * in its file too but are NOT taken from it: it gives a hall's level L the
 * requirement "Town Hall L - 1" (the hall you upgrade from), which is right for
 * pricing and wrong for caps. Their caps are their own level by definition.
 */
const HALLS = new Set(["Town Hall", "Builder Hall"]);

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Cap at each hall level from per-level `required_townhall`: the highest level
 * whose requirement is at or below that hall.
 *
 * In clashofclans.js (`strict`) a level with no requirement stops the run rather
 * than counting as "from hall 1": fresh entries are sometimes half-filled, and
 * reading a gap as "always available" would give a TH1 base a TH19 cap. coc.py's
 * older rows (the Builder Hall's, among others) leave it out on purpose and keep
 * the old reading.
 */
function capsByHall(
  levels: Array<{ level: number; required_townhall?: number | null }> | undefined,
  halls: number,
  what: string,
  strict = true,
): number[] {
  const caps: number[] = [];
  for (let hall = 1; hall <= halls; hall++) {
    let cap = 0;
    for (const l of levels ?? []) {
      if (l.required_townhall === undefined || l.required_townhall === null) {
        if (strict) throw new Error(`${what} level ${l.level} has no required_townhall`);
      }
      if ((l.required_townhall ?? 1) <= hall && l.level > cap) cap = l.level;
    }
    caps.push(cap);
  }
  return caps;
}

/** Pad a per-hall row out to `halls` with null: "the data does not know". */
function padUnknown(row: Caps, halls: number): Caps {
  return Array.from({ length: halls }, (_, i) => (i < row.length ? row[i]! : null));
}

const villageOf = (v: CjsVillage | undefined): Village => (v === "builder_base" ? "builder" : "home");

function groupOf(category: (typeof CJS_UNIT_CATEGORIES)[number], u: CjsUnit): UnitGroup {
  const village = villageOf(u.village_type);
  if (village === "builder") return category === "heroes" ? "builderHero" : "builderTroop";
  switch (category) {
    case "heroes":
      return "hero";
    case "equipment":
      return "equipment";
    case "pets":
      return "pet";
    case "spells":
      return u.production_building === "Dark Spell Factory" ? "darkSpell" : "elixirSpell";
    case "troops":
      if (u.production_building === "Workshop") return "siege";
      if (u.production_building === "Squad Barracks" || u.squad) return "squad";
      if (u.super_troop) return "superTroop";
      return u.production_building === "Dark Barracks" ? "darkTroop" : "elixirTroop";
  }
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

  const [cjsUnits, cjsBuildingsFile, stat, legacy] = await Promise.all([
    fetchJson<CjsUnits>(CJS_UNITS_URL),
    fetchJson<{ buildings: CjsBuilding[] }>(CJS_BUILDINGS_URL),
    fetchJson<StaticData>(STATIC_URL),
    fetchJson<{ RAW_UNITS: LegacyRawUnit[] }>(BUILDER_UNITS_URL),
  ]);
  const cjsBuildings = cjsBuildingsFile.buildings;

  // The newest source decides how many halls the game has.
  const cjsHall = (name: string) => cjsBuildings.find((b) => b.name === name)!;
  const homeHalls = cjsHall("Town Hall").levels.length;
  const builderHalls = cjsHall("Builder Hall").levels.length;
  const cocHomeHalls = stat.buildings.find((b) => b.name === "Town Hall")!.levels!.length;
  const cocBuilderHalls = stat.buildings.find((b) => b.name === "Builder Hall")!.levels!.length;
  if (cocHomeHalls > homeHalls || cocBuilderHalls > builderHalls) {
    throw new Error("coc.py knows more halls than clashofclans.js — swap which source leads");
  }
  if (cocHomeHalls < homeHalls) {
    console.log(
      `[game-data] coc.py stops at TH${cocHomeHalls}: buildings only it knows are null (unknown) at TH${cocHomeHalls + 1}–${homeHalls}`,
    );
  }

  /**
   * An army building's cap at each hall, from clashofclans.js — except WHEN it
   * unlocks. Where coc.py says the building does not exist yet at a hall it
   * covers, it stays 0: clashofclans.js 5.1.19 gives the Hero Hall level 1 at
   * TH4, while the game (and coc.py) unlock it at TH7. Unlock halls are stable
   * across updates; it is the level caps that move, and those come from here.
   */
  const cjsBuildingCaps = (b: CjsBuilding): number[] => {
    const village = villageOf(b.village_type);
    const caps = capsByHall(b.levels, village === "home" ? homeHalls : builderHalls, b.name);
    const coc = stat.buildings.find((s) => s._id === b.id);
    if (!coc) return caps;
    const cocCaps = capsByHall(coc.levels, village === "home" ? cocHomeHalls : cocBuilderHalls, b.name, false);
    return caps.map((c, i) => (i < cocCaps.length && cocCaps[i] === 0 ? 0 : c));
  };
  const productionCap = new Map<string, number[]>();
  for (const b of cjsBuildings) {
    if (HALLS.has(b.name)) continue;
    productionCap.set(`${villageOf(b.village_type)}:${b.name}`, cjsBuildingCaps(b));
  }

  // ── Units ────────────────────────────────────────────────────────────────
  const units: UnitOut[] = [];
  const seen = new Set<string>();
  const cjsUnitByKey = new Map<string, CjsUnit>();

  for (const category of CJS_UNIT_CATEGORIES) {
    for (const u of cjsUnits[category]) {
      if (u.is_seasonal) continue; // event units: never upgraded, never "behind"
      const village = villageOf(u.village_type);
      if (village === "builder") continue; // from the legacy source, below
      const key = `${village}:${u.name}`;
      if (seen.has(key)) throw new Error(`two units called ${key} — teach the event filter`);
      seen.add(key);
      cjsUnitByKey.set(key, u);
      if (!Number.isInteger(u.id) || u.id <= 0) throw new Error(`${key} has no usable id (${u.id})`);

      const halls = village === "home" ? homeHalls : builderHalls;
      const levelCaps = capsByHall(u.levels, halls, key);
      // A unit exists only once the building that makes it reaches the level
      // it needs. The unit's own level-1 requirement is not that gate: the
      // source sets it loosely for older units.
      const gate =
        u.production_building && u.production_building_level
          ? productionCap.get(`${village}:${u.production_building}`)
          : undefined;
      if (u.production_building && u.production_building_level && !gate) {
        throw new Error(`${key} is made in ${u.production_building}, which the data does not have`);
      }
      const caps = levelCaps.map((cap, i) =>
        gate && gate[i]! < u.production_building_level! ? 0 : cap,
      );

      units.push({
        name: u.name,
        village,
        group: groupOf(category, u),
        ...(category === "equipment" && u.hero ? { hero: u.hero } : {}),
        exportId: u.id,
        caps,
      });
    }
  }

  // Builder Base units, exactly as before 5.x (see BUILDER_UNITS_VERSION).
  // Their caps are indexed by BUILDER BARRACKS level, not Builder Hall level —
  // the arrays are 12 long while there are 10 Builder Halls. Translating through
  // the barracks cap at each Builder Hall is what makes a BH10 Raged Barbarian
  // cap at 20 rather than 16.
  const barracks = stat.buildings.find((b) => b.name === "Builder Barracks" && b.village === "builderBase")!;
  const barracksAtHall = capsByHall(barracks.levels, builderHalls, "Builder Barracks", false);
  for (const u of legacy.RAW_UNITS) {
    if (u.village !== "builderBase") continue;
    const hero = u.category === "hero";
    const caps = hero
      ? Array.from({ length: builderHalls }, (_, i) => u.levels[i] ?? 0)
      : barracksAtHall.map((level) => (level > 0 ? (u.levels[level - 1] ?? 0) : 0));
    const key = `builder:${u.name}`;
    if (seen.has(key)) throw new Error(`two units called ${key}`);
    seen.add(key);
    units.push({
      name: u.name,
      village: "builder",
      group: hero ? "builderHero" : "builderTroop",
      exportId: (hero ? 28_000_000 : 4_000_000) + u.id,
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
      caps: padUnknown(capsByHall(g.levels, cocHomeHalls, g.name, false), homeHalls),
    });
  }

  // The id check. A wrong id would silently mis-label every unit in a pasted
  // export, so a single disagreement with coc.py stops the run.
  const knownIds = new Map<number, string>();
  const byKey = stat as unknown as Record<string, StaticEntity[] | undefined>;
  for (const key of ["troops", "spells", "heroes", "pets", "equipment"]) {
    for (const e of byKey[key] ?? []) knownIds.set(e._id, e.name);
  }
  const mismatches: string[] = [];
  for (const u of units) {
    const name = knownIds.get(u.exportId);
    if (name !== undefined && name !== u.name && u.group !== "guardian") {
      mismatches.push(`${u.name} vs ${name} @ ${u.exportId}`);
    }
  }
  if (mismatches.length) {
    throw new Error(`export id mismatch between sources:\n  ${mismatches.join("\n  ")}`);
  }

  // ── Buildings ────────────────────────────────────────────────────────────
  const cjsBuildingById = new Map(cjsBuildings.map((b) => [b.id, b]));
  const buildings: BuildingOut[] = [];
  const changed: string[] = [];

  for (const b of stat.buildings) {
    const village: Village = b.village === "builderBase" ? "builder" : "home";
    const halls = village === "home" ? homeHalls : builderHalls;
    const cocHalls = village === "home" ? cocHomeHalls : cocBuilderHalls;
    const coc = capsByHall(b.levels, cocHalls, b.name, false);
    const cjs = cjsBuildingById.get(b._id);

    let caps: Caps;
    if (b.name === "Town Hall" && village === "home") {
      // A hall's "cap" is the level it can be upgraded to: the next one, up to the last.
      caps = Array.from({ length: halls }, (_, i) => Math.min(i + 2, halls));
    } else if (HALLS.has(b.name)) {
      caps = padUnknown(coc, halls);
    } else if (cjs) {
      caps = cjsBuildingCaps(cjs);
      const diff = coc.flatMap((c, i) => (c !== caps[i] ? [`TH${i + 1} ${c}→${caps[i]}`] : []));
      if (diff.length) changed.push(`${b.name}: ${diff.join(", ")}`);
    } else {
      caps = padUnknown(coc, halls);
    }

    const out: BuildingOut = { exportId: b._id, name: b.name, village, kind: b.type ?? "Other", caps };
    if (b.name === "Town Hall" && village === "home") {
      out.weaponCaps = padUnknown(
        Array.from(
          { length: cocHalls },
          (_, i) => b.levels?.find((l) => l.level === i + 1)?.weapon?.levels.length ?? 0,
        ),
        halls,
      );
    }
    buildings.push(out);
  }
  // Army buildings coc.py has never heard of (Squad Barracks at TH19).
  const statIds = new Set(stat.buildings.map((b) => b._id));
  for (const b of cjsBuildings) {
    if (statIds.has(b.id) || HALLS.has(b.name)) continue;
    buildings.push({
      exportId: b.id,
      name: b.name,
      village: villageOf(b.village_type),
      kind: "Army",
      caps: cjsBuildingCaps(b),
    });
    changed.push(`${b.name}: new`);
  }
  for (const t of stat.traps) {
    const village: Village = t.village === "builderBase" ? "builder" : "home";
    const halls = village === "home" ? homeHalls : builderHalls;
    const cocHalls = village === "home" ? cocHomeHalls : cocBuilderHalls;
    buildings.push({
      exportId: t._id,
      name: t.name,
      village,
      kind: "trap",
      caps: padUnknown(capsByHall(t.levels, cocHalls, t.name, false), halls),
    });
  }

  // ── Building counts and merges ───────────────────────────────────────────
  const counts = new Map<string, Caps>();
  const hallCounts = (hallName: string, village: Village, cocHalls: number, halls: number) => {
    const hall = stat.buildings.find(
      (b) => b.name === hallName && (b.village === "builderBase") === (village === "builder"),
    )!;
    const running = new Map<string, number>();
    for (let h = 1; h <= cocHalls; h++) {
      const level = hall.levels?.find((l) => l.level === h);
      for (const u of level?.unlocks ?? []) {
        running.set(u.name, (running.get(u.name) ?? 0) + u.quantity);
      }
      // A building the hall itself swallows (Eagle Artillery into TH17) is gone from here on.
      for (const m of level?.merge_requirement ?? []) {
        running.set(m.name, Math.max(0, (running.get(m.name) ?? 0) - 1));
      }
      for (const [name, n] of running) {
        const key = `${village}:${name}`;
        const row = counts.get(key) ?? Array<number | null>(halls).fill(0).map((v, i) => (i < cocHalls ? v : null));
        row[h - 1] = n;
        counts.set(key, row);
      }
    }
  };
  hallCounts("Town Hall", "home", cocHomeHalls, homeHalls);
  hallCounts("Builder Hall", "builder", cocBuilderHalls, builderHalls);

  for (const b of buildings) {
    if (b.kind === "trap") continue;
    const fromCjs = cjsBuildingById.has(b.exportId) && !HALLS.has(b.name);
    if (fromCjs) {
      // Every army building clashofclans.js carries is one-per-base: one once
      // its cap is above zero. That is known at every hall, TH19 included.
      b.counts = b.caps.map((c) => (c && c > 0 ? 1 : 0));
    } else {
      const row = counts.get(`${b.village}:${b.name}`);
      if (row?.some((n) => n !== null && n > 0)) b.counts = row;
    }

    if (b.kind === "Town Hall") continue;
    const entity = stat.buildings.find((s) => s._id === b.exportId);
    const merging = entity?.levels?.filter((l) => l.merge_requirement?.length) ?? [];
    const needs = merging[0]?.merge_requirement;
    if (!needs) continue;
    const rule = (m: StaticLevel["merge_requirement"]) =>
      JSON.stringify([...(m ?? [])].sort((x, y) => x.name.localeCompare(y.name)));
    for (const l of merging.slice(1)) {
      if (rule(l.merge_requirement) !== rule(needs)) {
        console.log(`[game-data] WARNING ${b.name} level ${l.level} merges differently; only the first rule is used`);
      }
    }
    const merge = new Map<string, { name: string; n: number; level: number }>();
    for (const m of needs) {
      if (!buildings.some((x) => x.name === m.name && x.village === b.village)) {
        throw new Error(`${b.name} merges ${m.name}, which the data does not have`);
      }
      const entry = merge.get(m.name) ?? { name: m.name, n: 0, level: m.level };
      entry.n += 1;
      merge.set(m.name, entry);
    }
    b.merge = [...merge.values()];
  }

  // ── Upgrade costs ────────────────────────────────────────────────────────
  const costs: CostOut[] = [];

  // Buildings and traps: both sources price each level as the cost of reaching it.
  const reachLevels = (levels: Array<StaticLevel | CjsLevel> | undefined, max: number) =>
    Array.from({ length: max }, (_, i): CostOut["levels"][number] => {
      const l = levels?.find((x) => x.level === i + 1);
      return l && l.build_cost !== undefined ? [l.build_cost, l.build_time ?? 0] : null;
    });

  for (const e of [...stat.buildings, ...stat.traps]) {
    const village: Village = e.village === "builderBase" ? "builder" : "home";
    // clashofclans.js is newer where it has the building (TH19's prices).
    const cjs = cjsBuildingById.get(e._id);
    const levels: Array<StaticLevel | CjsLevel> | undefined = cjs?.levels ?? e.levels;
    const max = Math.max(0, ...(levels ?? []).map((l) => l.level));
    if (max === 0) continue;
    const row: CostOut = {
      type: "building",
      name: e.name,
      village,
      resource: resourceOf(cjs?.upgrade_resource ?? e.upgrade_resource, e.name),
      levels: reachLevels(levels, max),
    };
    const alt = e.levels?.find((l) => l.alt_upgrade_resource);
    if (alt) {
      row.alt = resourceOf(alt.alt_upgrade_resource, `${e.name} (alt)`);
      row.altFrom = alt.level;
    }
    costs.push(row);

    for (const l of e.levels ?? []) {
      if (!l.weapon) continue;
      const wmax = Math.max(0, ...l.weapon.levels.map((w) => w.level));
      costs.push({
        type: "weapon",
        name: l.weapon.name,
        village,
        resource: resourceOf(l.weapon.upgrade_resource, l.weapon.name),
        hall: l.level,
        levels: reachLevels(l.weapon.levels, wmax),
      });
    }
  }
  for (const b of cjsBuildings) {
    if (statIds.has(b.id) || HALLS.has(b.name)) continue;
    const max = Math.max(0, ...b.levels.map((l) => l.level));
    costs.push({
      type: "building",
      name: b.name,
      village: villageOf(b.village_type),
      resource: resourceOf(b.upgrade_resource, b.name),
      levels: reachLevels(b.levels, max),
    });
  }

  // Units: clashofclans.js prices a level as the cost of reaching it. Guardians
  // and the Builder Base are coc.py's, which prices the cost of LEAVING a level
  // — so reaching L is its entry for L - 1. Builder Base troops unlocked late
  // start high (Hog Glider at 15), so their lower levels have no price, correctly.
  const ORE_KEYS = ["shiny_ore", "glowy_ore", "starry_ore"] as const;
  for (const u of units) {
    if (u.group === "superTroop") continue; // their level follows the base troop
    const max = Math.max(0, ...u.caps.map((c) => c ?? 0));
    if (max < 2) continue;
    const levels: CostOut["levels"] = [null];

    if (u.group === "guardian" || u.village === "builder") {
      const g =
        u.group === "guardian"
          ? stat.guardians.find((x) => x.name === u.name)
          : [...stat.troops, ...stat.heroes].find((x) => x.name === u.name && x.village === "builderBase");
      for (let L = 2; L <= max; L++) {
        const l = g?.levels?.find((x) => x.level === L - 1);
        levels.push(l && l.upgrade_cost ? [l.upgrade_cost, l.upgrade_time ?? 0] : null);
      }
      costs.push({ type: "unit", name: u.name, village: u.village, resource: resourceOf(g?.upgrade_resource, u.name), levels });
      continue;
    }

    const r = cjsUnitByKey.get(`${u.village}:${u.name}`)!;
    for (let L = 2; L <= max; L++) {
      const l = r.levels.find((x) => x.level === L);
      const cost = l?.upgrade_cost;
      if (u.group === "equipment") {
        levels.push(cost && typeof cost === "object" ? [ORE_KEYS.map((k) => cost[k] ?? 0), 0] : null);
      } else {
        levels.push(typeof cost === "number" && cost > 0 ? [cost, l?.upgrade_time ?? 0] : null);
      }
    }
    const resource = u.group === "equipment" ? "ore" : resourceOf(r.upgrade_resource, u.name);
    costs.push({ type: "unit", name: u.name, village: u.village, resource, levels });
  }

  if (changed.length) {
    console.log(`[game-data] army buildings that differ from coc.py (newer game data):`);
    for (const line of changed) console.log(`  ${line}`);
  }

  const source = {
    generatedBy: "scripts/game-data.ts",
    clashofclansJs: CLASHOFCLANS_JS_VERSION,
    cocPy: COC_PY_COMMIT,
    homeHalls,
    builderHalls,
    /** The last hall every building's cap is known for; above it, coc.py-only buildings are null. */
    buildingHalls: cocHomeHalls,
  };

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, "units.json"), render(source, "units", units));
  await writeFile(join(OUT_DIR, "buildings.json"), render(source, "buildings", buildings));
  await writeFile(join(OUT_DIR, "upgrade-costs.json"), render(source, "costs", costs));

  console.log(
    `[game-data] ${units.length} units, ${buildings.length} buildings and traps, ` +
      `${costs.length} cost rows, ` +
      `TH1–${homeHalls}, BH1–${builderHalls}`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
