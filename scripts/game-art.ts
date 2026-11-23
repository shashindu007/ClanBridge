// Turn an unzipped Supercell Fan Kit into the game art this product shows.
//
//   npm run game-art -- "C:/Downloads/Clash of Clans Fan Kit" --dry-run
//   npm run game-art -- "C:/Downloads/Clash of Clans Fan Kit"
//   npm run game-art -- "C:/Downloads/Assets 2026-11-23" --add
//
// --add is for a PARTIAL kit — the handful of new renders Supercell posts with
// an update. It keeps every file and manifest entry already here and writes
// only keys the manifest does not have yet. Without it the run starts clean,
// which on a partial kit would delete every picture it does not contain.
//
// Run it on a developer machine after downloading the kit from
// https://fankit.supercell.com/ — never in CI or a page. The output is
// committed, so the build needs neither the kit nor this script.
//
// WHAT IT DOES
//
//   1. Walks the kit for .png/.webp/.jpg files.
//   2. Names each one with a key the product owns (scripts/game-art.map.ts),
//      or leaves it unused. When several files name the same thing, the
//      better source wins by preference() in the map — a CWL badge, then not
//      Clan Capital, then the icon over a render, then not "old" — and after
//      that the larger file, being the higher-resolution source.
//   3. Trims the transparent border, fits the picture inside a square WITHOUT
//      cropping or recolouring, and writes webp to
//      public/game/<family>/<key>.webp. The square is twice the largest size
//      the product draws that family at, for a sharp screen and no more
//      (sizeFor below): every byte here ships in the repo and to members.
//   4. Rewrites src/data/game/art-manifest.json to list exactly what it wrote.
//
// THE RULES THIS KEEPS (globals.css, public/game/README.md): Fan Kit art only,
// changed in size and format and nothing else. No logos, no fonts. The script
// does not touch a file's pixels beyond scaling it, and it refuses anything
// whose name says it is a logo.
//
// WHY sharp, WHEN IMPLEMENTATION.md §3 REJECTS IT. That rejection is about the
// running application — resizing uploads on a serverless host — where the
// answer is "compress in the browser before upload". This is a developer-only
// asset step that runs a few times a year; sharp is already in the lockfile as
// Next's own optional dependency, and writing a webp encoder by hand, as
// make-icons.ts does for PNG, is not a good use of anyone's time.

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import buildingsFile from "../src/data/game/buildings.json";
import unitsFile from "../src/data/game/units.json";
import { artKeyForBuilding, artKeyForUnit, type ArtManifest } from "../src/lib/game-art";
import {
  comparePreference,
  folderFor,
  matchArtKey,
  preference,
  type KnownBuilding,
  type KnownUnit,
} from "./game-art.map";

const OUT_DIR = join(process.cwd(), "public", "game");
const MANIFEST = join(process.cwd(), "src", "data", "game", "art-manifest.json");
const IMAGE = /\.(png|webp|jpe?g)$/i;
const LOGO = /\blogo|wordmark|font/i;
/** Wider than tall (or taller than wide) by more than this: a sheet, not one picture. */
const SHEET_RATIO = 1.8;

/**
 * The square each family is written at: twice the largest it is drawn.
 * Town Halls reach 72px (TownHall "lg"), leagues 64px (LeagueArt on the CWL
 * page), everything else 52px (a hero on base details). A family drawn larger
 * later needs this raised, or it will look soft.
 */
function sizeFor(key: string): number {
  if (key.startsWith("th-")) return 144;
  if (key.startsWith("league-")) return 128;
  return 104;
}

/**
 * webp settings. Around 72 the art is indistinguishable from 82 at these
 * sizes and a good deal smaller; `effort` 6 is the slowest, smallest encode,
 * which costs seconds on a script run a few times a year.
 */
const WEBP = { quality: 72, alphaQuality: 80, effort: 6 } as const;

