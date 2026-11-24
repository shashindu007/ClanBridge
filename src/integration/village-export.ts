// T11B.11 — the in-game "Export village data" JSON, parsed and mapped.
//
// A member copies it from Settings → More Settings → Data Export and uploads it
// on Home or Base details. It is the only way to see BUILDINGS, walls, traps and
// running upgrade timers, none of which the official API exposes.
//
// ─────────────────────────────────────────────────────────────────────────────
// PARSED TWICE, AND ONLY THE MAPPED VILLAGE IS KEPT
//
// This module runs in the browser (components/village-export-upload.tsx), for an
// instant answer, and again on the server (app/(app)/account/bases/actions.ts),
// whose result is what 076 saves. It was once view-only and never stored; 076's
// header records why that changed and how its two reasons still hold:
//
//   - R11. The export is a game fact, but a PERSON supplies it. So it has its own
//     owner-written table and is never merged into player_progress, where it
//     could not be told apart from a real reading.
//   - It carries base coordinates and a complete defensive inventory. The raw
//     text is never stored — mapVillageExport() keeps counts per level, not
//     positions — and only the owner can read the saved village.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE SHAPE, AND WHERE IT WAS CONFIRMED
//
// The official API has no schema for this, so it was confirmed against two
// public trackers that parse it in production — clashcwl.com's analyzer and
// clashwatcher.com — rather than guessed:
//
//   { tag, timestamp,                         // unix SECONDS the export was taken
//     buildings, traps, heroes, pets, guardians, helpers,
//     units, spells, siege_machines, equipment,          // home village
//     buildings2, traps2, units2, heroes2 }              // Builder Base
//
// Each row is { data, lvl, cnt?, timer?, gear_up?, supercharge?, ... }:
//   data     Supercell's global id — class * 1,000,000 + row (src/data/game/)
//   lvl      current level. While upgrading, still the level BEING LEFT.
//   cnt      how many identical instances the row stands for (walls: hundreds)
//   timer    seconds of upgrade remaining AT `timestamp`, not now
//
// Every object is looseObject and every field but `data` optional, for the
// reason coc-schemas.ts gives: Supercell adds fields without notice, and a
// strict schema would turn a harmless addition into "not a village export".
//
// R7 — the raw shape stops here. Nothing above this file sees `lvl`, `cnt` or a
// numeric data id.

import { z } from "zod";
import {
  buildingByExportId,
  buildingByName,
  capAt,
  findUnit,
  maxCap,
  unitByExportId,
  type GameBuilding,
  type GameUnit,
  type ResolvedUnit,
  type UnitGroup,
} from "@/data/game";
import { normaliseTag } from "@/lib/tags";
import type {
  ExportedBuilding,
  ExportedUpgrade,
  ExportedVillage,
} from "@/types/village";
import type { Village } from "@/types/domain";

/** A paste larger than this is not a village export. A maxed TH18 is ~60 KB. */
export const MAX_EXPORT_BYTES = 1_000_000;

const rowSchema = z.looseObject({
  data: z.number(),
  lvl: z.number().optional(),
  cnt: z.number().optional(),
  timer: z.number().optional(),
  gear_up: z.union([z.boolean(), z.number()]).optional(),
  supercharge: z.number().optional(),
  /** Town Hall row only: the weapon's level. */
  weapon: z.number().optional(),
});

const rows = z.array(rowSchema).optional();

export const villageExportSchema = z.looseObject({
  tag: z.string().optional(),
  timestamp: z.number().optional(),
  buildings: rows,
  traps: rows,
  heroes: rows,
  pets: rows,
  guardians: rows,
  units: rows,
  spells: rows,
  siege_machines: rows,
  equipment: rows,
  /** TH19's squads, if the game lists them apart from `units`. Unconfirmed. */
  squads: rows,
  buildings2: rows,
  traps2: rows,
  units2: rows,
  heroes2: rows,
});

type ExportRow = z.infer<typeof rowSchema>;
type RawExport = z.infer<typeof villageExportSchema>;

export type ParseResult =
  | { ok: true; village: ExportedVillage }
  | { ok: false; error: string };

const TOWN_HALL_ID = 1_000_001;
const BUILDER_HALL_ID = 1_000_034;

/**
 * Text in, a village or a sentence out. Never throws — every failure is a thing a
 * member did (pasted the wrong text), so every failure is a message for them.
 */
