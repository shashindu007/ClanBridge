# Game data

`units.json` and `buildings.json` are **generated**. Do not edit them by hand.

## Why this folder exists

Phase 11B was first planned with no game data, because the API's `maxLevel` was
believed to be the cap for the player's Town Hall. It is not. `fixtures/player.json`
is a TH17 account whose Barbarian King reads `100/110`, and 110 is the game's
ceiling. Answering "how far along is this base **for its Town Hall**", which is the
question clash.ninja answers, needs a cap at every hall level. That is game data,
and this folder is where it is kept.

| File | Holds | From |
|---|---|---|
| `units.json` | Heroes, equipment, pets, troops, super troops, sieges, spells, guardians, Builder Base units. Each has its group, its export id, and its cap at every hall level. | clashofclans.js `raw.json`; guardians from coc.py |
| `buildings.json` | Buildings and traps: export id, type, cap at every hall level, Town Hall weapon levels | coc.py `static_data.json` |
| `index.ts` | Typed lookups and `resolveUnit()` | — |

Both sources are MIT-licensed and derived from the game's own files. Neither
contains artwork.

## Refreshing after a game update

1. Bump `CLASHOFCLANS_JS_VERSION` and/or `COC_PY_COMMIT` in `scripts/game-data.ts`
   once those projects have published the update.
2. `npm run game-data`
3. Read the diff. There is one entry per line, so a change shows up as the units
   it touched.
4. `npx vitest run src/data` checks that no unit on the real TH17 fixture sits above
   its cap. Refresh the fixture too if it is old (`npm run fixtures:capture`).
5. Commit the script change and both JSON files together.

The script refuses to write anything if the two sources disagree about any
unit's export id.

## When the data is behind the game

Nothing breaks. `resolveUnit()` falls back to the API's game maximum and sets
`capKnown: false` in three cases:

- the unit is newer than the data
- the hall level is unknown
- the player is **above** the data's cap, which can only mean the data is stale

The page marks those units instead of showing a percentage it cannot stand behind.

Stored snapshots (`player_progress`, migration 036) keep the cap that was applied
**at capture time**, so refreshing this data never re-scores history.

## Known gaps

- **Building counts per Town Hall** ("you should have 7 cannons") are not
  generated. The paste view shows the buildings the export contains, at their
  level against the Town Hall cap, but cannot yet say that one is missing.
  coc.py's Town Hall `unlocks` lists have the raw material. Merged buildings
  (Multi-Archer Tower, Ricochet Cannon) consume their sources, which is why this
  was left out rather than half-done.
