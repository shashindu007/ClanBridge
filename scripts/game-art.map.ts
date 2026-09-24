// How the Fan Kit names things, and which of our art keys each file is.
//
// The ONE place that knows the Fan Kit's filenames. Everything else in the
// product asks for keys (src/lib/game-art.ts), so when a new Fan Kit renames
// "Town_Hall_17.png" to "TH17_render.png" the fix is a pattern here and a re-run,
// and no page changes.
//
// Pure, so scripts/game-art.test.ts can pin it with real-looking paths.
//
// THE MATCHING IS DELIBERATELY NARROW. A file becomes a key only when its name
// (or its folder plus its name) contains a unit's whole name as words, a Town
// Hall number, or a league and division. Anything else is reported as unused
// rather than guessed at: art filed under the wrong key is a Hog Rider standing
// where a Valkyrie should be, and nobody would notice until a member did.

import { artKeyForLeague, artKeyForUnit, artSlug } from "../src/lib/game-art";
import type { UnitGroup } from "../src/data/game";
import type { Village } from "../src/types/domain";

export interface KnownUnit {
  name: string;
  group: UnitGroup;
  village: Village;
}

/** Where each key family is written under public/game/. */
export function folderFor(key: string): string {
  if (key.startsWith("th-")) return "townhall";
  if (key.startsWith("builder-troop-")) return "builder-troops";
  const prefix = key.split("-")[0];
  const folders: Record<string, string> = {
    hero: "heroes",
    troop: "troops",
    spell: "spells",
    pet: "pets",
    siege: "sieges",
    equipment: "equipment",
    guardian: "guardians",
    league: "leagues",
  };
  return folders[prefix] ?? "misc";
}

/** Words that decorate a Fan Kit filename without naming anything. */
const NOISE = new Set([
  "icon",
  "icons",
  "render",
  "renders",
  "hd",
  "png",
  "webp",
  "final",
  "copy",
  "transparent",
  "full",
  "body",
  "portrait",
  "art",
  "coc",
  "clash",
  "of",
  "clans",
]);

/** A path as a list of lowercase words, noise removed. */
export function words(path: string): string[] {
  const base = path
    .replace(/\\/g, "/")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2");
  return artSlug(base.replace(/\//g, " "))
    .split("-")
    .filter((w) => w && !NOISE.has(w));
}

function containsRun(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

/**
 * The key a Fan Kit file stands for, or null when it names nothing we show.
 *
 * `relativePath` is the path inside the unzipped kit, folders included —
 * folder names are often the only place "Builder Base" appears.
 */
export function matchArtKey(relativePath: string, units: readonly KnownUnit[]): string | null {
  const w = words(relativePath);
  const fileWords = words(relativePath.replace(/\\/g, "/").split("/").pop() ?? "");
  const joined = w.join(" ");

  // Town Hall: "Town Hall 17", "Town_Hall_17", "TH17", "th 17". Checked on the
  // FILE name only — a folder called "Town Hall" holds the hall's weapons too.
  const file = fileWords.join(" ");
  const th = /\btown ?hall ?(\d{1,2})\b/.exec(file) ?? /\bth ?(\d{1,2})\b/.exec(file);
  if (th) {
    const level = Number(th[1]);
    if (level >= 1 && level <= 30) return `th-${level}`;
  }

  // Leagues: "Crystal League I", "crystal_league_1", "Legend League".
  const league =
    /\b(bronze|silver|gold|crystal|master|champion|titan|legend) league(?: (i{1,3}|[1-3]))?\b/.exec(
      joined,
    );
  if (league) {
    const division = league[2] ? (/^\d$/.test(league[2]) ? league[2] : league[2].toUpperCase()) : "";
    const name = `${league[1]} League${division ? ` ${division}` : ""}`;
    return artKeyForLeague(name);
  }

  // Units: the longest unit name found as a whole run of words wins, so
  // "Super Barbarian" beats "Barbarian" and "Barbarian King" beats both.
  const builder = containsRun(w, ["builder", "base"]) || w.includes("builder");
  let best: { unit: KnownUnit; length: number } | null = null;
  for (const unit of units) {
    const full = artSlug(unit.name).split("-");
    // "Lightning Spell" is often filed as just "Lightning" inside a Spells folder.
    const needles =
      full.length > 1 && full[full.length - 1] === "spell" ? [full, full.slice(0, -1)] : [full];
    const needle = needles.find((n) => containsRun(w, n));
    if (!needle) continue;
    const onRightSide = unit.village === "home" ? !builder : builder;
    // A home-village unit in a Builder Base folder (or the reverse) only wins
    // when no unit from the right village matched at all.
    const length = needle.length + (onRightSide ? 100 : 0);
    if (!best || length > best.length) best = { unit, length };
  }
  return best ? artKeyForUnit(best.unit.name, best.unit.group) : null;
}