/** The keys the product actually asks for. Reported when the kit lacks one. */
function wantedKeys(units: readonly KnownUnit[], buildings: readonly KnownBuilding[], homeHalls: number): string[] {
  const halls = Array.from({ length: homeHalls }, (_, i) => `th-${i + 1}`);
  const heroes = units
    .filter((u) => u.group === "hero" || u.group === "pet")
    .map((u) => artKeyForUnit(u.name, u.group));
  const leagues = ["bronze", "silver", "gold", "crystal", "master", "champion", "titan"].flatMap(
    (tier) => [1, 2, 3].map((d) => `league-${tier}-${d}`),
  );
  // Home-village buildings and traps: what a base's tiles and the tracker show.
  const homeBuildings = buildings
    .filter((b) => b.village === "home")
    .map((b) => artKeyForBuilding(b.name, b.village, b.kind))
    .filter((k): k is string => k !== null);
  return [...halls, ...heroes, ...leagues, "league-legend", ...homeBuildings];
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (IMAGE.test(entry.name)) out.push(path);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const add = args.includes("--add");
  const kit = args.find((a) => !a.startsWith("--"));
  if (!kit) {
    console.error('Usage: npm run game-art -- "<unzipped fan kit folder>" [--add] [--dry-run]');
    process.exit(1);
  }

  const units: KnownUnit[] = (unitsFile.units as KnownUnit[]).map((u) => ({
    name: u.name,
    group: u.group,
    village: u.village,
  }));

  const buildings: KnownBuilding[] = (buildingsFile.buildings as KnownBuilding[]).map((b) => ({
    name: b.name,
    village: b.village,
    kind: b.kind,
  }));

  const files = await walk(kit);
  const { default: sharp } = await import("sharp");
  const sheets: string[] = [];
  const chosen = new Map<string, { path: string; bytes: number; rank: number[] }>();
  const unused: string[] = [];

  for (const path of files) {
    const rel = relative(kit, path);
    if (LOGO.test(rel)) {
      unused.push(rel);
      continue;
    }
    const key = matchArtKey(rel, units, buildings);
    if (!key) {
      unused.push(rel);
      continue;
    }
    // A file much wider than tall (or the reverse) is a SHEET — two states of
    // a building side by side. Fitted into a square without cropping (which the
    // rules forbid) it is two specks, so it is left for a file that shows one.
    const { width = 1, height = 1 } = await sharp(path, { limitInputPixels: false }).metadata();
    if (Math.max(width, height) / Math.max(1, Math.min(width, height)) > SHEET_RATIO) {
      sheets.push(`${rel} (${width}×${height})`);
      continue;
    }
    const { size: bytes } = await stat(path);
    const rank = preference(rel);
    const current = chosen.get(key);
    // The better kind of source wins however large the other file is (see
    // preference()); between two of the same kind, the larger file.
    const order = current ? comparePreference(rank, current.rank) : 1;
    const better = !current || order > 0 || (order === 0 && bytes > current.bytes);
    if (better) chosen.set(key, { path, bytes, rank });
  }

  // --add: what the manifest already has stays as it is, file and entry.
  const existingManifest: ArtManifest | null = add
    ? (JSON.parse(await readFile(MANIFEST, "utf8")) as ArtManifest)
    : null;
  const kept = new Set(Object.keys(existingManifest?.files ?? {}));
  const keys = [...chosen.keys()].filter((k) => !kept.has(k)).sort();
  const skipped = [...chosen.keys()].filter((k) => kept.has(k)).sort();
  console.log(`${files.length} images in the kit, ${chosen.size} matched a key${add ? `, ${keys.length} of them new` : ""}.\n`);
  for (const key of keys) {
    console.log(`  ${key.padEnd(34)} ← ${relative(kit, chosen.get(key)!.path)}`);
  }

  if (skipped.length) {
    console.log(`\nAlready in the manifest, kept as they are (--add):\n  ${skipped.join(", ")}`);
  }

  const have = new Set([...keys, ...kept]);
  const missing = wantedKeys(units, buildings, unitsFile.source.homeHalls).filter((k) => !have.has(k));
  if (missing.length) {
    console.log(`\nNot found in this kit (these keep their drawn fallback):`);
    console.log(`  ${missing.join(", ")}`);
  }
  if (sheets.length) console.log(`\nSheets of several pictures, not used:\n  ${sheets.join("\n  ")}`);
  console.log(`\n${unused.length} images unused.`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }


  // Start clean, so a key the new kit no longer has does not linger as a file
  // the manifest has stopped listing. Only the art folders: README.md stays.
  // Never with --add, whose kit is a handful of files, not the whole set.
  if (!add) {
    const existing = await readdir(OUT_DIR, { withFileTypes: true }).catch(() => []);
    for (const entry of existing) {
      if (entry.isDirectory()) await rm(join(OUT_DIR, entry.name), { recursive: true, force: true });
    }
  }

  const kitName = kit.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? kit;
  const today = new Date().toISOString().slice(0, 10);
  const manifest: ArtManifest = existingManifest
    ? {
        source: {
          fanKit: existingManifest.source ? `${existingManifest.source.fanKit} + ${kitName}` : kitName,
          generatedAt: today,
        },
        files: { ...existingManifest.files },
      }
    : { source: { fanKit: kitName, generatedAt: today }, files: {} };

  for (const key of keys) {
    const size = sizeFor(key);
    const folder = folderFor(key);
    await mkdir(join(OUT_DIR, folder), { recursive: true });
    const out = join(OUT_DIR, folder, `${key}.webp`);
    // Some kit renders are 100 MB+ (8k squares); sharp refuses those by default.
    await sharp(chosen.get(key)!.path, { limitInputPixels: false })
      .trim()
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp(WEBP)
      .toFile(out);
    manifest.files[key] = { src: `/game/${folder}/${key}.webp`, width: size, height: size };
  }

  // Sorted, so an --add run diffs as the lines it added.
  manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nWrote ${keys.length} files to public/game/ and the manifest.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