export function parseVillageExport(text: string, now: Date = new Date()): ParseResult {
  if (new Blob([text]).size > MAX_EXPORT_BYTES) {
    return { ok: false, error: "That is far too long to be a village export." };
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "That is not valid JSON. Copy the whole export again and paste all of it.",
    };
  }

  const parsed = villageExportSchema.safeParse(json);
  if (!parsed.success || !parsed.data.buildings?.length || !parsed.data.tag) {
    return {
      ok: false,
      error:
        "That does not look like a village export. In game: Settings → More Settings → Data Export → Copy.",
    };
  }

  try {
    return { ok: true, village: mapVillageExport(parsed.data, now) };
  } catch {
    // normaliseTag throws on a tag that could not be real.
    return { ok: false, error: "The export's player tag is not a valid tag." };
  }
}

/**
 * Seconds remaining NOW, from seconds remaining at export time. Clamped at zero:
 * an upgrade that has finished since the export is finished, not negative.
 */
function remainingNow(timer: number, exportedAt: number, now: Date): number {
  const elapsed = Math.max(0, now.getTime() / 1000 - exportedAt);
  return Math.max(0, Math.round(timer - elapsed));
}

/** Which unit group a section's unknown id falls back to. */
const SECTION_GROUP: Record<string, UnitGroup> = {
  heroes: "hero",
  pets: "pet",
  guardians: "guardian",
  units: "elixirTroop",
  spells: "elixirSpell",
  siege_machines: "siege",
  equipment: "equipment",
  squads: "squad",
  units2: "builderTroop",
  heroes2: "builderHero",
};

