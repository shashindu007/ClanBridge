# Upgrade Tracker Plan — make the village export feature work like Clash Ninja

This file explains, in simple English, how to grow ClanBridge's JSON import
feature (the in-game "village export" paste) into a real upgrade tracker like
the one on [clash.ninja](https://www.clash.ninja). It also explains how to do
it **without filling the free Supabase database (500 MB limit, no Pro plan)**.

Read it top to bottom once. Then build phase by phase. Each phase is useful on
its own, so you can stop after any phase and still have something good.

## Status (2026-11-15)

| Phase | State | Where |
|---|---|---|
| A — cost and time data | **Done** | `src/data/game/upgrade-costs.json`, `costs.ts` |
| B — "Upgrades left" with totals | **Done** | `src/services/upgrades.ts`, `upgrade-time.ts` |
| C — Start / track upgrades | **Done** | migration 079, `tracker-actions.ts` |
| D — push when an upgrade finishes | **Done** | `scripts/sync/upgrade-reminders.ts` |
| E — API confirms hero / lab levels | **Done** | `confirmedByApi()` in `src/services/village-overlay.ts` |

IMPLEMENTATION.md, Phase 11D, has the task list. What changed from the plan below
while building it:

- **Subjects are stored by name, and `to_level` is not stored** (it is always
  `from_level + 1`). A saved export keeps names, not ids, so names are the key
  that matches it.
- **Finished upgrades are applied when the page is read**, by a pure overlay
  (`services/village-overlay.ts`), and folded into the export on the member's
  next write — in one database transaction, guarded by a revision number so two
  open tabs cannot level a building twice. No background job writes the export.
- **Walls and equipment get "Mark upgraded"**, not a timer: they are instant in
  the game and never hold a builder.
- **Merges and missing buildings come from the game data itself**
  (`merge_requirement`, the halls' `unlocks`), not a hand-kept list.
- **The push writes no notification-feed row**, so the feed cannot grow by one
  row per upgrade per member.

---

## 1. How Clash Ninja works (the idea we are copying)

Clash Ninja is an upgrade tracker website for Clash of Clans. This is its flow:

1. **Import once.** The player opens the game, goes to
   *Settings → More Settings → Data Export*, copies the JSON, and uploads it on
   Clash Ninja. The site reads the JSON and instantly knows every building,
   wall, trap, hero, troop and running upgrade timer. No manual typing.
2. **Track upgrades.** The site shows the player's builders and lab. When the
   player starts an upgrade in the game, they tap the same upgrade on the site.
   The site knows the upgrade **cost** and **duration** for every level (this
   is static game data, not from the player), so it starts a countdown.
3. **Show what is left.** For the player's current Town Hall, the site lists
   every upgrade still remaining, with its cost and time, and totals like
   "time left to max this Town Hall".
4. **Plan.** A timeline planner shows which builder finishes when, so the
   player can plan what to start next and keep builders busy.
5. **Notify.** Push notifications fire when an upgrade countdown finishes.
6. **Stay fresh.** Things the official Clash of Clans API can see (Town Hall
   level, hero levels, troop/spell levels) get confirmed automatically.
   Things the API cannot see (buildings, walls, traps) are updated by the
   player tapping upgrades done, or by pasting a fresh export now and then.

The important insight: **Clash Ninja stores almost nothing per player.** The
expensive data (costs, times, level caps for every building at every level) is
*game data* — the same for everybody — shipped with the site itself. Per player
it only stores current levels and a few active timers. We will do the same,
which is exactly what keeps us inside 500 MB.

---

## 2. What ClanBridge already has (more than you may think)

The hard parts of step 1 are already built (Phase 11B + migration 076):

| Already built | Where |
|---|---|
| Parse the in-game export JSON, reject bad pastes with friendly errors | `src/integration/village-export.ts` |
| Map raw Supercell ids to names, and strip base layout/positions | `src/data/game/` + `mapVillageExport()` |
| Level caps per Town Hall ("max level for YOUR TH") | `src/data/game/buildings.json`, `units.json` |
| Save one export per base, owner-only, soft delete, re-upload replaces | `supabase/migrations/076_village_exports.sql`, `src/repositories/village-exports.ts` |
| Show buildings with pictures, wall breakdown, running upgrade timers, free builders | `src/components/village-export-view.tsx`, `src/services/village.ts` |
| Daily API sync of hero/troop/spell levels | `scripts/sync/players.ts`, `player_progress` table |
| Web push notifications (already used for announcements, wars) | `src/lib/push.ts` |

So ClanBridge today = **Clash Ninja's import step, done well**. What it does
NOT do yet is the *tracker* part: it is a snapshot viewer. The timers it shows
are only the ones that were running when the export was taken. After they run
out, the page goes quiet until the player pastes a new export.

---

## 3. The gaps (ClanBridge vs Clash Ninja)

| # | Clash Ninja has | ClanBridge today | Hard part |
|---|---|---|---|
| G1 | Upgrade **cost + duration** for every building/unit level | Nothing — only level caps | New static game data |
| G2 | "Upgrades remaining for your TH" list, with totals (gold/elixir/time to max) | Shows levels vs cap, but no costs, and cannot say "you are missing a cannon" | Needs G1 + building counts per TH |
| G3 | Player taps "I started this upgrade" → live countdown | Only timers that were inside the pasted export | New small table + UI |
| G4 | Builder / lab timeline planner | Shows free builders only | Pure UI on top of G3 |
| G5 | Push notification when an upgrade finishes | Push exists, but nothing fires for upgrades | Reuse push + a scheduled check |
| G6 | API auto-confirms hero/lab levels | Daily sync already stores them, but the export page ignores them | Just wiring, data exists |

---

## 4. The storage rule that makes 500 MB enough

**Rule: game facts that are the same for every player live in the repo as JSON
files. The database only stores what is different per player.**

- Upgrade costs and times for every level of every building: this is a few
  hundred KB of JSON. It goes in `src/data/game/` **as files in the repo**,
  exactly like `buildings.json` does today. Database cost: **0 bytes.**
- Per player, the database keeps:
  - one `village_exports` row (already exists) — the mapped village is roughly
    10–40 KB of jsonb per base;
  - a handful of `tracked_upgrades` rows (new, Phase C) — one row per busy
    builder/lab slot, so at most ~8 tiny rows per base, under 1 KB total.

Rough math: even with 300 member bases, that is 300 × ~40 KB ≈ **12 MB**, plus
noise. The whole tracker fits in a few percent of the free tier. The things
that would blow the budget — and that we therefore **never do** — are listed in
section 7.

---

## 5. The build plan, phase by phase

### Phase A — Upgrade cost and time data (the foundation)

Goal: for any building or unit, at any level, know: upgrade cost, which
resource (gold / elixir / dark elixir), and upgrade duration.

1. Extend `scripts/game-data.ts` (the existing generator — see
   `src/data/game/README.md` for how it is pinned and refreshed) to also pull
   cost and time per level. The same two pinned sources it already uses carry
   this data (coc.py's `static_data.json` has build costs and times), and the
   MIT-licensed [clash-of-clans-data](https://github.com/chiefpansancolt/clash-of-clans-data)
   repo is a cross-check. Keep the existing rule: the script refuses to write
   if sources disagree.
2. Write the result to a new generated file, e.g.
   `src/data/game/upgrade-costs.json`, one entry per line like the others, so
   a game update shows up as a readable diff.
3. Add typed lookups in `src/data/game/index.ts`:
   `upgradeCost(buildingId, toLevel)` → `{ resource, amount, seconds }` or
   `null` when the data is behind the game.
4. Follow the existing "when the data is behind" rule: a missing cost never
   breaks a page — the UI just shows the upgrade without a price, the same way
   `capKnown: false` already works.
5. While in the generator, also produce **building counts per Town Hall**
   ("a TH13 has 7 cannons"). The README lists this as a known gap and says
   coc.py's Town Hall `unlocks` lists have the raw material. Mind merged
   buildings (Multi-Archer Tower, Ricochet Cannon) consuming their sources —
   that is why it was left out before, so handle it, don't skip it.

Database changes: **none.** This phase is repo files only.

### Phase B — "What's left" view (Clash Ninja's remaining-upgrades list)

Goal: on the Base details page, next to the current export view, show a list
of every remaining upgrade for the player's Town Hall, each with cost and
time, plus totals.

1. New pure functions in `src/services/village.ts` (keep them presentational
   and testable like the rest of that file):
   - `remainingUpgrades(village)` — walk the saved `ExportedVillage`, compare
     each building's levels against its cap, and attach cost/time from
     Phase A. Include buildings the player has not built yet (Phase A step 5
     tells us how many they should have).
   - `remainingTotals(remaining)` — sum per resource and total time, split
     builder queue vs lab, home vs builder base. This gives the
     "time to max your TH" headline number.
2. New section in the export view (or a sibling component,
   `src/components/remaining-upgrades.tsx`): grouped like the existing
   building filter (Defenses / Traps / Resources / Army), each row shows the
   building picture, current → next level, cost with resource icon, and
   duration. A summary card on top with the totals.
3. Everything is computed on request from the one saved jsonb row + repo
   JSON. **Nothing new is stored.**

Database changes: **none.**

### Phase C — Track upgrades the player starts (the actual "tracker")

Goal: the player taps an upgrade in the remaining list → "I started this in
the game" → ClanBridge runs a countdown, shows which builders are busy, and
marks the level up when it finishes.

1. New migration, `tracked_upgrades`:
   - columns: `id`, `player_id` (FK players), `village` ('home'/'builder'),
     `subject` (the building/unit export id), `from_level`, `to_level`,
     `slot` ('builder' / 'lab' / 'pet-house' / 'smithy'), `started_at`,
     `ends_at`, `completed_at`, `created_at`, `deleted_at`.
   - `ends_at` is computed on the server from Phase A's duration when the row
     is inserted (apply any builder boost the player selects, like Clash
     Ninja's Season Boost option — store the chosen reduction too so edits
     re-compute honestly).
   - RLS: copy migration 076's pattern exactly — owner-only through
     `auth_owned_player_ids()`, plain policies, soft delete. Leaders never
     see it. This is again R11 data: a person supplied it.
   - Rows are tiny and few (max ≈ builders + lab + pets + smithy ≈ 9 per
     base). When an upgrade completes, the row is kept only until the fact is
     folded into the stored village (step 3), then soft-deleted; a cleanup in
     the sync job hard-deletes soft-deleted rows older than ~30 days so the
     table can never grow without limit.
2. UI: in the remaining-upgrades list, each row gets a "Start" action (and a
   started row gets "Cancel" / "Finish early", because players use books and
   hammers). A new "Builders" strip at the top shows each slot with its
   countdown — this is G4's planner in its simplest form: slots sorted by
   `ends_at` is already "who finishes next".
3. When a tracked upgrade's `ends_at` passes (or the player taps "Finish"),
   update the saved `village_exports.village` jsonb: move one instance of
   that building from `from_level` to `to_level`. Do this on the server in
   the same action/page load, not with a background job — the snapshot stays
   one row, it just stops going stale. The page should label it honestly:
   "from your export of {date}, plus {n} upgrades you tracked here".
4. A fresh export paste **replaces everything** (already an upsert) and
   soft-deletes any tracked rows it contradicts. Re-import is always the
   reset button, exactly like Clash Ninja.

Database cost: a few KB per active base. Negligible.

### Phase D — Push notification when an upgrade finishes

Goal: "Your Eagle Artillery is done" on the phone, like Clash Ninja.

1. Add a `NotificationKind` (e.g. `'upgrade_complete'`) in `src/lib/push.ts`
   and a target rule in `push_targets()` — this one goes **only to the
   owner**, never the clan.
2. The existing scheduled sync (GitHub workflow, already runs on a schedule)
   gets a small step: select tracked rows where `ends_at < now()` and
   `completed_at is null`, mark them complete, fold them into the jsonb
   (Phase C step 3), and send one push each. Use the `tag` collapse key so a
   phone never stacks duplicates.
3. Accept the same honesty the sync heartbeat already accepts: the schedule
   is best-effort, so the notification may be minutes late. The in-game
   notification is the precise one; ours is the reminder.

Database changes: none beyond Phase C.

### Phase E — Let the API confirm what it can see (Clash Ninja's auto-sync)

Goal: things the official API exposes should never need manual ticking.

1. The daily players sync already snapshots hero, troop and spell levels into
   `player_progress`. When a tracked upgrade's subject is a hero/troop/spell
   and the newest API reading shows the target level reached, auto-complete
   the tracked row (and skip the push, or send it as "confirmed").
2. Same for Town Hall level: if the API says TH went up, re-compute caps.
3. Buildings, walls and traps stay manual + re-import — the API simply does
   not expose them. Say so in the UI ("the API can't see buildings; paste a
   fresh export to resync them") so members understand why.

Database changes: **none** — this reads data the sync already stores. Keep
R11: the API reading *confirms* a tracked row; it is never merged into the
export as if the member had supplied it without the code saying which is which.

---

## 6. Suggested order and size

| Phase | Depends on | Rough size | Worth shipping alone? |
|---|---|---|---|
| A — cost/time game data | — | generator work + data review | Yes (enables everything) |
| B — remaining upgrades + totals | A | 1 service + 1 component + tests | **Yes — biggest visible win** |
| C — start/track upgrades | A, B | 1 migration + actions + UI | Yes |
| D — push on finish | C | small | Nice-to-have |
| E — API auto-confirm | C | small | Nice-to-have |

If you only do A + B, members already get the Clash Ninja experience people
actually come for: paste once, see everything left to max with costs, times
and totals.

---

## 7. Storage: what we must NOT do (this is how 500 MB stays enough)

1. **Never store the raw export text.** Already a hard rule (076): it carries
   base coordinates. Keep storing only the mapped village.
2. **Never keep export history.** One export per base, upsert on re-paste
   (already how it works). History would multiply storage by every re-paste
   and answers no question the tracker asks.
3. **Never put game data (costs, times, caps) in the database.** It is the
   same for every player — it belongs in the repo, cached by the CDN for
   free.
4. **Never store one database row per building.** A TH17 base has hundreds of
   walls alone. The per-level counts inside one jsonb row (today's shape) is
   the cheap shape; keep it.
5. **No new images in Supabase Storage.** Building art already has its
   pipeline (`art-manifest.json`); cost/resource icons are a handful of
   static assets in `public/`.
6. **Cleanup is part of the feature.** Phase C's hard-delete of old
   soft-deleted tracked rows ships with the table, not later.
7. **Check reality, don't guess:** the Supabase dashboard → Database →
   Usage shows real size. `select pg_size_pretty(pg_total_relation_size('village_exports'));`
   in the SQL editor answers it exactly. Nothing in this plan should move
   that number by more than a few MB; if it does, something broke rule 2 or 4.

Also remember the real reason this project exists (README): CWL data is
irreplaceable; everything else is secondary. The tracker must never crowd the
database the backups protect — which is exactly why every phase above puts the
heavy data in the repo, not in Postgres.

---

## 8. Honest differences that will remain (set expectations)

- **Clash Ninja has an app + instant pushes.** Ours ride the existing
  scheduled workflow, so "upgrade done" pushes can be late. Fine for a
  reminder; say so in the UI.
- **Clash Ninja supports manual level entry** for people who won't paste the
  export. Skip that: the paste is one minute of work, manual entry is a big
  grid of inputs to build and a big source of wrong data.
- **Privacy stays stricter than Clash Ninja.** Exports and tracked upgrades
  remain owner-only (076's rule). Clash Ninja has public profile sharing; if
  members ever want that, it is a separate decision, not part of this plan.
- **Game updates need a data refresh.** After a Supercell update, run
  `npm run game-data` (same routine the README already describes). Until
  then, new levels show without prices — never wrong prices.
