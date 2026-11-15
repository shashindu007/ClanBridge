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
| `buildings.json` | Buildings and traps: export id, type, cap at every hall level, Town Hall weapon levels, how many each hall allows (`counts`), and what a merged building consumes (`merge`) | coc.py `static_data.json` |
| `upgrade-costs.json` | The price and duration of reaching every level of every building, trap, unit, piece of equipment and the TH weapon | both (see below) |
| `index.ts` | Typed lookups and `resolveUnit()` — browser-safe | — |
| `costs.ts` | `upgradeStep()` over `upgrade-costs.json` — **server only**, so the 66 KB table never ships to the browser | — |

## Prices (T11D.1)

**One rule for every row: `levels[L - 1]` is the price of REACHING level L.** The
sources disagree — coc.py prices buildings as the cost of reaching a level, and
both sources price units as the cost of *leaving* one — and the generator is where
that is settled, so no caller has to know.

| What | Source | Note |
|---|---|---|
| Buildings, traps, walls, TH weapon | coc.py `build_cost` / `build_time` | Walls carry `alt` / `altFrom`: payable in elixir from level 5 |
| Home troops, spells, sieges, heroes, pets | clashofclans.js `upgrade.cost` / `time` | Newer (Barbarian King to 110); coc.py fills a gap |
| Builder Base troops and heroes, guardians | coc.py `upgrade_cost` / `upgrade_time` | Indexed by troop level. A late troop STARTS high (Hog Glider at 15), so its lower levels have no price, correctly |
| Equipment | clashofclans.js `upgrade.resources` | Ores (shiny, glowy, starry); instant |
| Super troops | — | Their level follows the base troop |

A unit's level 1 is never priced: the building that unlocks it gives it. A new
resource string stops the run (`resourceOf()`), so a game update cannot slip one
in. Price disagreements between the sources are counted and printed, not fatal —
coc.py is known to lag.

**Counts** come from adding up the Town Hall's and Builder Hall's `unlocks`.
**Merges** come from `merge_requirement` (Ricochet Cannon = 2 × Cannon at 21, and
so on); the Eagle Artillery, which the TH17 Town Hall swallows, drops out of the
counts from TH17.

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

- **Trap counts.** The halls' `unlocks` list buildings, not traps, so "you have
  not built a Giga Bomb" cannot be said. Traps the export contains are priced.
- **Lookups are by name** (`buildingByName`, `upgradeStep`), because a saved
  export keeps names rather than ids. A building Supercell renames would lose its
  caps and its prices at the same moment, and the next `npm run game-data` fixes
  both.
