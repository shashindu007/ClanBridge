// Game art: which picture stands for a Town Hall, a hero, a troop or a league,
// and whether this deployment actually has it.
//
// THE ART IS OPTIONAL, AND THAT IS THE DESIGN. The pictures come from Supercell's
// Fan Kit, which a person downloads and runs through scripts/game-art.ts; nothing
// fetches them, and a fresh clone has none. So every place that shows art asks
// this module first and draws its own fallback when the answer is null — a "TH
// 17" chip, a tinted shield — and the product is whole either way. No page may
// assume a file exists.
//
// A MANIFEST, NOT A FILE CHECK. src/data/game/art-manifest.json is written by the
// same script that writes the images, listing exactly what it wrote with each
// image's size. Importing it makes "is there art for th-17" a build-time fact:
// no filesystem call at request time, no <img> pointing at a 404, and the same
// answer on the server and in the browser.
//
// KEYS ARE NAMES WE OWN. `th-17`, `hero-barbarian-king`, `league-crystal-1` —
// derived from the game data's own unit names (src/data/game), never from the
// Fan Kit's filenames, which change between releases. scripts/game-art.map.ts
// is the one place that knows how the Fan Kit names things.
//
// Pure, no Node imports: GameArt renders in server and client components alike.

import manifestFile from "@/data/game/art-manifest.json";
import type { UnitGroup } from "@/data/game";

export interface ArtEntry {
  /** Public path, e.g. /game/townhall/th-17.webp */
  src: string;
  width: number;
  height: number;
}

export interface ArtManifest {
  /** Which Fan Kit the files came from, stamped by the script. Null when empty. */
  source: { fanKit: string; generatedAt: string } | null;
  files: Record<string, ArtEntry>;
}

export const ART_MANIFEST: ArtManifest = manifestFile as ArtManifest;

/**
 * A name as a key fragment: "P.E.K.K.A" → "pekka", "Barbarian King" →
 * "barbarian-king", "Hog Rider" → "hog-rider". Dots and apostrophes vanish
 * rather than becoming dashes, so an abbreviation stays one word.
 */
export function artSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** `th-1` … `th-18`. Null for a level the game does not have, or none at all. */
export function artKeyForTownHall(level: number | null | undefined): string | null {
  if (!level || !Number.isInteger(level) || level < 1 || level > 30) return null;
  return `th-${level}`;
}

/**
 * The folder a unit's art lives in. Builder Base troops are their own family
 * (a Builder Base Barbarian is not the home one), heroes of both villages share
 * one, and the three spell and troop families collapse to one each.
 */
const GROUP_PREFIX: Record<UnitGroup, string> = {
  hero: "hero",
  builderHero: "hero",
  equipment: "equipment",
  pet: "pet",
  elixirTroop: "troop",
  darkTroop: "troop",
  superTroop: "troop",
  siege: "siege",
  elixirSpell: "spell",
  darkSpell: "spell",
  guardian: "guardian",
  builderTroop: "builder-troop",
};

export function artKeyForUnit(name: string, group: UnitGroup): string {
  return `${GROUP_PREFIX[group]}-${artSlug(name)}`;
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };

/**
 * A league's name as a key. "Crystal League I" → `league-crystal-1`, "Master
 * League III" → `league-master-3`, "Legend League" → `league-legend`. War leagues
 * and trophy leagues share names, so they share art. "Unranked" (and nothing) is
 * null — there is no picture for not having a league.
 */
export function artKeyForLeague(name: string | null | undefined): string | null {
  if (!name) return null;
  const words = artSlug(name).split("-").filter((w) => w !== "league");
  if (words.length === 0 || words[0] === "unranked") return null;

  const last = words[words.length - 1];
  const division = ROMAN[last] ?? (/^\d+$/.test(last) ? Number(last) : null);
  const base = division === null ? words : words.slice(0, -1);
  if (base.length === 0) return null;
  return `league-${base.join("-")}${division === null ? "" : `-${division}`}`;
}

/** The art for a key, or null when this deployment has none. */
export function resolveArt(
  key: string | null | undefined,
  manifest: ArtManifest = ART_MANIFEST,
): ArtEntry | null {
  if (!key) return null;
  return manifest.files[key] ?? null;
}
