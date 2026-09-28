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

/**
 * Words that mark a FILE as a scene or a badge rather than one unit's
 * portrait. Checked on the file name only, so a folder called "Badges" does
 * not hide the icons filed inside it.
 */
const SCENE = new Set([
  "badge",
  "loading",
  "screen",
  "wallpaper",
  "banner",
  "poster",
  "kingdom",
  "characters",
  "clashiversary",
  "villager",
  "scene",
]);

/**
 * Whether a file is the kit's square icon ("Icon_HV_Hog_Rider") rather than
 * a render. Icons are what a 128px square wants, so they win over a larger
 * full-body picture of the same unit.
 */
export function isIconFile(relativePath: string): boolean {
  const file = relativePath.replace(/\\/g, "/").split("/").pop() ?? "";
  return /(^|[^a-z])icons?([^a-z]|$)/i.test(file);
}

/**
 * How good a source a file is for its key, compared left to right when two
 * files match the same key; the larger file breaks a tie.
 *
 *   1. A CWL badge ("Icon_HV_CWL_Master_2") over a trophy-league icon. Every
 *      league picture in the product is a WAR league — the clan page, the CWL
 *      pages, the clan tiles — and the two are different badges.
 *   2. Not Clan Capital ("Icon_CC_…"). The product shows no Capital units, and
 *      the kit's Capital Rage is a jar where the home village's is a vial. A
 *      Capital file is still used when it is the only one there is.
 *   3. The kit's square icon over a render: a full-body picture on grass
 *      shrinks to a smudge at icon size.
 *   4. Not a file marked "old" ("Icon_HV_Spell_Freeze_old"), where the kit
 *      keeps a "new" beside it.
 */
export function preference(relativePath: string): number[] {
  const fileWords = words(relativePath.replace(/\\/g, "/").split("/").pop() ?? "");
  const capital = fileWords.includes("cc") || words(relativePath).includes("capital");
  return [
    fileWords.includes("cwl") ? 1 : 0,
    capital ? 0 : 1,
    isIconFile(relativePath) ? 1 : 0,
    fileWords.includes("old") ? 0 : 1,
  ];
}

/** Whether `a` is a better source than `b` by preference(), before file size. */
export function comparePreference(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

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

  // Scenes, not portraits: a "League_Badge_Archer" is a badge with an archer
  // on it, "SkeletonKingdom_withCharacters" a poster. Filed under a unit's key
  // they would stand in for the unit, so they are never matched.
  if (fileWords.some((word) => SCENE.has(word))) return null;

  // Town Hall: "Town Hall 17", "Town_Hall_17", "TH17", "th 17". Checked on the
  // FILE name only — a folder called "Town Hall" holds the hall's weapons too.
  const file = fileWords.join(" ");
  // The kit also says "Building_HV_Town_Hall_level_16".
  const th = /\btown ?hall(?: level)? ?(\d{1,2})\b/.exec(file) ?? /\bth ?(\d{1,2})\b/.exec(file);
  if (th) {
    const level = Number(th[1]);
    if (level >= 1 && level <= 30) return `th-${level}`;
  }

  const tiers = "bronze|silver|gold|crystal|master|champion|titan|legend";

  // CWL badges: "Icon_HV_CWL_Master_2". The kit misnames two of them,
  // "Silver_12" and "Silver_13"; the badges themselves read II and III, so a
  // leading 1 is dropped. Their name is the war league's ("Master League II").
  const cwl = new RegExp(`\\bcwl (${tiers}) (1?[1-3])\\b`).exec(joined);
  if (cwl) return artKeyForLeague(`${cwl[1]} League ${cwl[2].slice(-1)}`);

  // Leagues: "Crystal League I", "crystal_league_1", "Legend League", and the
  // other way round — "league-legend", "League_Crystal_2".
  const league =
    new RegExp(`\\b(${tiers}) league(?: (i{1,3}|[1-3]))?\\b`).exec(joined) ??
    new RegExp(`\\bleague (${tiers})(?: (i{1,3}|[1-3]))?\\b`).exec(joined);
  if (league) {
    const division = league[2] ? (/^\d$/.test(league[2]) ? league[2] : league[2].toUpperCase()) : "";
    const name = `${league[1]} League${division ? ` ${division}` : ""}`;
    return artKeyForLeague(name);
  }

  // Units: the longest unit name found as a whole run of words wins, so
  // "Super Barbarian" beats "Barbarian" and "Barbarian King" beats both.
  // The kit prefixes files "Icon_BB_…" (Builder Base) and "Icon_HV_…" (home
  // village); a folder name is the other place the village is said.
  const builder =
    containsRun(w, ["builder", "base"]) || w.includes("builder") || fileWords.includes("bb");
  const inSpellsFolder = w.includes("spells") || w.includes("spell");
  let best: { unit: KnownUnit; length: number } | null = null;
  for (const unit of units) {
    // A file that says "super" is a super troop's. "Icon_CC_Troop_Super_P.E.K.K.A"
    // names a troop the product does not have, and without this it was filed
    // as the P.E.K.K.A. Ice Hound, Inferno Dragon and Rocket Balloon are super
    // troops without the word in their name, so the test is the group.
    if (fileWords.includes("super") && unit.group !== "superTroop") continue;
    const full = artSlug(unit.name).split("-");
    // "Lightning Spell" is often filed as just "Lightning" inside a Spells
    // folder — but only there: a lone "Skeleton" elsewhere is not a spell.
    const needles =
      full.length > 1 && full[full.length - 1] === "spell" && inSpellsFolder
        ? [full, full.slice(0, -1)]
        : [full];
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
