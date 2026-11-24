# Game art

Pictures of Town Halls, heroes, pets, troops, spells, leagues, and (since the
2026-11 asset zips) buildings and traps: defences, resources, army buildings,
walls, the Builder's Hut, Laboratory and Pet House. The product shows them on
tiles, the war board, base details, the upgrade tracker and the builder slots. **Every one is optional.**
Without them, each place draws its own fallback (a "TH 17" chip, a tinted
shield), and a fresh clone has none.

## Where the art comes from, and the rules

Art may come from **only two sources**:

1. **Supercell's official Fan Kit**, from <https://fankit.supercell.com/>.
2. **Images the official API returns**, from `api-assets.clashofclans.com`
   (clan badges). These are not stored here.

Supercell's [Fan Content Policy](https://supercell.com/en/fan-content-policy/)
allows this for a free, non-commercial fan tool. The notice in
`src/app/layout.tsx` must stay. The rules that follow from the policy:

- **Do not modify the art.** You may resize it and change its format, which is
  all `scripts/game-art.ts` does. Do not recolour, crop, cut out or combine it.
- **Do not use logos, wordmarks or Supercell fonts.** The script skips any file
  whose name says "logo", "wordmark" or "font".
- **No fee of any kind** anywhere in the product (T0.12, T9.8).

## Adding or refreshing the art

1. Download the Clash of Clans Fan Kit and unzip it.
2. Preview what will be matched without writing anything:

   ```
   npm run game-art -- "C:/path/to/unzipped kit" --dry-run
   ```

   The output lists:
   - each key and the file it will use, including buildings and traps
     (`building-cannon`, `builder-building-roaster`, `trap-giant-bomb`) from
     files such as `Building_HV_Cannon_level_21`, where the highest level
     render wins
   - the Town Halls, heroes, pets and leagues the kit lacks, which keep their
     fallback
   - how many files went unused

3. Run it for real by dropping `--dry-run`. This writes
   `public/game/<family>/<key>.webp` (144px for Town Halls, 128px for leagues,
   104px for the rest: twice the largest each is drawn, at webp quality 72, so
   the whole set stays around 600 KB)
   and rewrites `src/data/game/art-manifest.json`, the list the app reads.
4. Commit the webp files and the manifest together. The build needs nothing
   else: no kit, no network, no script.

### A partial kit: `--add`

Supercell also posts a handful of new renders with an update (the
`Assets 2026-11-23.zip` kind) rather than a whole kit. Run those with `--add`:

```
npm run game-art -- "C:/path/to/unzipped assets" --add --dry-run
npm run game-art -- "C:/path/to/unzipped assets" --add
```

`--add` keeps every file and manifest entry already here and writes only keys
the manifest does not have. Without it the run starts clean, which on a partial
kit would delete every picture the zip does not contain. **Look at each new
picture before committing** — the dry run names the file each key will use.

The script leaves out, and says so:

- a **sheet** — a file more than 1.8 times wider than tall (or the reverse),
  such as two states of a building side by side. Fitted into a square without
  cropping it is two specks, and cropping is not allowed.
- a building the game data does not have yet (TH19's Spiky Tower, Firecracker
  Tower and Guardian Shrine until coc.py adds them). Run `--add` again on the
  same files after `npm run game-data` brings them in.
- anything whose name it cannot tie to one item (`B.O.T.O_hut`): never a guess.

## When a file matches the wrong thing, or nothing

The Fan Kit's filenames change between releases. The patterns that read them
are all in `scripts/game-art.map.ts`, with tests in
`scripts/game-art.test.ts`. Fix the pattern and run the script again. Don't
rename or move files here by hand: the manifest is what the app trusts, and only
the script writes it.

## Scenes (`public/scenes/`)

The blurred pictures behind the landing hero, the sign-in screen and Home's
welcome banner (`components/game/scene-backdrop.tsx`). They live outside
`public/game/` because `npm run game-art` empties the art folders on every
run without `--add`. Same rules: Fan Kit art, resized and re-encoded to webp and nothing else.
The blur and the dimming are CSS, applied when the page is drawn.

- `skeleton-kingdom.webp` — the kit's `SkeletonKingdom_withCharacters.jpg`
- `crystal-cave.webp` — a Fan Kit key-art scene (crystal cavern)
- `ghost-army.webp` — Halloween key art of the ghost army (a spectral Warden,
  Queen and King, balloons, a golem), trimmed of the screenshot strip along its
  top and resized to 1200px wide; behind each page's summary card
