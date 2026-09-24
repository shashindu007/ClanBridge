// Turn an unzipped Supercell Fan Kit into the game art this product shows.
//
//   npm run game-art -- "C:/Downloads/Clash of Clans Fan Kit" --dry-run
//   npm run game-art -- "C:/Downloads/Clash of Clans Fan Kit"
//
// Run it on a developer machine after downloading the kit from
// https://fankit.supercell.com/ — never in CI or a page. The output is
// committed, so the build needs neither the kit nor this script.
//
// WHAT IT DOES
//
//   1. Walks the kit for .png/.webp/.jpg files.
//   2. Names each one with a key the product owns (scripts/game-art.map.ts),
//      or leaves it unused. When several files name the same thing — a kit
//      often ships a render and an icon — the largest file wins, being the
//      highest-resolution source.
//   3. Trims the transparent border, fits the picture inside a square (160px
//      for Town Halls, 128px for the rest) WITHOUT cropping or recolouring,
//      and writes webp to public/game/<family>/<key>.webp.
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

import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import unitsFile from "../src/data/game/units.json";
import { artKeyForUnit, type ArtManifest } from "../src/lib/game-art";
import { folderFor, matchArtKey, type KnownUnit } from "./game-art.map";

const OUT_DIR = join(process.cwd(), "public", "game");
const MANIFEST = join(process.cwd(), "src", "data", "game", "art-manifest.json");
const IMAGE = /\.(png|webp|jpe?g)$/i;
const LOGO = /\blogo|wordmark|font/i;

/** The keys the product actually asks for. Reported when the kit lacks one. */
function wantedKeys(units: readonly KnownUnit[], homeHalls: number): string[] {
  const halls = Array.from({ length: homeHalls }, (_, i) => `th-${i + 1}`);
  const heroes = units
    .filter((u) => u.group === "hero" || u.group === "pet")
    .map((u) => artKeyForUnit(u.name, u.group));
  const leagues = ["bronze", "silver", "gold", "crystal", "master", "champion", "titan"].flatMap(
    (tier) => [1, 2, 3].map((d) => `league-${tier}-${d}`),
  );
  return [...halls, ...heroes, ...leagues, "league-legend"];
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
  const kit = args.find((a) => !a.startsWith("--"));
  if (!kit) {
    console.error('Usage: npm run game-art -- "<unzipped fan kit folder>" [--dry-run]');
    process.exit(1);
  }

  const units: KnownUnit[] = (unitsFile.units as KnownUnit[]).map((u) => ({
    name: u.name,
    group: u.group,
    village: u.village,
  }));

  const files = await walk(kit);
  const chosen = new Map<string, { path: string; bytes: number }>();
  const unused: string[] = [];

  for (const path of files) {
    const rel = relative(kit, path);
    if (LOGO.test(rel)) {
      unused.push(rel);
      continue;
    }
    const key = matchArtKey(rel, units);
    if (!key) {
      unused.push(rel);
      continue;
    }
    const { size: bytes } = await stat(path);
    const current = chosen.get(key);
    if (!current || bytes > current.bytes) chosen.set(key, { path, bytes });
  }

  const keys = [...chosen.keys()].sort();
  console.log(`${files.length} images in the kit, ${keys.length} matched a key.\n`);
  for (const key of keys) {
    console.log(`  ${key.padEnd(34)} ← ${relative(kit, chosen.get(key)!.path)}`);
  }

  const missing = wantedKeys(units, unitsFile.source.homeHalls).filter((k) => !chosen.has(k));
  if (missing.length) {
    console.log(`\nNot found in this kit (these keep their drawn fallback):`);
    console.log(`  ${missing.join(", ")}`);
  }
  console.log(`\n${unused.length} images unused.`);

  if (dryRun) {
    console.log("\n--dry-run: nothing written.");
    return;
  }

  const { default: sharp } = await import("sharp");

  // Start clean, so a key the new kit no longer has does not linger as a file
  // the manifest has stopped listing. Only the art folders: README.md stays.
  const existing = await readdir(OUT_DIR, { withFileTypes: true }).catch(() => []);
  for (const entry of existing) {
    if (entry.isDirectory()) await rm(join(OUT_DIR, entry.name), { recursive: true, force: true });
  }

  const kitName = kit.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? kit;
  const manifest: ArtManifest = {
    source: { fanKit: kitName, generatedAt: new Date().toISOString().slice(0, 10) },
    files: {},
  };

  for (const key of keys) {
    const size = key.startsWith("th-") ? 160 : 128;
    const folder = folderFor(key);
    await mkdir(join(OUT_DIR, folder), { recursive: true });
    const out = join(OUT_DIR, folder, `${key}.webp`);
    await sharp(chosen.get(key)!.path)
      .trim()
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 82 })
      .toFile(out);
    manifest.files[key] = { src: `/game/${folder}/${key}.webp`, width: size, height: size };
  }

  await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nWrote ${keys.length} files to public/game/ and the manifest.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
