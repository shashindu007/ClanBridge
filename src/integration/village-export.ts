// T11B.11 — the in-game "Export village data" JSON, parsed and mapped.
//
// A member copies it from Settings → More Settings → Data Export and pastes it
// into Base details. It is the only way to see BUILDINGS, walls, traps and running
// upgrade timers, none of which the official API exposes.
//
// ─────────────────────────────────────────────────────────────────────────────
// VIEW ONLY, IN THE BROWSER, NEVER STORED
//
// This module runs in the member's browser (components/village-export-paste.tsx)
// and nowhere else. Nothing here is sent to the server, and there is no table for
// it. That is a decision, not a gap:
//
//   - R11. The export is a game fact, but a PERSON supplies it. A table written
//     by pasting would be a game-fact table with a human writer, which is the
//     mixing R11 forbids, and it could not be told apart from a real reading.
//   - The member asked to see it, not to publish it. It carries base coordinates
//     and a complete defensive inventory, and leadership has no need of either.
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
  capAt,
  unitByExportId,
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
  units2: "builderTroop",
  heroes2: "builderHero",
};

export function mapVillageExport(raw: RawExport, now: Date = new Date()): ExportedVillage {
  const exportedAt = raw.timestamp ?? now.getTime() / 1000;
  const thLevel = raw.buildings?.find((b) => b.data === TOWN_HALL_ID)?.lvl;
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
        // 0 means the data has no level requirements for it at this hall (a
        // Helper Hut, a Crafting Station) — nothing to measure against, so null.
        cap: (data && capAt(data.caps, hallFor(village))) || null,
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
      const apiMax = data ? Math.max(...data.caps) : level;
      const cap = data ? capAt(data.caps, hallFor(village)) : undefined;
      const capKnown = cap !== undefined && cap > 0 && level <= cap;

      units.push({
        name,
        level,
        apiMax,
        village,
        group: data?.group ?? SECTION_GROUP[section]!,
        ...(data?.hero ? { hero: data.hero } : {}),
        cap: capKnown ? cap! : apiMax,
        capKnown,
      });
      noteUpgrade(name, village, level, row);
    }
  };

  for (const section of ["heroes", "pets", "guardians", "units", "spells", "siege_machines", "equipment"] as const) {
    addUnits(section, "home");
  }
  addUnits("units2", "builder");
  addUnits("heroes2", "builder");

  return {
    tag: normaliseTag(raw.tag ?? ""),
    exportedAt: new Date(exportedAt * 1000).toISOString(),
    thLevel: thLevel ?? null,
    bhLevel: bhLevel ?? null,
    buildings: [...buildings.values()],
    units,
    upgrades: upgrades.sort((a, b) => a.remainingSeconds - b.remainingSeconds),
    unknownIds,
  };
}