export function mapVillageExport(raw: RawExport, now: Date = new Date()): ExportedVillage {
  const exportedAt = raw.timestamp ?? now.getTime() / 1000;
  const townHall = raw.buildings?.find((b) => b.data === TOWN_HALL_ID);
  const thLevel = townHall?.lvl;
  const bhLevel = raw.buildings2?.find((b) => b.data === BUILDER_HALL_ID)?.lvl;
  const hallFor = (village: Village) => (village === "home" ? thLevel : bhLevel);

  const upgrades: ExportedUpgrade[] = [];
  let unknownIds = 0;

  const noteUpgrade = (name: string, village: Village, level: number, row: ExportRow) => {
    if (row.timer == null) return;
    const seconds = remainingNow(row.timer, exportedAt, now);
    upgrades.push({
      name,
      village,
      fromLevel: level,
      remainingSeconds: seconds,
      finishesAt: new Date(now.getTime() + seconds * 1000).toISOString(),
    });
  };

  // ── Buildings and traps: aggregated per building type ──────────────────────
  const buildings = new Map<string, ExportedBuilding>();

  const addBuilding = (row: ExportRow, village: Village, trapSection: boolean) => {
    const data = buildingByExportId(row.data);
    if (!data) unknownIds++;

    const name = data?.name ?? `Unknown #${row.data}`;
    const kind = data?.kind ?? (trapSection ? "trap" : "Other");
    const level = row.lvl ?? 0;
    const count = Math.max(1, row.cnt ?? 1);
    const key = `${village}:${row.data}`;

    const entry =
      buildings.get(key) ??
      ({
        name,
        village,
        kind,
        ...buildingCap(data, hallFor(village)),
        count: 0,
        levels: {},
        upgrading: 0,
        geared: 0,
        supercharged: 0,
      } satisfies ExportedBuilding);

    entry.count += count;
    entry.levels[level] = (entry.levels[level] ?? 0) + count;
    if (row.timer != null) {
      entry.upgrading += count;
      noteUpgrade(name, village, level, row);
    }
    if (row.gear_up === true || row.gear_up === 1) entry.geared += count;
    if ((row.supercharge ?? 0) > 0) entry.supercharged += count;

    buildings.set(key, entry);
  };

  for (const row of raw.buildings ?? []) addBuilding(row, "home", false);
  for (const row of raw.traps ?? []) addBuilding(row, "home", true);
  for (const row of raw.buildings2 ?? []) addBuilding(row, "builder", false);
  for (const row of raw.traps2 ?? []) addBuilding(row, "builder", true);

  // ── Units: resolved against the same caps the sync job uses ────────────────
  const units: ResolvedUnit[] = [];
  const addUnits = (section: keyof typeof SECTION_GROUP, village: Village) => {
    for (const row of (raw[section as keyof RawExport] as ExportRow[] | undefined) ?? []) {
      const data = unitByExportId(row.data);
      if (!data) unknownIds++;

      const name = data?.name ?? `Unknown #${row.data}`;
      const level = row.lvl ?? 0;
      const group = data?.group ?? SECTION_GROUP[section]!;
      units.push(unitCap(data, { name, level, village, group }, hallFor(village)));
      noteUpgrade(name, village, level, row);
    }
  };

  for (const section of ["heroes", "pets", "guardians", "units", "squads", "spells", "siege_machines", "equipment"] as const) {
    addUnits(section, "home");
  }
  addUnits("units2", "builder");
  addUnits("heroes2", "builder");

  return {
    tag: normaliseTag(raw.tag ?? ""),
    exportedAt: new Date(exportedAt * 1000).toISOString(),
    thLevel: thLevel ?? null,
    bhLevel: bhLevel ?? null,
    thWeapon: townHall?.weapon ?? null,
    buildings: [...buildings.values()],
    units,
    upgrades: upgrades.sort((a, b) => a.remainingSeconds - b.remainingSeconds),
    unknownIds,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPS, AT PARSE TIME AND AGAIN AT READ TIME
//
// A saved export (076) is read for weeks. The game data is regenerated in that
// time — TH19 arrived — so the caps an export was saved with go stale, and a
// building the data did not know was saved as "Unknown #1000106". refreshVillage()
// re-applies the CURRENT data on every read, through the same two functions the
// parser uses, so nobody has to upload again after `npm run game-data`.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A building's cap at its hall, and whether that cap is still to come.
 *
 *   cap         the level to measure against, or null for nothing to measure
 *   capPending  the data has not caught up: the building is newer than it, or
 *               its cap at this hall is unknown (TH19 while coc.py stops at 18).
 *               Never "maxed" — the page says the data is behind.
 *
 * A cap of 0 is a building with no levels at this hall (a Helper Hut, a
 * Crafting Station): nothing to measure, and nothing pending either.
 */
export function buildingCap(
  data: GameBuilding | undefined,
  hall: number | null | undefined,
): Pick<ExportedBuilding, "cap" | "capPending"> {
  if (!data) return { cap: null, capPending: true };
  if (!hall) return { cap: null };
  const cap = capAt(data.caps, hall);
  if (cap === null || cap === undefined) return { cap: null, capPending: true };
  return cap > 0 ? { cap } : { cap: null };
}

/**
 * A unit at its hall's cap. When the cap is unknown — the unit is newer than the
 * data, the hall is above it, or the unit is above its cap (the data is stale) —
 * `capKnown` is false and `cap` is the highest level the data knows, never less
 * than the unit's own. Pages must not read such a unit as maxed.
 */
function unitCap(
  data: GameUnit | undefined,
  unit: { name: string; level: number; village: Village; group: UnitGroup },
  hall: number | null | undefined,
): ResolvedUnit {
  const apiMax = Math.max(data ? maxCap(data.caps) : 0, unit.level);
  const cap = data && hall ? capAt(data.caps, hall) : undefined;
  const capKnown = typeof cap === "number" && cap > 0 && unit.level <= cap;
  return {
    ...unit,
    apiMax,
    ...(data?.hero ? { hero: data.hero } : {}),
    cap: capKnown ? cap : apiMax,
    capKnown,
  };
}

const UNKNOWN = /^Unknown #(\d+)$/;

/**
 * A saved export, re-read against the current game data. Pure and idempotent.
 *
 *   - "Unknown #id" names the data has since learned become real names, on the
 *     buildings, the units and the running upgrades alike.
 *   - Every cap is worked out again for the village's hall.
 *   - `unknownIds` counts what is still unknown.
 *
 * Counts, levels and timers are the member's and are never touched.
 */
export function refreshVillage(v: ExportedVillage): ExportedVillage {
  const hallFor = (village: Village) => (village === "home" ? v.thLevel : v.bhLevel);
  const renamed = new Map<string, string>();
  let unknown = 0;

  const buildings = v.buildings.map((b): ExportedBuilding => {
    const id = UNKNOWN.exec(b.name)?.[1];
    const data = id ? buildingByExportId(Number(id)) : buildingByName(b.name, b.village);
    if (id && data) renamed.set(`${b.village}:${b.name}`, data.name);
    if (!data) unknown++;
    // An unknown building's kind was guessed at parse time; the data's is better.
    const { capPending: _stale, ...rest } = b;
    void _stale;
    return {
      ...rest,
      ...(data ? { name: data.name, kind: data.kind } : {}),
      ...buildingCap(data, hallFor(b.village)),
    };
  });

  const units = v.units.map((u) => {
    const id = UNKNOWN.exec(u.name)?.[1];
    const data = id ? unitByExportId(Number(id)) : findUnit(u.name, u.village);
    if (id && data) renamed.set(`${u.village}:${u.name}`, data.name);
    if (!data) unknown++;
    const unit = { name: data?.name ?? u.name, level: u.level, village: u.village, group: data?.group ?? u.group };
    return unitCap(data, unit, hallFor(u.village));
  });

  const upgrades = v.upgrades.map((u) => {
    const name = renamed.get(`${u.village}:${u.name}`);
    return name ? { ...u, name } : u;
  });

  return { ...v, buildings, units, upgrades, unknownIds: unknown };
}
