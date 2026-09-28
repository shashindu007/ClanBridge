# Game art

Pictures of Town Halls, heroes, pets, troops, spells and leagues. The product
shows them on tiles, the war board and base details. **Every one is optional.**
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
   - each key and the file it will use
   - the Town Halls, heroes, pets and leagues the kit lacks, which keep their
     fallback
   - how many files went unused

3. Run it for real by dropping `--dry-run`. This writes
   `public/game/<family>/<key>.webp` (160px for Town Halls, 128px for the rest)
   and rewrites `src/data/game/art-manifest.json`, the list the app reads.
4. Commit the webp files and the manifest together. The build needs nothing
   else: no kit, no network, no script.

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
run. Same rules: Fan Kit art, resized and re-encoded to webp and nothing else.
The blur and the dimming are CSS, applied when the page is drawn.

- `skeleton-kingdom.webp` — the kit's `SkeletonKingdom_withCharacters.jpg`
- `crystal-cave.webp` — a Fan Kit key-art scene (crystal cavern)
- `halloween-charge.webp` — Halloween key art (barbarians charging under a full
  moon), resized to 1600px wide; behind each page's summary card
