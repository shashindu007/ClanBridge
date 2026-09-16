# ClanBridge — Implementation Guide

> **Keep this file in the repository root as `IMPLEMENTATION.md`.**
> If you are using an AI coding assistant, point it at this file at the start of every session. Section 2 exists specifically to stop the assistant making the mistakes it reliably makes.

| | |
|---|---|
| Project | ClanBridge — Clash of Clans clan management platform |
| Type | Solo build, no deadline |
| Clans | 3 clans, one leader |
| Hosting budget | Zero |
| Companion docs | `ClanBridge_Proposal.pdf`, `ClanBridge_Architecture.pdf` |

---

## 0. Where the build actually is

The checkboxes below are the ledger. A ticked box means the code exists, the tests
pass, and `npm run typecheck` and `npm run lint` are clean — not that it has been
run against the live game.

**Done:** **Phase 2 entire** · Phase 1 entire · Phase 3 entire · **Phase 3B entire** ·
T4.1–T4.8 · **Phase 4B entire** · **Phase 5 entire** ·
**Phase 6 entire** · **Phase 7 entire** · **Phase 8 entire** ·
**Phase 9 except T9.4** — T9.1, T9.2, T9.5, T9.6, T9.7, T9.8, T9.9 done; T9.3
and T9.10 done apart from the parts that wait on a deployment ·
**Phase 10 entire** — sign-out, password sign-in, the compulsory setup step, and
four auth-adjacent security findings ·
**Phase 11 entire** — a member's own villages, in one place, with a report each ·
**Phase 11B entire** — Base details: progress against Town Hall caps, and a
view-only paste of the in-game village export ·
**Phase 11C entire** — a base's CWL record from every clan in the family.

**Every phase in this document is now complete except T9.4 (restore test) and
the deployment-side half of T9.3.** Both need something outside the codebase: a
scratch Supabase project to restore into, and a Vercel deployment to inspect.
**Phase 11B is built, and it corrected its own plan:** the API's `maxLevel` is the
game's ceiling, not the Town Hall's cap, so the block now carries generated game
data it had originally rejected. Its heading explains.
**Phase 11C is the one deliberate R3 exception in the schema:** CWL season totals
are readable family-wide, through one definer function that returns totals only.

**Phase 11 came from the product being unable to say something the schema had
always known.** `Architecture.md` §7.1 has claimed since the first draft that "a
member may own more than one player account, and accounts may sit in different
clans" — and `players.user_id` has accepted several tags since 001, and
`link_verified_player()` has written them since T3.3. So a member with two
villages already HAD two linked rows. What they did not have was any page that
listed them, any way to tell two near-identically-named bases apart, or any link
to `/verify` once their account was approved.

**The worse half was a write whose result the writer could not read.** `players`
had exactly one SELECT policy, `clan_id in (select auth_clan_ids())`. A member
approved into clan A who verified a second village sitting in clan B had that
row's `user_id` set to their own id by a definer function — and was then forbidden
to read it. They proved ownership with an in-game token and the outcome was
invisible to them. That is the same defect class as the null-`clan_id` audit row
this document records under the definer-function rule: writing rows nobody can
read is worse than not writing them. Migration 031 closes it with a second,
owner-filtered policy, and its header carries the R3 argument at length because
the unfiltered axis is clan and the next reader will flag the file.

**A second bug fell out of looking.** `link_verified_player()` rewrote
`users.requested_clan_id` unconditionally, which ran exactly once while an account
had one base. Adding a second re-routed a still-pending applicant out of the queue
of the leader who had already been asked, silently, and redressed an approved
account as an applicant in a clan it was never approved into. 032 fixes it
forward with two clauses on one statement; the tests were confirmed to have teeth
by building a harness without 032 and watching the old behaviour appear.

**What did NOT change: who can see a clan's data.** 031 widens `players` and
nothing else. `member_snapshots`, `wars`, `cwl_*`, `war_*`, `clans` and
`clan_roles` all keep their clan filter, so a village in a clan the member holds
no role in is readable as a tag, a name and a town hall level — and not even the
clan's NAME. That is why `/account/bases/[tag]` has an honest degraded state
instead of six panels each saying "no data", and the degraded copy cannot name the
clan because the app genuinely cannot.

**One assumption in the plan turned out to be wrong, and the comments that
recorded it are corrected rather than left.** The report panels were expected to be
untestable — `vitest.config.ts` includes `.ts` only and there is no jsdom — but
`src/components/toaster.test.ts` already renders a `.tsx` component from a `.ts`
file with `renderToStaticMarkup`, and the extracted sections have no state and no
effects. There are now 22 tests over them.

**The `src/types/database.ts` note below is now three migrations further out of
date, and the reason it type-checks anyway is worth stating once properly:**
`src/lib/supabase/server.ts` and `client.ts` call `createServerClient` /
`createBrowserClient` with **no `Database` generic**, and nothing imports the
generated file except its own generator. So it is not load-bearing today, which is
a reason to regenerate it rather than a reason to relax.

**The line that used to close this paragraph — "Phase 8 is placeholders that name
their own task ID" — was wrong, and sat three lines under the sentence declaring
Phase 8 complete.** It is corrected here because it was not only a doc error: the
dashboard carried the same claim in a "Not built yet" panel, three sections below
a nav grid that linked to the working library. A ledger contradicting itself
inside one paragraph is how that panel survived being read.

**Phase 10 was not planned; it came from the member using the product.** He has
two accounts and could not switch between them, because there was no sign-out
anywhere in this codebase — no route, no `signOut()` call, no cookie deletion —
and with the magic link as the only door, switching would have meant an inbox
round trip each time regardless. Both halves are now fixed. Its own outstanding
items are listed at the end of the Phase 10 block: migration 030 needs applying
to the live database, and two Supabase dashboard settings need raising to match
what the app tells members.

**Phase 0 is effectively complete — 13 of 14, and the 14th was dropped by
decision, not left undone.** T0.1–T0.12 and T0.14 are all done as of
2026-08-11; only T0.13 (photographing the old logbooks) is outstanding, and it
is not going to happen — see below. This section carried a long, deserved list
of blockers through most of this project's life; today it does not need one.

**Two Phase 9 boxes are wrong in the other direction and worth correcting when
someone next touches them:** T9.2 is substantially built (`admin/page.tsx`, 310
lines; missing only the `sync_log` history and a manual trigger) and T9.5 is
effectively done (`guide/page.tsx`, 225 real lines). A ledger that overstates in
one place and understates in another is unreliable as a planning input, which is
the only reason this note exists.

**The application has now run against real data — 2026-08-09.** That sentence
replaces "nothing ever has", which was true for every previous revision of this
file and was the single most important fact in it.

What actually happened, in order: custom SMTP was configured so magic links
deliver at all (T0.14, below), the platform was claimed at `/admin`, two clans
were added, `npm run sync:clans` wrote 66 rows and did it twice with no
duplicates (R5's real done-when), and `npm run fixtures:capture` replaced all six
synthetic fixtures with real captures. `npm run sync:war` returned `notInWar` and
recorded it as `skipped`, not `failed` — R10 behaving correctly on its first
contact with the live API.

**The first real-data bug arrived immediately, and it is the reason T2.1 exists.**
The live league group reported `"season": "2026-08-03"` — a full date. Every layer
of this project assumes `'YYYY-MM'`, and `coc-schemas.ts` declares the field as a
bare `z.string()`, so the capture's validation gate passed it and the wrong shape
reached the database. `season` is the natural key of both `cwl_seasons` (written
by the sync) and `cwl_rosters` (written by the leader), so T4B.6's "one roster per
season across all three clans" would have matched nothing, every season lookup
would have returned null, and the double-booking that rule prevents would have
surfaced on CWL day one. Nothing would have thrown. Fixed at the mapper boundary
(R7) by `normaliseCwlSeason()` in `src/integration/mappers/index.ts`.

**Two clans exist, not three, by choice rather than by blocker.** `DH CWL ONLY`
and `DH v2` — and `DH v2` is a test clan, so of the three real clans only one
is in the database. Confirmed 2026-08-11: adding the remaining two is not
needed for the work currently underway and is deferred deliberately, not
forgotten. They go in the same way, at `/admin`, whenever it becomes relevant.
Anywhere this document says "three clans", read it as intent rather than
current state.

**027 is applied, and `src/types/database.ts` is current.** Both were stale as
of 2026-08-09 — this is now corrected. The generated types describe 32 tables,
including `war_members`, `war_lineups`, `war_lineup_members`,
`war_opponent_members`, and `raid_seasons` carries 027's columns
(`raids_completed`, `offensive_reward`, and the rest). Phase 7 is no longer
broken against live Supabase on this account.

**The boxes that mattered are now closed.** T0.5 and T0.9 carried a real
deadline — the first week of September, when CWL next runs — because without
T0.5 no scheduled workflow could reach the API, and a CWL week that passes
with no sync running is data that cannot be re-fetched from anywhere. Both are
done as of 2026-08-11, ahead of that date rather than against it:

- **T0.5 is done.** A production key is registered to the RoyaleAPI proxy IP,
  and `COC_API_BASE` points at `https://cocproxy.royaleapi.dev/v1`. This also
  retires a cost that was recurring rather than one-off: the dev key bound to
  a home IP had already failed once with `403 accessDenied` after a routine ISP
  reassignment, and would have kept failing on the same schedule that IP
  changes on. The proxy's IP does not move.
- **T0.9 is done.** Upstash credentials are in `.env.local`. `getRateLimiter()`
  only throws under `NODE_ENV=production`, so nothing about local development
  was ever blocked by this being empty — that reading of an earlier revision
  of this file is what left the chain stalled for longer than it needed to.
  **Functional verification is still outstanding** — see T0.9's entry below for
  why, and what a real check looks like.

**Where the build deviated from this document, deliberately:**

- **27 migrations, not 12.** 013–027 fix holes this plan did not anticipate.
  014 restored missing `service_role` grants that would have failed every sync
  job. 015 breaks the clan↔role↔leader bootstrap cycle that made a first sign-in
  impossible, which is also why T1.10's hardcoded seed was replaced by
  leader-managed clans at `/admin`. 019 adds `cwl_war_members`, the API roster
  that missed attacks are derived from — Phase 4 had nowhere to put it. 020 adds
  the clan detail the sync had been fetching and discarding hourly since T2.4.
  **024 supersedes 012**, whose number is retired rather than reused so that
  apply order stays equal to numeric order, as 009's was.
- **The same discard bug, three times, on three endpoints.** 019 found the CWL
  roster being fetched and dropped; 020 found the clan detail; **026 found the
  opposing war lineup**. Each time the API had already sent the data and the sync
  had nowhere to put it, and each time the feature that needed it — missed
  attacks, the clan dashboard, and now T6.3's "both rosters" — could not be
  built until a table existed. Worth suspecting on every remaining endpoint:
  the raid and Clan Games responses in Phase 7 carry more than their tables hold.
  **That prediction was correct, and 027 acted on it before the sync was
  written** — the first of the four caught in advance rather than archaeology.
- **`war_opponent_members` is deliberately not `players` (026).** The obvious
  shortcut is to create player rows for the opposition and reuse every existing
  join. That would put fifty strangers per war into the member directory, the
  donation report, the inactivity list, the cross-clan search and the roster
  pool — permanently, because R4 means the correction is a `deleted_at` and never
  a delete.
- **T6.4's member claim needed its own migration (025).** 024 made target
  assignment leadership-only, which is right, and left "members may claim an
  unassigned target" with no write path at all. A claim is not an assignment with
  a weaker role check: you claim only for yourself, only a base nobody else
  holds, never over what leadership assigned you, and it audits under a distinct
  action so "did the leader put me on base 7, or did I?" stays answerable.
- **The war sync runs hourly inside `sync-clans`, not every 15 minutes in its
  own workflow (T6.2).** Every-15-minutes is ~2,880 runs/month against a
  2,000-minute private-repo allowance, before `sync-clans` (~720), `sync-cwl`
  (~360) and `sync-health` (~720) are counted; the stub for `sync-war.yml` had
  already worked that out and left it unresolved. As a step it costs the marginal
  API call rather than another checkout and `npm ci`. Nothing is lost: unlike
  CWL, `/currentwar` reports the full cumulative state of the war, so a missed
  tick costs freshness on the board and never history. `sync-war.yml` remains as
  `workflow_dispatch` for the manual mid-war refresh.
- **006 shipped select policies only, and every write since has paid for it.**
  021 (announcements), 022 (`cwl_bonuses` had existed since 002 and had never
  been writable) and 023 (`push_subscriptions`, identical hole) each had to add
  the write path for a table that already existed. 023 also restates what 014
  learned: **a policy is not a grant.** Postgres checks the table privilege
  first, so a missing `grant insert` fails with "permission denied for table"
  and the policy is never evaluated at all — an error that reads like a bug in
  the route rather than a missing line in a migration.
- **Rows a member owns, with no clan, use plain policies — not definer
  functions.** 021 and 022 argued for definer functions so a write and its
  `audit_log` row cannot come apart. 023 deliberately does not, because
  `audit_log`'s read policy is `clan_id in (select auth_leader_clan_ids())` and
  `null in (...)` is never true: an audit row for a push subscription would be
  invisible to every reader forever. Writing rows nobody can read is worse than
  not writing them.
- **A season total is the last cumulative reading, not a sum of deltas.** The
  original plan for T3B.3 said to difference across the season. That undercounts:
  `donations` is cumulative since the monthly reset, so the newest reading in a
  month already *is* that month's total, and summing observed deltas measures
  only the growth the sync happened to witness. See the header of
  `src/services/members.ts` and the test named for the case.
- **T3.7 is automated**, as `test/authorisation.test.ts`, rather than being a
  manual URL-editing checklist repeated each phase.
- **Migrations are applied over the wire** (`npm run migrations:apply`) and
  `src/types/database.ts` is generated from the live schema
  (`npm run types:db`). Neither script is in the tree below.
- **CI** runs typecheck, lint and the full offline suite on every push
  (`.github/workflows/ci.yml`). It needs no secrets, because the tests use PGlite
  and `fixtures/`.

**Two Phase 6 defects found after the boxes were ticked, and fixed:**

- **The lineup page sized a war from the previous war's poll (T6.7).** It read
  `polls.find(p => p.pollType === "war_availability")` with no open check at all,
  and `pollsForClan` filters on `deleted_at` alone — so after one war the newest
  match was a poll closed days earlier, and it drove the member "poll is open"
  alert, the "N in" headline, the largest-supported-size line and the default on
  the size selector. `isOpen()` had existed since T4B.2 and this one page never
  called it. Now `openWarAvailabilityPoll()` in `services/polls.ts`, with the
  regression test the original had no way to fail.
- **An empty base field wrote target position 0 (T6.4).** The action tested
  `Number.isFinite(Number(formData.get("position")))`, and `Number("")` is 0.
  A base-0 row takes the member's one `unique (war_id, player_id)` slot while
  being invisible on the board — `enemyBoard` iterates `1..teamSize` — so the
  member reads as unassigned and cannot be assigned, with nothing saying why.
  **Nothing else in the stack checks the range**: 003 has no CHECK on
  `war_targets.target_position` and neither definer function validates it, which
  is why the fix is `parseBasePosition()` in `services/war.ts` rather than a
  duplicate of a check the database already makes. It bounds by the war's own
  `teamSize`, because base 47 in a 15v15 is the same invisible row as base 0.

**And one number the T6.2 deviation had left behind:** `STALE_AFTER_MS.war` was
45 minutes, written for the every-15-minutes schedule that T6.2 replaced with an
hourly step of `sync-clans`. The war sync therefore read as stale for the last
quarter of every hour. Now 2 hours, matching `clans`.

**The UI has a colour system as of the T3B.1 rebuild.** `globals.css` gains a
reserved status palette — `--success`, `--warning`, `--info`, each with an `-ink`
step for text and a `-tint` step for the surface it sits on — plus `--clan-1..3`
for clan identity. Every value was measured rather than chosen: WCAG contrast for
each ink on its own tint, and the three clan hues run through a colour-blindness
separation check in both modes. Three rules travel with it, and the block's own
header states them: the status colours mean one thing each and are never
decoration; a status colour is always accompanied by an icon and a word, because
`--warning` is deliberately 1.83:1 on white; and the clan hue is **derived from
the clan id** in `lib/clan-accent.ts`, never a lookup table, for the same reason
R3 forbids a hardcoded list of the three clans anywhere else.

`--accent` had been byte-identical to `--secondary` and `--muted`, which meant
every `hover:bg-accent` in the app hovered to an indistinguishable grey. It now
carries a hue, so hover became visible on the clan switcher, ghost and outline
buttons and table rows in one line.

The tints are **static values, not `color-mix()`**. The mix was tried and cannot
be made safe: Lightning CSS wraps it in `@supports` and, where unsupported,
collapses the token to its first argument — `--info-tint` became `--info` at full
strength, putting the ink on it at 1.84:1 — and a literal fallback written ahead
of it is discarded as a duplicate declaration.

**Thirty-three pages had one door, and it was the dashboard.** There was no
`[clanTag]` layout and no shared nav anywhere, so the thirteen-card "Go to" grid
on the clan dashboard was the only route into any section — open `/members` and
the way to the war board was the browser's Back button. The grid itself was flat
and unordered: four separate war pages scattered between Members, Polls and Clan
Games, with "War lineup" the name a member had to already know to find the page
where they say they are available.

The destinations now live in `lib/clan-nav.ts` as data, and three surfaces read
it — a tab strip on the rail, the dashboard grid (regrouped into four labelled
clusters), and a new "What each page is for" map on `/guide`. The one-line hint
per destination is the product's plain-language layer for somebody on their first
day, and **it existing in exactly one place is the point**: it previously lived
only in the dashboard's JSX, where a member had to already be on the dashboard to
read it, and where the "Not built yet" panel twenty lines below it had drifted
into claiming Phase 8 was unbuilt.

**The tab strip renders from `(app)/layout.tsx`, not from a `[clanTag]/layout.tsx`** —
which is where it started. Inside the rail's own sticky `<header>` it needs no
offset; a nested layout would have had to guess the rail's height, and the rail's
height is whatever its contents wrap to. It also puts both nav surfaces in one
file, so the clan switcher and the section tabs agree by construction.

**The rail had no responsive handling at all**, while `manifest.json` declares
the app `standalone` and `portrait` — a phone. Logo, clan pills, six links, a
username and a sign-out button all `flex-wrap`ped into a four-row block above
every page on a 390px screen. The secondary links now sit behind a native
`<details>` below `sm`: no client component, no hydration, and nothing to fail in
the one part of the shell that also holds the way out.

**T7.3 and T7.5 were built, tested, and rendered nowhere.** `playerRaidSummary`,
`playerGamesSummary`, `seasonsForPlayer` and `gamesForPlayer` all existed with
tests and had no caller outside those tests, while the player profile closed with
a dashed panel naming both as unbuilt. This is the same failure as the Phase 8
line above and worth stating as a class: **a panel that describes the product to
itself is a second source of truth about the product, and it goes stale the first
time nobody remembers to edit it.** Both panels are now deleted rather than
corrected — the sections they promised exist, so there is nothing left to list.

**Phase 7 caught the discard bug in advance, for the first time.** 019, 020 and
026 each found data the API had already sent and the schema had nowhere to hold,
discovered only when a feature could not be built. The note above predicted the
fourth by name; **migration 027 was written before `scripts/sync/raids.ts`
existed**, adding the five `raid_seasons` columns and the two
`raid_participants` ones the response was already carrying. `attack_limit` is
the one that mattered — a per-member, varying denominator without which "attacks
used: 5" answers nothing.

**`clan_games.settled_at` (027) exists because T7.4 breaks R5 without it.** The
end-of-period pass must update a row its own start pass inserted, and with no
marker there is no way to distinguish "still running, the value may move" from
"finished in March, never touch again". A re-run in April would write April's
lifetime achievement total into March's `end_value` — silently, because
overwriting is what the job does the rest of the time.

**Two watchdogs had never been wired, and one had been missed by its own
instruction.** `health.ts` carried "ADD TO THIS LIST WHEN A WORKFLOW IS ADDED"
naming `war`, and T6.2 shipped the war sync onto a schedule anyway: it was
unwatched for all of Phase 6 — the one job whose absence nothing else can report
going unreported. `clan-games` had no `STALE_AFTER_MS` entry either and would
have fallen to the 3-hour default against a daily job, reading stale 21 hours in
24. `test/cwl-services.test.ts` now ties the two lists together so a scheduled
job cannot be added without a threshold.

**`sync-raids.yml` was not an inert stub.** Four lines of comments with no
`name:`, `on:` or `jobs:` — a file GitHub reports as invalid in the Actions tab,
unlike the `export {}` script stubs beside it, which are valid TypeScript that
does nothing.

---

## 1. What this project is

A private web platform replacing WhatsApp messages and paper logbooks for three Clash of Clans clans.

The core problem: **Clan War League data is deleted from Supercell's API when the season ends and cannot ever be recovered.** Everything else in this project is secondary to capturing that data before it disappears.

Modules: CWL tracking, clan war planning, Raid Weekend, Clan Games, base layout library, announcements.

---

## 2. Rules that must not be broken

These are not style preferences. Each one prevents a specific failure that is expensive or impossible to undo.

### R1 — The website never calls the Clash of Clans API

Pages and route handlers read from PostgreSQL only. Only the scripts in `scripts/sync/` talk to Supercell.

If a feature seems to need a live API call during a page load, the fix is to sync more often — never to call the API from the page.

### R2 — Sync jobs run on GitHub Actions, never on Vercel

Vercel's free function timeout will kill a CWL sync partway through and leave half-written data. GitHub Actions allows six hours.

### R3 — Every query filters by clan

Three clans share one database. Every table with clan data has RLS enabled and a policy. Every service-layer query filters by clan explicitly as well.

**This is the single most common AI-generated bug in this project.** Generated code writes `select * from cwl_attacks where war_id = $1` and omits the clan check entirely. Review every query for this before merging.

### R4 — Nothing is ever deleted

No `DELETE` statements. Every table has `deleted_at timestamptz`. Every write is recorded in `audit_log`.

Deleted CWL history cannot be re-fetched from anywhere.

### R5 — Snapshots are append-only and idempotent

Sync jobs `INSERT ... ON CONFLICT DO NOTHING` against a unique constraint on natural keys. Running a job five times must change nothing after the first.

Never `UPDATE` or `DELETE` historical rows because the API returned something unexpected.

### R6 — The service key never reaches Vercel

**`SUPABASE_SERVICE_KEY` lives only in GitHub Actions secrets and your local `.env.local`.** It bypasses RLS entirely, so it is the one credential whose leak turns every access-control rule in the system into decoration. If it appears in a Vercel environment variable, the architecture has drifted.

**`COC_API_TOKEN` is the same, with one documented exception: `/api/verify` (T3.3).**

That route has to call Supercell's `verifytoken` endpoint on behalf of a member signing up, and there is no way to perform that handshake from a sync job — it is interactive by nature. So the production token is also set in Vercel, and that route alone may read it. Requests go through the RoyaleAPI proxy exactly as the sync jobs do, because Vercel has no fixed egress IP either.

The carve-out is narrow on purpose:

- **Only `/api/verify` reads it.** No page, no other route, no server component. R1 still holds — the website never *reads game data* from the API.
- **It is rate limited** to 5 attempts per user per hour (T3.3), so the route cannot be used as an open proxy.
- **The blast radius is small and known.** The Clash of Clans API is read-only: no endpoint can alter a village, remove a member, or spend currency. A leaked key means throttling or revocation, not damage to anyone's account. `proposal_idea.md` §12.1 says exactly this.

The service key has no such exception, and never will.

### R7 — Raw API shapes stay in `src/integration/`

Supercell's JSON is mapped to internal types at the boundary. Nothing above `integration/` sees a field named `attackerTag` or a timestamp like `20260729T063000.000Z`.

### R8 — The in-game player token is verified and discarded

Never stored. Never logged. Never included in an error message.

### R9 — Every sync job writes to `sync_log`

Start and finish, with status and error text. A job that fails silently during CWL costs a season of data.

### R10 — Normal API states are not errors

`notInWar`, `warEnded`, `preparation`, and a missing CWL group are ordinary conditions for most of the month. Handle each explicitly. A job that reports failure three weeks out of four trains you to ignore alerts.

### R11 — Game facts and human decisions never mix

The system holds two kinds of data, and confusing them causes permanent damage.

**Game facts** come from Supercell: attacks, stars, results, member lists. Read-only. Written only by sync jobs. No human ever edits them.

**Human decisions** exist only in your system: poll answers, who the leader selected, clan assignments, target calls, bonus awards, notes. Written only by people through the application. No sync job may ever touch them.

They live in separate tables. A sync job that writes to `cwl_rosters` or `poll_responses` is a bug. A form that writes to `cwl_attacks` is a bug.

The reason: sync jobs re-run constantly and overwrite. If a leader's roster selection lives in a table a sync job touches, a routine 2 AM job will silently erase an hour of the leader's work.

### R12 — The plan is compared to reality, never replaced by it

`cwl_rosters` is who the leader chose. The API roster is who actually played. `war_targets` is who was told to attack. `war_attacks` is who did.

Keep both. Showing the difference between them is the most useful thing this system does — it is how a leader sees who did not follow the plan.

Never overwrite a plan with the outcome.

---

## 3. Technology stack

### Application

| Concern | Package |
|---|---|
| Framework | `next@15` — App Router |
| Language | `typescript` — strict mode |
| UI | `react@19` |
| Styling | `tailwindcss@4` |
| Components | `shadcn/ui` — copied in, not installed |
| Validation | `zod` |
| Client fetching | `@tanstack/react-query` — only on interactive pages |
| Dates | `date-fns`, `date-fns-tz` |
| Script runner | `tsx` |

### Infrastructure

| Concern | Service | Free limit |
|---|---|---|
| Database | Supabase PostgreSQL | 500 MB |
| Auth | Supabase Auth — magic link | 50k MAU |
| File storage | Supabase Storage | 1 GB |
| Hosting | Vercel Hobby | Free, no card |
| Scheduled jobs | GitHub Actions | 2,000 min/month private |
| Rate limiting | Upstash Redis | 10k commands/day |
| Push | `web-push` + VAPID | Free |
| Game API | Official API via `cocproxy.royaleapi.dev` | Free |

### Do not use

| Rejected | Reason |
|---|---|
| Prisma | Heavy cold starts on serverless |
| Vercel Cron | Hobby tier allows daily only; CWL needs 2-hourly |
| Redis as data cache | The database is the cache |
| `sharp` | Compress in the browser before upload instead |
| A separate backend service | Route handlers are enough |

---

## 4. Conventions

**Files** — `kebab-case.ts`. Components `PascalCase.tsx`.

**Database** — `snake_case`, plural table names, `id uuid primary key default gen_random_uuid()`, `created_at timestamptz default now()`, `deleted_at timestamptz` on every table.

**Tags** — store with the hash: `#2PP0JCCL`. Encode to `%23` only inside `lib/tags.ts`. Uppercase on write.

**Times** — store `timestamptz`, always UTC. Convert for display only. Clash of Clans returns `20260729T063000.000Z`, which needs a custom parser in `lib/coc-time.ts`.

**Errors** — named error classes from `integration/`. Never throw bare strings.

**Migrations** — numbered SQL files in `supabase/migrations/`, never edited after being applied. Fix forward with a new file.

**Commits** — one task per commit, prefixed with the task ID: `T4.2 add cwl attack repository`.

---

## 5. Repository layout

The real tree, annotated with the task that fills each file. Files not yet written are
labelled with the task ID that creates them.

```
clanbridge/
├── IMPLEMENTATION.md  Architecture.md  proposal_idea.md  README.md
├── package.json  tsconfig.json  next.config.ts  vitest.config.ts
├── postcss.config.mjs  eslint.config.mjs  components.json
├── .env.example  .gitignore  .gitattributes
│
├── .github/workflows/
│   ├── ci.yml               typecheck · lint · vitest, every push. No secrets
│   ├── sync-clans.yml       T2.7  hourly
│   ├── sync-cwl.yml         T4.2  every 2h
│   ├── sync-health.yml      T5.8  hourly watchdog — needs no game API key
│   ├── sync-war.yml         T6.2  manual only; the schedule is a sync-clans step
│   ├── sync-raids.yml       T7.2  daily; also runs sync:clan-games (T7.4)
│   ├── sync-players.yml     T11B.6 daily — hero, troop and spell levels
│   └── backup.yml           T2.8  weekly pg_dump
│
├── fixtures/                T2.1  captured API responses, for USE_FIXTURES
│   └── clan · currentwar · cwlgroup · cwlwar · capitalraids · player .json
│
├── public/
│   ├── manifest.json        T5.3
│   ├── sw.js                T5.4  push + notificationclick. Never cache-first
│   └── icons/               T5.3  generated by scripts/make-icons.ts
│
├── scripts/                 tooling, not in the original plan
│   ├── apply-migrations.ts  applies supabase/migrations/ over the wire
│   ├── build-migration-bundle.ts  → supabase/apply-all.sql, one-paste fallback
│   ├── check-supabase.ts    connectivity and schema audit
│   ├── gen-db-types.ts      → src/types/database.ts, from the live schema
│   ├── capture-fixtures.ts  T2.1  fetch + scrub, in one step
│   ├── scrub-fixtures.ts    replaces names and tags, keeps every shape
│   ├── restore-verify.ts    T9.4  restores a dump into a scratch project and audits it
│   ├── make-icons.ts        T5.3  writes public/icons/ — no image dependency
│   └── game-data.ts         T11B.3 → src/data/game/*.json from two PINNED sources
│
├── scripts/sync/
│   ├── shared.ts            T2.5  sync_log helpers (R9) + T5.8 failure alert
│   ├── alerts.ts            T5.8  who is told, and what counts as stale
│   ├── health.ts            T5.8  the watchdog. Nothing reports its own absence
│   ├── clans.ts             T2.6 + T2.9 + T3.9
│   ├── cwl.ts               T4.1
│   ├── war.ts               T6.1
│   ├── raids.ts             T7.1
│   ├── clan-games.ts        T7.4
│   └── players.ts           T11B.5 clan members AND every owned village, daily
│
├── supabase/
│   ├── seed.sql             T1.10  superseded — clans are added at /admin (015)
│   ├── apply-all.sql        generated bundle of every migration, in order
│   └── migrations/
│       ├── 001_core.sql               T1.4   clans, users, players, clan_roles
│       ├── 002_cwl.sql                T1.5
│       ├── 003_war.sql                T1.6
│       ├── 004_features.sql           T1.7
│       ├── 005_operational.sql        T1.8   sync_log, audit_log
│       ├── 006_rls.sql                T1.9   auth_clan_ids() + policies
│       ├── 007_member_snapshots.sql   T2.9
│       ├── 008_player_left_at.sql     T3.9
│       ├── 010_polls.sql              T4B.1  (009 intentionally absent)
│       ├── 011_cwl_rosters.sql        T4B.6
│       ├── 012_war_lineups.sql        T6.8
│       │  ── beyond the original plan ─────────────────────────────────
│       ├── 013_user_status.sql        T3.8   pending / approved
│       ├── 014_service_role_grants.sql       every sync job would have failed
│       ├── 015_platform_admin.sql            breaks the clan-role-leader cycle
│       ├── 016_player_verification.sql T3.3  link_verified_player()
│       ├── 017_approval_grants_membership.sql  approve + audit, atomically
│       ├── 018_admin_may_approve_clanless.sql
│       ├── 019_cwl_war_members.sql    T4.1   API roster; misses derive from it
│       ├── 020_clan_details.sql       T3B.0  level, league, war-log visibility
│       ├── 021_announcements.sql      T5.1   audited definer functions
│       ├── 022_cwl_bonus_awards.sql   T4.7   the leader's own award order
│       ├── 023_notifications.sql      T5.5/T5.9/T5.6  push writes, prefs,
│       │                                     push_targets(). A policy is not a grant
│       ├── 024_war.sql                T6.4/T6.8  war_members, lineups,
│       │                                     assign/clear_war_target(). Supersedes 012
│       ├── 025_war_target_claim.sql   T6.4   the member claim 024 had no path for
│       ├── 026_war_opponent.sql       T6.3   the other roster, discarded until now
│       ├── 027_raid_detail.sql        T7.1/T7.4  raid rewards + attack limits,
│       │                                     clan_games.settled_at. Written BEFORE
│       │                                     the sync, unlike 019/020/026
│       ├── 028_base_layouts.sql       T8.1/T8.5  layout writes, one vote per member
│       ├── 029_layouts_storage.sql    T8.1   the layouts BUCKET. LIVE-ONLY: touches
│       │                                     `storage`, which PGlite has not, so the
│       │                                     suite cannot reach its policies
│       ├── 030_account_credentials.sql T10.1 username + password_set_at. No password
│       │                                     column, ever
│       ├── 031_own_players_policy.sql T11.1  auth_owned_player_ids() + a SELECT policy
│       │                                     on players filtered by OWNER, not clan.
│       │                                     Read its R3 argument before touching it
│       ├── 032_link_verified_player_v2.sql T11.2 the routing write, now first-tag-wins
│       │                                     and pending-only. Replaces 016's function
│       ├── 033_player_nicknames.sql   T11.3  the member's label for their own base.
│       │                                     Full unique index, not partial — ON
│       │                                     CONFLICT cannot infer a partial one
│       ├── 034_user_avatar.sql        T11.4  users.avatar_path — a PATH, not a URL
│       ├── 035_avatars_storage.sql    T11.5  the avatars BUCKET. LIVE-ONLY like 029,
│       │                                     and absent from apply-all.sql for the
│       │                                     same reason: the bundle is PHASE1 only
│       ├── 036_player_progress.sql    T11B.4 one reading a village a day, the CAP
│       │                                     stored with each level. Clan policy OR
│       │                                     owner policy; no UPDATE for anybody
│       └── 037_family_cwl_history.sql T11C.1 CWL season TOTALS from every platform
│                                             clan — the one deliberate R3 exception.
│                                             Table policies untouched
│
├── test/                    QA — runs the migrations against real Postgres (PGlite)
│   ├── pg-harness.ts        boots PGlite
│   ├── pglite-supabase.ts   supabase-js stand-in over it — no embedded selects
│   ├── migrations.test.ts
│   ├── authorisation.test.ts   T3.7, automated
│   ├── notifications.test.ts   023 — policies, prefs, push_targets authority
│   ├── push.test.ts            T5.6/T5.8 — web-push mocked; 410 vs 500, staleness
│   └── auth · verification · verify-route · platform-admin · sync-clans ·
│       sync-cwl · sync-shared · cwl-services · member-search · member-services ·
│       announcements · polls-rosters · phase4b-services · scrub-fixtures  .test.ts
│
└── src/
    ├── middleware.ts        T3.2  must sit at src/ root
    │
    ├── app/
    │   ├── layout.tsx  globals.css  page.tsx
    │   ├── (auth)/          public — login T3.1, verify T3.4
    │   ├── (app)/           requires a session
    │   │   ├── pending/     T3.8      guide/     T5.7+T9.5
    │   │   ├── search/      T3B.6     report/    T9.1
    │   │   ├── roster/      T4B.7-9, T4B.14  — cross-clan, so outside [clanTag]
    │   │   ├── [clanTag]/
    │   │   │   ├── page.tsx           T3B.1  dashboard
    │   │   │   ├── members/           T3B.2, T3B.3, T3B.5
    │   │   │   ├── player/[tag]/      T3B.4  ★ objective O4
    │   │   │   │   └── details/       T11B.10 Base details — leader and co-leader only
    │   │   │   ├── polls/             T4B.2-4
    │   │   │   ├── cwl/               T4.4, T4.5, T4B.10-13  (T4.10 dropped)
    │   │   │   ├── war/               T6.3-6.6, T6.8-6.10
    │   │   │   ├── raids/  games/     T7.3, T7.5
    │   │   │   ├── layouts/           T8.2-8.4
    │   │   │   └── notices/           T5.1
    │   │   ├── settings/notifications/  T5.5 + T5.9  device on/off, and kinds
    │   │   ├── settings/account/      T10.7  username + password, after setup
    │   │   ├── account/setup/         T10.5  compulsory, once, before the gate
    │   │   ├── account/page.tsx       T11.8  ★ your picture and your villages
    │   │   ├── account/bases/[tag]/   T11.12 the report for one of YOUR bases —
    │   │   │                                 authorised by ownership, not by clan
    │   │   ├── account/bases/[tag]/details/  T11B.10 ★ Base details, + the export paste
    │   │   ├── account/avatar/route.ts T11.10 signs the CALLER'S OWN path. No id
    │   │   │                                 parameter, so there is no IDOR
    │   │   └── admin/                 T9.2, T9.6
    │   └── api/
    │       ├── verify/route.ts            T3.3
    │       └── push/subscribe/route.ts    T5.5
    │
    ├── components/
    │   ├── push-toggle.tsx  T5.5  asks permission on a click, never on load
    │   ├── data-freshness.tsx  T4.8
    │   ├── avatar-form.tsx  T11.9   compresses in the browser, Storage before DB
    │   ├── player-report-sections.tsx  T11.11  the six panels, shared by the two
    │   │                            pages that show them (+ .test.ts, 22 cases)
    │   ├── base-details.tsx T11B.9  progress panels, shared by both details pages
    │   ├── village-export-paste.tsx  T11B.12  "use client". Parses in the tab,
    │   │                            sends nothing, saves nothing
    │   ├── village-export-view.tsx   T11B.12  what a parsed export shows
    │   └── ui/              shadcn copies land here
    │
    ├── data/game/           T11B.3  GENERATED game data — see its README.md
    │   ├── units.json  buildings.json   caps at every hall level, export ids
    │   └── index.ts         resolveUnit(), lockedUnits() — browser-safe
    │
    ├── integration/         R7 — raw API shapes stop here
    │   ├── coc-client.ts    T2.3
    │   ├── coc-schemas.ts   T2.2  zod, one per endpoint
    │   ├── village-export.ts T11B.11 the in-game export's shape — NOT an API
    │   ├── errors.ts        named error classes
    │   └── mappers/         T2.4
    │
    ├── lib/
    │   ├── supabase/        T1.11  server, client, middleware, admin
    │   ├── tags.ts          T1.12  (+ .test.ts)
    │   ├── coc-time.ts      T1.13  (+ .test.ts)
    │   ├── auth.ts          T3.5   requireRole()
    │   ├── rate-limit.ts    T3.3, T9.7
    │   ├── push.ts          T5.6   notifyClan / notifyUsers, 410 → soft delete
    │   ├── audit.ts         R4
    │   ├── gate.ts          T3.8/T10.5  the two exempt lists (+ .test.ts)
    │   ├── account.ts       T10   username + password rules (+ .test.ts)
    │   ├── nickname.ts      T11.3  base-label rules, paired with 033's constraint
    │   ├── layout-image.ts  T8.2   magic-byte sniffing, canvas resize, EXIF gone
    │   ├── avatar-image.ts  T11.7  imports those primitives, keeps its own tuning
    │   └── utils.ts         cn() for shadcn
    │
    ├── repositories/        T4.3 onward — every query filters by clan (R3)
    │   ├── account-bases.ts    T11.6  filtered by owner, not clan
    │   ├── player-report.ts    T11.11 the seven reads behind a village's report
    │   └── player-progress.ts  T11B.8 scope is { clanId } or "owner", REQUIRED
    ├── services/            derived values: missed attacks, donation deltas
    │   ├── progress.ts      T11B.7 levels against caps; "behind", never "rushed"
    │   └── village.ts       T11B.11 buildings, walls and timers from an export
    └── types/
        ├── database.ts      generated from Supabase
        ├── domain.ts        internal types (R7)
        └── village.ts       T11B.11 a parsed export. Never stored
```

Each directory that is still a placeholder carries a `README.md` naming the rules that
apply to it — `repositories/` states R3 and R4, `mappers/` states R7, `api/` maps each
planned route to its task.

---

# Phase 0 — Accounts and access

*Nothing here is code. All of it blocks later work.*

- [x] **T0.1 — Confirm war logs are public**
  All three clans, in game, Clan Settings. If private, the API returns 403 and the war module cannot work at all.

  **Verified automatically, not by eye.** The API reports `isWarLogPublic`, so
  `scripts/sync/clans.ts` warns by name on every run and migration 020 stores it.
  The live sync on 2026-08-09 printed no warning for either clan added so far —
  which is the check, and it re-runs hourly rather than being trusted once. A clan
  switched to private mid-season is caught on the next run instead of surfacing
  later as an unexplained 403 in the war module.
  **Still to confirm for the two clans not yet added** (see T0.2).

- [x] **T0.2 — Record the three clan tags**
  Write them into a scratch file. Uppercase, with the hash.

  **Superseded in the doing.** Tags are not the deliverable — rows in `clans` are,
  because `activeClans()` is what every sync job and `fixtures:capture` read
  through. They are added at `/admin` after signing in (migration 015), never
  seeded. Done on 2026-08-09: platform claimed, clans added, "Make me leader".
  **Only one of the three real clans is in the database so far** — `DH CWL ONLY`.
  `DH v2` is a test clan. The remaining two go in the same way, and T0.1 above
  needs re-checking once they do.

- [x] **T0.3 — Create a Clash of Clans developer account**
  `https://developer.clashofclans.com`. Separate from your game login. Check spam for the confirmation email.
  *If the site will not load:* try mobile data instead of WiFi, set DNS to `1.1.1.1`, try incognito. Turn off any VPN — if you register the key against a VPN IP it will fail once you disconnect.

- [x] **T0.4 — Create the development API key**
  IP address = your current public IP. Save the token in a password manager.

- [x] **T0.5 — Create the production API key**
  IP address = the RoyaleAPI proxy IP. Check the current value at `docs.royaleapi.com/proxy` before entering it.

  Done 2026-08-11 — a key registered to `45.79.218.79` (the proxy IP at the
  time; re-check `docs.royaleapi.com/proxy` before trusting this number,
  because RoyaleAPI can change it), and `COC_API_BASE` now points at
  `https://cocproxy.royaleapi.dev/v1` rather than the direct API. This resolves
  the recurring `403 accessDenied` the dev key produced on every home IP
  change — the proxy's IP is what Supercell's key sees, and it does not move
  when a Sri Lankan ISP reassigns a dynamic address. It also unblocks the
  GitHub Actions workflows: they have no fixed egress IP either, and this is
  the same fix for both.

- [x] **T0.6 — Test the key**
  ```bash
  curl -H "Authorization: Bearer $TOKEN" \
    "https://api.clashofclans.com/v1/clans/%232PP0JCCL"
  ```
  `403` means the IP does not match. `404` means the tag is wrong. The `#` must be `%23`.

  **Tested by using it**, which is a better test than curl: `npm run sync:clans`
  and `npm run fixtures:capture` both completed against the live API on
  2026-08-09. The first attempt returned `403 accessDenied` because the home IP
  had changed since the key was issued — reissuing against the current IP fixed
  it. **Expect that again.** A dev key is bound to one IP and a domestic
  connection does not keep one; this is the recurring failure the project will
  hit most often, and `scripts/capture-fixtures.ts` already explains it by status
  code when it does.

- [x] **T0.7 — Create the Supabase project**
  Region closest to Sri Lanka. Save the project URL, anon key, and service role key.

- [x] **T0.8 — Create a private GitHub repository**
  Confirmed 2026-08-11 via the repository's Settings → Danger Zone: "This
  repository is currently private."

- [x] **T0.9 — Create the Upstash Redis database**
  Save the REST URL and token.

  Done 2026-08-11 — a Regional database, region chosen close to Sri Lanka, and
  `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are in `.env.local`.
  **Functional verification against `getRateLimiter()` is still outstanding** —
  the attempt during setup used bash `VAR=value cmd` syntax in a PowerShell
  session, which PowerShell does not support (`$env:VAR = "value"; cmd` is the
  equivalent). Not blocking: `getRateLimiter()` only throws under
  `NODE_ENV=production`, which local `npm run dev` never sets, so `/api/verify`
  has been running on the in-memory limiter throughout and nothing here has
  been exercised end to end yet. Worth a real check before this is deployed.

- [x] **T0.10 — Generate VAPID keys**
  ```bash
  npx web-push generate-vapid-keys
  ```

- [x] **T0.11 — Ask the clan leader four questions**
  May a leader of clan A view clan B's data? (Recommend yes.)
  What is the rule for allocating bonus medals?
  How does a new member get an account — invite only, or open signup? (Recommend invite only.)
  When a member leaves a clan, should their history stay visible?

  Answered 2026-08-11 (the leader and the developer are the same small circle,
  which is why one round of WhatsApp settled all five at once — the fifth
  question was T4B's own assumption check, asked alongside the rest):

  1. **Yes.** All three clans are led by the same person, so this was never
     really in question — but it is now recorded rather than assumed.
  2. **No fixed rule. The leader's judgement, case by case.** This matches
     what `allocationList()` in `src/services/rosters.ts` already does — it is
     explicitly commented "Deliberately NOT a ranking function," sorts
     candidates by stars and missed attacks only to keep the evidence legible,
     and lets the leader set `bonusOrder` directly. **No code follows from this
     answer; the design already assumed it correctly.** T4B.13 stays a
     suggestion surface, never an algorithm — this file's earlier revisions
     were wrong to describe it as "an assumption nobody confirmed."
  3. **Invite only, gated on a verified in-game account the leader approves.**
     Already the built behaviour: `link_verified_player()` (016) is the only
     way `users.requested_clan_id` is ever set, and `approve_account()` (017)
     requires it — an admin cannot approve someone with no verified player
     behind their request. No code change.
  4. **Yes, history stays visible after departure.** Already built:
     `players.left_at` is set, never the row deleted (R4), and the player
     profile page renders a "left the clan" badge rather than hiding the
     player. No code change.
  5. **One family-wide pool, not three separate ones.** Confirms the
     assumption T4B's header asked to have checked before T4B.6 was built:
     the leader chooses from every available player across all three clans at
     once, deciding which clan each one plays for. Matches
     `cwl_roster_members`' constraint — one roster per player per season
     *across* the three clans — exactly. No code change.

- [x] **T0.12 — Read Supercell's Fan Content Policy**
  The platform must display a disclaimer that it is not affiliated with or endorsed by Supercell, and must not be monetised. The API key is issued for non-commercial use only. Note the exact wording required — it goes in the footer at T9.8.

  Read in full 2026-08-11. The policy's own "Insert disclaimers" clause gives
  the required text verbatim (or "a substantially similar notice"), copied
  rather than paraphrased into the footer at T9.8:

  > This material is unofficial and is not endorsed by Supercell. For more
  > information see Supercell's Fan Content Policy:
  > www.supercell.com/fan-content-policy.

  Constraints worth restating because they bound Phase 8 as much as Phase 0:
  no fee of any kind without Supercell's approval, with three named
  exceptions — ads, donations, and **coaching, which the policy explicitly
  defines to include selling base layouts.** Section 3 already commits to zero
  monetisation, so none of this changes anything currently planned; it is
  recorded so a future "what if we charged for premium layouts" idea is
  answered by this document rather than by guessing. Also binding: no
  blockchain/crypto, no leaks of unpublished game information (not a risk here
  — this platform only ever reads clan-visible, already-public data), and no
  domain name or account handle containing Supercell's trademarks (`ClanBridge`
  does not).

- [~] **T0.13 — Photograph the existing logbooks** — **DROPPED, by decision**
  ~~Before anything else, capture every page of the handwritten CWL records.~~
  The leader does not want the historical seasons carried over; the platform
  starts its history on the day it starts running. **T4.10 is dropped with it.**
  Recorded rather than deleted because O2 ("logbook eliminated") in section 5B
  still names it, and a silently missing task reads as an oversight later.
  The cost is accepted and one-way: those seasons exist nowhere else, and if the
  books are lost the decision cannot be revisited.

- [x] **T0.14 — Configure custom SMTP in Supabase Auth** — *not in the original plan*
  Supabase's built-in email sender is shared across every free project, capped at
  roughly 2–4 messages an hour, and on newer projects delivers only to addresses
  belonging to the project team.

  **This is a hard blocker for Phase 3 in production and nothing in this document
  said so.** Login is a magic link, so *every* sign-in sends an email — not only
  the first. Three clans is on the order of 100–150 members. At 2 an hour that is
  not a slow platform, it is one that does not work.

  Done with Gmail SMTP (`smtp.gmail.com:465`, an App Password, not the account
  password) — free, no domain needed, ~500/day. **Raise the email rate limit
  under Authentication → Rate Limits as well**; enabling custom SMTP does not
  raise it on its own, and that step is the one everybody misses.

  Related work this exposed, none of it built:
  - **T3.10** — `/login` cannot detect a failed delivery. `signInWithOtp` returns
    success either way, deliberately, so an attacker cannot probe which addresses
    have accounts. The "Check your email" state is therefore a dead end for the
    most common onboarding failure, and the only fix is guidance on the page.
  - **T9.11** — a member who changes their email becomes a new account, because
    Supabase keys identity by address. Their history survives and becomes
    invisible to them. `auth/callback/route.ts` already uses `ignoreDuplicates`
    so a corrected address is not overwritten; no UI ever sets one.
  - **T9.12** — platform admin cannot be transferred. `claim_platform_ownership()`
    refuses once any admin exists (015), and nothing else sets
    `is_platform_admin`, so moving it needs SQL against the live database.

---

# Phase 1 — Foundation

*Builds nothing visible. Makes everything after it fast.*

- [x] **T1.1 — Initialise the project**
  ```bash
  npx create-next-app@latest clanbridge --typescript --tailwind --app --src-dir
  ```
  Set `"strict": true` in `tsconfig.json`. Commit.

- [x] **T1.2 — Install dependencies**
  ```bash
  npm i @supabase/supabase-js @supabase/ssr zod date-fns date-fns-tz
  npm i @tanstack/react-query @upstash/ratelimit @upstash/redis web-push
  npm i -D tsx @types/web-push
  ```

- [x] **T1.3 — Environment files**
  Create `.env.local` and `.env.example`. Confirm `.env.local` is in `.gitignore` before the first commit.
  Variables: see section 8 of the architecture document.
  **Done when:** `git status` never shows `.env.local`.

- [x] **T1.4 — Migration 001: core tables**
  `clans`, `users`, `players`, `clan_roles`.
  Every table gets `id`, `created_at`, `deleted_at`.
  Unique constraint on `players(tag)`.

- [x] **T1.5 — Migration 002: CWL tables**
  `cwl_seasons`, `cwl_wars`, `cwl_attacks`, `cwl_bonuses`.
  **Critical:** unique constraint `cwl_attacks(war_id, player_id, attack_order)`. This is what makes sync idempotent (R5).

- [x] **T1.6 — Migration 003: war tables**
  `wars`, `war_targets`, `war_attacks`.
  Unique constraint `war_attacks(war_id, player_id, attack_order)`.
  Keep `war_targets` (the plan) separate from `war_attacks` (what happened). Never merge them.

- [x] **T1.7 — Migration 004: remaining tables**
  `raid_seasons`, `raid_participants`, `clan_games`, `clan_games_scores`, `base_layouts`, `announcements`, `push_subscriptions`.

- [x] **T1.8 — Migration 005: operational tables**
  `sync_log`, `audit_log`.

- [x] **T1.9 — Migration 006: RLS**
  ```sql
  create function auth_clan_ids() returns setof uuid
  language sql stable security definer as $$
    select clan_id from clan_roles where user_id = auth.uid()
  $$;
  ```
  Enable RLS on every table with clan data and write a select policy for each.
  **Done when:** with the anon key and no session, every table returns zero rows.

- [x] **T1.10 — Seed the three clans**
  Insert the three clan rows with real tags.

- [x] **T1.11 — Supabase clients**
  `lib/supabase/server.ts`, `client.ts`, `middleware.ts`, and a separate `admin.ts` using the service key — used only by `scripts/`.

- [x] **T1.12 — `lib/tags.ts`**
  `normaliseTag()` uppercase with hash; `encodeTag()` hash to `%23`. Unit test both.

- [x] **T1.13 — `lib/coc-time.ts`**
  Parse `20260729T063000.000Z` to a `Date`. Unit test it. This format breaks `new Date()` and will silently produce `Invalid Date` if you skip this.

---

# Phase 2 — API client and first sync

- [x] **T2.1 — Capture fixtures**
  Save real responses to `fixtures/`: `clan.json`, `currentwar.json`, `cwlgroup.json`, `cwlwar.json`, `capitalraids.json`, `player.json`.
  Capture a CWL fixture during an actual CWL week — that is the first week of the month only.

  **Done. All six are real**, captured 2026-08-09 and scrubbed in the same step
  (245 member names and 297 tags replaced; every number, field and array length
  untouched). `mappers.test.ts` no longer prints the SYNTHETIC banner.

  Both CWL files landed, which was luck worth recording: the capture ran on the
  9th, outside the first week, and `DH CWL ONLY` was still in a league group. The
  script tries **every** active clan for those two endpoints precisely so a season
  running in the third clan is not missed — and that is what saved it here.

  **The failure afterwards was the value, exactly as promised.** 51 tests went
  red. Fifty were expectations pinned to synthetic values — `toBe(5)` for a clan
  that now has 30 members, `"Synthetic Clan"`, `21000` for a Games Champion
  achievement that is really 178935. Those assert which clan was captured, not
  what the code does, so they were rewritten to derive from the fixture; a test
  that must be edited on every re-capture is one that will eventually be edited
  to match a bug.

  **The fifty-first was a real bug.** See the note on `normaliseCwlSeason` under
  section 0.

  Two things the real data changed permanently:

  - **`currentwar.json` is `notInWar`**, and usually will be — a clan is in a war
    a few days at a time. `test/sync-war.test.ts` therefore builds its in-war
    fixture from `cwlwar.json` (identical shape, real data), stripping `warTag`
    and setting `attacksPerMember` to 2, and restores the captured file in
    `afterEach`. Re-capturing will not fix this and is not meant to.
  - **Fixture mode replays one war for all 28 war tags** in the league group, so
    CWL row counts scale with the group size while per-war assertions do not.
    `test/sync-cwl.test.ts` asserts counts against `WAR_COUNT` and everything
    else against a single war row.

  Re-run `npm run fixtures:capture` during any later CWL week to refresh. It
  reads the clan tags from the database (added by a leader at `/admin`, not
  seeded). Pass a tag to override: `npm run fixtures:capture -- '#TAG'`.

- [x] **T2.2 — Zod schemas**
  `integration/coc-schemas.ts`, one schema per endpoint, written against the fixtures.

- [x] **T2.3 — The API client**
  `integration/coc-client.ts`:
  - Base URL from `COC_API_BASE`
  - 10 second timeout with `AbortController`
  - Retry with backoff on 429 and 5xx only — never on 403 or 404
  - 200 ms delay between calls
  - Parse every response through Zod
  - Named errors: `CocAuthError`, `CocNotFoundError`, `CocRateLimitError`, `CocPrivateLogError`
  - `USE_FIXTURES=true` reads from `fixtures/` instead of the network
  **Done when:** the whole client works offline with `USE_FIXTURES=true`.

- [x] **T2.4 — Mappers**
  `integration/mappers/` — API shape to internal type. No raw field names escape this folder (R7).

- [x] **T2.5 — `scripts/sync/shared.ts`**
  Supabase admin client, `startSyncLog()`, `finishSyncLog()`, top-level error capture. Every job uses these (R9).

- [x] **T2.6 — `scripts/sync/clans.ts`**
  For each of the three clans: fetch members, upsert `players`, update roles, write `sync_log`.
  Run it locally with fixtures, then against the live API.
  **Done when:** running it twice produces no duplicate rows.

- [x] **T2.7 — First GitHub Actions workflow**
  `sync-clans.yml`, hourly, with `workflow_dispatch` so you can trigger it manually.
  Add secrets: `COC_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `COC_API_BASE` set to the proxy.
  **Done when:** a manual run succeeds and `sync_log` shows a row.

- [x] **T2.8 — Backup workflow**
  `backup.yml`, weekly `pg_dump` committed to a private repository or uploaded as an artifact.
  **Do this now, not later.** A backup added in month six protects nothing lost in month three.

- [x] **T2.9 — Donation and activity snapshots**
  Migration 007: `member_snapshots` — `clan_id`, `player_id`, `captured_at`, `donations`, `donations_received`, `trophies`, `war_stars`, `th_level`, `role`.
  Extend `scripts/sync/clans.ts` to write one row per player per run.
  These are cumulative season totals that Supercell resets monthly. Snapshotting is the only way to derive per-season figures and to detect inactivity later. Without this, phase 3B has nothing to display.

---

# Phase 3 — Auth and identity

- [x] **T3.1 — Magic link login**
  `/login` page, Supabase Auth email OTP. No passwords.

- [x] **T3.2 — Session middleware**
  Refresh the session, redirect unauthenticated users to `/login`.

- [x] **T3.3 — Player verification**
  `/api/verify` route handler. Input: player tag plus in-game API token.
  Call Supercell's `/players/{tag}/verifytoken` endpoint. On success set `players.verified = true` and link `user_id`.
  **The token is verified and discarded** (R8).
  Rate limit this route with Upstash — 5 attempts per user per hour.

- [x] **T3.4 — Verification page**
  Step-by-step instructions with screenshots of Settings → More Settings → API Token.
  Include the warning: this API token is safe to share; a Supercell ID password is never required by any website.

- [x] **T3.5 — Roles and `requireRole()` helper**
  leader / co-leader / elder / member. A helper that route handlers call before acting.

- [x] **T3.6 — Clan switcher**
  Layout shell with navigation between the three clans, showing only clans the user may see.

- [x] **T3.7 — Authorisation test**
  Sign in as an ordinary member of clan 1. Request clan 2's data by editing the URL directly. Try the API routes too.
  **Done when:** every attempt returns empty or forbidden. Repeat this test at the end of every later phase.

- [x] **T3.8 — Account approval gate**
  Magic-link signup alone means anyone with an email address can create an account. Verification proves they own *a* Clash of Clans account, not that they belong to *your* clans.
  Gate it: a new user lands in a pending state and sees nothing until either their verified player tag matches a current member of one of the three clans, or a leader approves them manually.
  **Done when:** an account created with a random email and a stranger's verified tag can see no clan data.

- [x] **T3.9 — Member movement and former members**
  Players move between your three clans, and some leave entirely. Handle this in `scripts/sync/clans.ts`:
  - Player appears in a different clan → update `players.clan_id`, keep all history attached to the player, not the clan
  - Player no longer in any of the three clans → set `left_at`, keep the row, revoke access
  Migration 008 adds `players.left_at`.
  **Done when:** moving a test player between two clans in game preserves their CWL history and does not duplicate the player row.

---

# Phase 3B — Clan directory and member profiles

*This is the module every other page links into. It was the largest gap in the first draft of this plan.*

- [x] **T3B.1 — Clan dashboard**
  `/[clanTag]/page.tsx` — clan name, badge, level, member count, war league, current war state, next CWL date, latest announcement, data freshness. The landing page after login.

- [x] **T3B.2 — Member directory**
  Sortable table: name, tag, role, Town Hall, trophies, donations given and received, ratio, war stars, last seen active.
  Sort and filter by each column. This replaces "scroll WhatsApp and guess".

- [x] **T3B.3 — Donation ratio and season totals**
  Derive per-season donations from `member_snapshots` (T2.9) by differencing across the season, handling the monthly reset.
  Flag members below a configurable ratio threshold.

- [x] **T3B.4 — Player profile page**
  `/[clanTag]/player/[tag]` — one member, everything: CWL history, war attacks, raid participation, Clan Games points, donation trend, clan movement history.
  **This page is objective O4.** The leader must be able to answer "how active has this member been for six months" in under thirty seconds. Nothing else in the plan delivers that.

- [x] **T3B.5 — Inactivity detection**
  Compute a simple activity score from war participation, CWL attacks, raid attacks, donations, and last seen.
  Show a "needs attention" list per clan. Advisory only — never automate kick decisions.

- [x] **T3B.6 — Cross-clan member search**
  Search by name or tag across all three clans at once. Useful when a leader remembers a name but not which clan.

---

# Phase 4 — Clan War League

*The urgent one. A CWL season that passes before this works is unrecoverable.*

- [x] **T4.1 — `scripts/sync/cwl.ts`**
  Fetch the league group. For each war tag, fetch the war, then insert seasons, wars, and attacks with `ON CONFLICT DO NOTHING`.
  Handle a missing CWL group as a clean exit, not an error (R10) — it is absent for three weeks of every month.

- [x] **T4.2 — `sync-cwl.yml`**
  Every 2 hours, plus `workflow_dispatch`.
  Do not assume punctual execution. GitHub delays scheduled runs by up to twenty minutes.

- [x] **T4.3 — CWL repositories and services**
  Season list, war days, attacks by player, missed attacks calculated from roster minus attacks.
  Every query filters by clan (R3).

- [x] **T4.4 — Season overview page**
  `/[clanTag]/cwl` — day-by-day results, stars, position.

  **The next start date is now built too, and it was the last real entry on the
  dashboard's "Not built yet" list.** The API publishes no CWL start date
  anywhere — `/clanwarleague/group` describes a league that has already begun and
  404s the rest of the month — so `cwlWindow()`, `nextCwlWindow()` and
  `cwlPhase()` in `lib/coc-time.ts` infer it from the calendar, alongside the
  Clan Games window that solved the same problem for T7.4.

  **The risk runs the opposite way from Clan Games, which is what makes the
  simpler constants correct here.** Nothing syncs off this window: `sync-cwl.ts`
  runs every two hours regardless of the date and finds the season on its own
  within two hours of it existing (R10). It is a display value. Being a day out
  tells a leader "signup opens tomorrow" on the morning it opened — recoverable
  the moment they open the game — where being a day late for Clan Games loses a
  month of points permanently.

  **R11 and R12 both hold.** Nothing persists the inference: it is never written
  to `cwl_seasons` or to any column beside a sync-written one, so the table's
  provenance stays answerable. And both call sites compare it to reality rather
  than substituting for it — once a `cwl_seasons` row exists for the month, the
  season page is the answer and the guess is not shown at all.

- [x] **T4.5 — Day detail page**
  Roster, each attack with stars and destruction, and a clear list of who has not attacked.

- [x] **T4.6 — Member CWL history**
  One player across seasons: attacks used, stars, missed days.

- [x] **T4.7 — Bonus medal recording**
  Leader and co-leader assign bonuses. Store `awarded_by`, `awarded_at`, and a note. Write to `audit_log`.

- [x] **T4.8 — Data freshness indicator**
  Every page shows "updated N minutes ago" from `sync_log`. Turns red past a threshold.
  This is how you find out a job died before it costs you a season.

- [ ] **T4.9 — Moved**
  CWL roster planning is now Phase 4B. It became a module, not a task.

- [~] **T4.10 — Import the handwritten logbooks** — **DROPPED, by decision**
  ~~A leader-only form to enter past CWL seasons by hand from the photographs
  taken at T0.13.~~ Dropped with T0.13: the leader does not want the historical
  seasons carried over.

  What this costs, stated plainly so the decision is not re-litigated from
  memory: **the platform's history begins on 2026-08-09.** O2 in section 5B
  ("logbook eliminated") is now only forward-looking, and O4 — any member's
  six-month history in thirty seconds — cannot answer for any month before that
  until six months have passed. Nothing else depends on it;
  `app/(app)/[clanTag]/cwl/import/page.tsx` stays a placeholder.

---

# Phase 4B — Polls, rosters and selection

*This is the leader's actual workload, and it was the weakest part of the first plan.*

*Everything before this phase records what the game did. This phase supports what people decide. It is the reason the system needs a real backend and not just sync jobs.*

**Assumption to confirm:** the leader selects players across all three clans together, deciding which clan each available player should play CWL in. The design below supports that. If instead each clan chooses separately, the same tables work — you simply never move a player between clans. Confirm before building T4B.6.

## Polls

- [x] **T4B.1 — Migration 010: poll tables**
  ```
  polls           id, scope, clan_id, season, poll_type, title, question,
                  opens_at, closes_at, status, created_by, created_at, deleted_at
  poll_options    id, poll_id, label, sort_order
  poll_responses  id, poll_id, player_id, option_id, note,
                  responded_at, updated_at
  ```
  `scope` is `clan` or `family` — a family poll spans all three clans, which is what a CWL availability poll needs.
  `poll_type` is `cwl_availability`, `war_availability`, or `general`.
  Unique constraint on `poll_responses(poll_id, player_id)` — one answer per player, editable until the poll closes.
  **These tables are written by people only. No sync job touches them (R11).**

- [x] **T4B.2 — Create a poll**
  Leader and co-leader only. Title, question, options, open and close times, scope.
  A "CWL availability" template pre-fills the options: In / Out / Maybe.

- [x] **T4B.3 — Answer a poll**
  Members see open polls on the dashboard and answer in one tap.
  Answers are editable until `closes_at`, then locked. Record `updated_at` so a leader can see late changes.

- [x] **T4B.4 — Poll results**
  Live counts, and the full list of who answered what. Critically, also the list of **who has not answered** — that is the list the leader chases.
  Members see counts; leadership sees names.

- [x] **T4B.5 — Poll reminders**
  Push to non-responders before the poll closes. Reuses T5.6.
  A "Remind these N" button on the results page, shown only while the poll is
  open. The chase list is recomputed in the action rather than posted from the
  page: a hidden field would let a caller name anyone, and it would be stale the
  moment somebody answers while the leader is reading. Only the non-responders
  are notified — reminding everyone teaches the people who answered on time that
  answering does not stop the reminders, and they stop answering.
  The result is reported back, **including when it is zero**, because "reminded
  0" and "reminded 30" look identical otherwise and the difference is whether
  anybody has notifications turned on at all.

## CWL roster selection

- [x] **T4B.6 — Migration 011: roster tables**
  ```
  cwl_rosters        id, season, clan_id, status, slot_count,
                     created_by, published_at, created_at, deleted_at
  cwl_roster_members id, roster_id, player_id, position, added_by, added_at
  ```
  `status` is `draft` or `published`. `slot_count` is 15 or 30.
  Unique constraint `cwl_roster_members(roster_id, player_id)`.
  Second constraint: a player may appear in only one roster per season across all three clans. Enforce it in the database, not only in the form — otherwise the leader will double-book someone and not find out until CWL starts.

- [x] **T4B.7 — Season availability pool**
  One screen showing every player across all three clans for the season, with: their poll answer, current clan, Town Hall level, hero levels, last season's CWL performance, and their activity score from T3B.5.
  Filter and sort by any of these. This is the screen the leader makes the decision on, so it must show everything needed to decide, in one place.

- [x] **T4B.8 — Roster builder**
  Three roster panels, one per clan, each with its slot count. The leader assigns available players into clans.
  Show live: slots filled, slots remaining, and a warning if a player is already placed in another clan's roster.
  Saves continuously as `draft`. The leader will not finish this in one sitting.

- [x] **T4B.9 — Publish the roster**
  Draft becomes published. Members can now see it. Push notification to selected and non-selected players.
  Publishing is recorded in `audit_log`. Republishing after a change records a new entry — members will ask when they were dropped, and the answer should not depend on memory.

- [x] **T4B.10 — Roster view for members**
  Read-only published lineup per clan. Everyone can see it. This replaces the WhatsApp message that gets buried.

## After CWL

- [x] **T4B.11 — Plan versus reality**
  Compare `cwl_roster_members` against the roster the API reported. Show three groups: selected and played, selected but did not appear, appeared but was not selected.
  This is R12 in practice, and it is the report that ends arguments.

- [x] **T4B.12 — Contribution report**
  Per selected player for the season: attacks used out of 7, stars earned, average destruction, missed days, and bonus medal received or not.
  Sortable, exportable, and linked from the player profile (T3B.4).

- [x] **T4B.13 — Bonus medal suggestion**
  Rank selected players by contribution and suggest an order for bonus allocation, using the rule confirmed at T0.11.
  **Suggestion only.** The leader always decides, and the decision is recorded with a note (T4.7).

- [x] **T4B.14 — Roster history**
  Every past season's roster, poll, and contribution report, browsable by season and clan. Permanent.
  This is what the logbook was trying to be.

---

# Phase 5 — Announcements and notifications

- [x] **T5.1 — Announcements table UI**
  Post, pin, edit, soft delete. Leadership posts, everyone reads.

- [x] **T5.2 — Safe rendering**
  Plain text or restricted markdown. Never render raw HTML.

- [x] **T5.3 — PWA manifest and icons**
  `manifest.json`, icons at 192 and 512 px, `display: standalone`.
  The icons are generated by `npm run icons`, not committed as opaque binaries:
  section 3 rejects `sharp`, and pulling in an image library for three files that
  change once a year would be worse. `scripts/make-icons.ts` writes valid PNGs
  with nothing but Node's `zlib`. **It is a competent placeholder, not a brand** —
  replace it when there is a real design; nothing depends on its appearance.

- [x] **T5.4 — Service worker**
  Handle push events and notification clicks.
  A malformed or empty payload still shows a notification: finishing the handler
  without one makes Chrome display its own "site updated in the background",
  which looks broken and cannot be acted on. `notificationclick` focuses an
  existing window before opening a new one, so three taps do not leave three
  copies of the app. `pushsubscriptionchange` re-subscribes and reports the new
  endpoint — the push service can revoke one without telling us.

- [x] **T5.5 — Push subscription flow**
  Ask permission after login, store in `push_subscriptions`.
  **The prompt is behind a click, never on load.** An unprompted prompt is denied
  in about a second, and a denial is close to permanent — browsers remember it
  and the way back is through settings most members will never find.
  Needed migration 023 first: the table had existed since 004 with a select
  policy and nothing else.

- [x] **T5.6 — Push sending**
  Triggered from sync jobs: new announcement, CWL day ending with unused attacks.
  `lib/push.ts` is wired to **announcements** (T5.1), **poll reminders**
  (T4B.5), and now the **CWL day-ending reminder** — the last outstanding piece,
  and the most valuable notification in the system, because it is the only one
  that changes an outcome instead of reporting one.
  Sent from the application rather than only from a job, where a person triggered
  it: routing "the roster is published" through a two-hourly job means the
  notification arrives after the member has already heard it in WhatsApp.

  **Done 2026-08-11** — `scripts/sync/cwl-reminders.ts`, called at the tail of
  `syncCwl()` after the capture is durable. It reads `cwl_war_members` (019) and
  never `cwl_roster_members` (011), which is R12 and is asserted by a test that
  puts a player in the leader's roster and proves they are not chased.
  `missedAttacks()` (T4.3) is reused rather than re-derived, so "missed = on the
  roster with no attack row" keeps one implementation.

  Three decisions worth keeping:

  - **A four-hour window against a two-hourly job.** At most two reminders per
    war, and the second is only sent to whoever still has not attacked, because
    the missed list is recomputed each run. Narrower risks missing the war
    entirely when GitHub delays a scheduled run (T4.2 notes up to twenty
    minutes); wider produces a reminder far enough out to acknowledge and
    forget, competing with the one that matters.
  - **A war whose `end_time` has passed never reminds anyone.** That state is
    ordinary, not a bug — the sync runs every two hours, so a war can end well
    before anything notices. Asking for an attack that can no longer be made is
    how a clan learns to ignore the channel.
  - **It never throws.** It runs after the season data is written, and the
    capture is the half that cannot be repeated. A push service having a bad day
    must not fail the job, which would also fire T5.8's alert about a sync that
    in fact worked.

  Unlike T5.8's operational alert this one *is* preference-filtered: it goes to
  ordinary members about their own play, and T5.9 lists `cwl_reminders` as
  switchable for exactly that reason.

  **This also closed a gap in the test harness.** `test/pglite-supabase.ts`'s
  `rpc()` only handled scalar functions — `select fn(...)`, which yields one
  composite column for a `returns table` function instead of PostgREST's array
  of objects. `push_targets()` (023) is set-returning, so every notification
  path through `lib/push.ts` was unreachable from tests and
  `notifications.test.ts` had to exercise the function as hand-written SQL. Now
  dispatched on `pg_proc.proretset`.

- [x] **T5.7 — Install instructions page**
  Android: Chrome menu → Add to Home Screen.
  iPhone: Safari share → Add to Home Screen. Push only works after installing.
  The iPhone section is the point of this task: iOS exposes the push APIs *only*
  to a site installed from Safari, so before installation there is nothing to
  detect and nothing to explain at the moment it matters. It has to be written
  down and linked to, which is what `/guide` is for.

- [x] **T5.8 — Sync failure alert**
  When a sync job fails, or when the last successful run for a job type is older than its threshold, push a notification to the leader and to you.
  T4.8 tells you something is wrong if you happen to look at a page. This tells you without looking, which is the version that actually saves a CWL season.
  Two halves, and **the second is the one that matters**: a job that crashes
  alerts from its own failure path, but a job whose schedule stopped firing
  produces no signal of any kind. Nothing can report its own absence, so
  `sync-health.yml` watches from outside. It needs no game API key, which is
  deliberate — it must keep working when the others do not.
  Not preference-filtered (T5.9): an operational alert to the two people who can
  fix it is not something to opt out of. A job that has *never* succeeded is not
  flagged, or a fresh install would alert on day one and be disbelieved on day
  ninety.

- [x] **T5.9 — Notification preferences**
  Per-member toggles: war reminders, CWL reminders, raid reminders, announcements. Without these, a member who finds the notifications annoying will disable them entirely and stop receiving the important ones.
  **Every default is true, and an absent row means the same thing.** The send path
  left-joins and coalesces to true, so a member who never opens the settings page
  still gets the CWL reminder. The opposite default is the version where the
  feature silently reaches nobody while reporting success, which is
  indistinguishable from broken.
  Device on/off and kinds are shown as separate things on `/settings/notifications`,
  because a member seeing nothing is usually looking at a device that was never
  subscribed while all their kinds are enabled.

---

# Phase 6 — Clan war

*Reuses phase 4 almost entirely.*

- [x] **T6.1 — `scripts/sync/war.ts`**
  Handle `notInWar`, `preparation`, `inWar`, `warEnded` explicitly (R10).
  Reuses `chooseSides`, `warResult`, `storedState` and `resolvePlayers` from
  `scripts/sync/cwl.ts` rather than copying them — a second copy of "which side
  is us" is a second place for it to drift, and drift there records every result
  backwards with nothing to notice.
  One guard has no CWL equivalent: **`/currentwar` can return a league war during
  CWL week.** It carries a `warTag`, and writing it into `wars` double-counts the
  same war against `cwl_wars` in both war history and the contribution report.

- [x] **T6.2 — `sync-war.yml`**
  ~~Every 15 minutes.~~ **Hourly, as a second step of `sync-clans.yml`.** See the
  deviation note in §0 for the Actions-minutes arithmetic. `sync-war.yml` is
  `workflow_dispatch` only, for the manual mid-war refresh.

- [x] **T6.3 — War board page**
  Both rosters, attack status per base, live from the database.
  **Needed migration 026.** Only our own roster was stored; the opposing lineup
  arrived on the same response and was discarded, which made "both rosters"
  impossible and left target assignment as a bare list of numbers.

- [x] **T6.4 — Target assignment**
  Leadership assigns targets, writes to `war_targets`. Members may claim an unassigned target.
  Keep plan and outcome separate — never write results into `war_targets`.
  024 delivered the leadership half; **the member claim needed 025**, which 024
  had left with no write path at all.

- [x] **T6.5 — Plan versus outcome view**
  Show assigned target beside what actually happened.
  Adjacent columns on the war board's roster table. Never one reconciled column.

- [x] **T6.6 — War history**

- [x] **T6.7 — War availability poll**
  Reuses the poll tables from T4B.1 with `poll_type = war_availability`, scoped to one clan.
  Leader opens it before declaring war. Members answer in one tap. The leader sees the count before choosing the war size.
  Phase 4B had already built all of this except the last clause, and the last
  clause is the feature: the count is rendered **on the lineup page beside the
  size selector**, because a count on one screen and a size box on another is a
  memory test the leader will fail by guessing.

- [x] **T6.8 — War lineup selection**
  ~~Migration 012~~ **migration 024**: `war_lineups`, `war_lineup_members` — same shape as the CWL roster tables.
  The leader picks the lineup from those available. Published to members before the war is declared in game.
  The API cannot tell you who *will* be in a war, only who is. So this is entirely human-decision data (R11).

- [x] **T6.9 — War contribution report**
  Per member per war: attacks used, stars, destruction, and whether they followed their assigned target.
  Aggregate view across the last N wars, linked from the player profile.
  **A war gives two attacks, so CWL's boolean `missed` is wrong here.** Fifteen
  members each leaving one attack unused is a whole roster's worth of attacks,
  and a boolean reports every one of them as fine. The unit is the attack.

- [x] **T6.10 — War plan versus reality**
  Compare `war_lineup_members` against the roster the API reported, and `war_targets` against `war_attacks`.
  Same principle as T4B.11 (R12).
  "Ignored their target" is **not** the complement of "followed it" — the gap is
  "cannot tell yet", which is the common case mid-war. It is counted and shown
  separately, because a report saying six people disobeyed when five had simply
  not attacked is worse than no report.

---

# Phase 7 — Raids and Clan Games

*Needed migration 027, written BEFORE the syncs rather than after — the first
time the discard bug of 019/020/026 was caught in advance. §0 had predicted it
by name.*

- [x] **T7.1 — `scripts/sync/raids.ts`**
  Capital raid seasons. The API keeps recent history here, which makes this the easiest sync to write.
  The forgiving part is real: `/capitalraidseasons?limit=N` returns the last N
  weekends complete on every call, so a missed run backfills. **`limit` is the
  whole memory, though** — a clan unsynced longer than that loses the weekends
  that rolled off, permanently, which is why it asks for 10 and not 1.
  A 403 is deliberately **not** caught. `WAR_ENDPOINT` in `coc-client.ts` covers
  `/currentwar` only, so one arrives here as a key-IP error; whether this
  endpoint 403s for a private war log is unknown while the fixtures are
  synthetic (T2.1), and guessing would send an operator to fix a correct setting.

- [x] **T7.2 — `sync-raids.yml`**
  Daily. ~~Was~~ **four lines of comments with no `name:`, `on:` or `jobs:` — not
  an inert stub but a file GitHub reports as invalid.** Replaced.
  **Clan Games rides in as a second step**, not its own workflow, on T6.2's
  arithmetic: ~90% of a run is checkout and `npm ci`.

- [x] **T7.3 — Raid pages**
  Participation, attacks used, capital loot, history per member.
  **027 added `attack_limit`, and it is the point.** "Attacks used: 5" answers
  nothing — 5 of 5 did everything asked, 5 of 6 did not — and the limit varies
  per member with the bonus attack, so unlike a war's two it cannot be a
  constant. Third time this project has met the shape: CWL's boolean `missed`
  was right for one attack, T6.9 found it wrong for two, and raids are the
  general case. An unknown limit renders as unknown, never as complete.

- [x] **T7.4 — Clan Games sync**
  The API gives no per-season score. Snapshot each player's "Games Champion" achievement value at the start and end of the period; the difference is that season's score.
  **The window is derived from the calendar** (`lib/coc-time.ts`), never typed in
  by a leader — R11 keeps human dates out of a game-fact table. Deliberately
  conservative: snapshotting early costs nothing, late costs the month.
  **027's `settled_at` is what makes the end pass safe.** It must UPDATE a row
  its own earlier pass inserted, which R5 otherwise forbids, and without a marker
  a re-run in April would write April's lifetime total into March's `end_value`
  and silently turn a real score into a wrong one.
  The start write uses `ignoreDuplicates` for the same reason: the start window
  is a day wide (GitHub delays scheduled runs), and a second run inside it must
  not overwrite the opening reading with one taken after members had scored.

- [x] **T7.5 — Clan Games page**
  **Three states, not two: scored / pending / not measured.** A score is a
  difference, so a member with no opening reading has nothing to subtract from
  and cannot be given one later. Rendering that as 0 puts someone who joined on
  the 25th at the bottom of the leaderboard beside someone who did nothing —
  and bonus decisions get made off this page. Same distinction T6.10 keeps
  between "cannot tell yet" and "ignored their target".

---

# Phase 8 — Base layouts

*Fully independent of everything else.*

- [x] **T8.1 — Storage bucket and policies**
  Supabase Storage, RLS on the bucket.

  **Two migrations, and the split is deliberate.** 028 carries the votes table,
  the write policies 006 never gave `base_layouts`, the grants, and the voting
  functions — all in `public`, so PGlite can test every one of them. 029
  configures the Storage bucket and is **left out of `PHASE1_MIGRATIONS`**,
  because the `storage` schema does not exist in a plain Postgres and stubbing
  one would mean testing a mock of Supabase rather than Supabase. Its header
  says plainly that those policies are the only part of Phase 8 the suite
  cannot reach.

  **Private bucket, not public.** A public bucket serves every object to anyone
  holding the URL, and a war base is exactly what an opponent would like to see.
  Object paths lead with the clan id so `storage.foldername(name)[1]` can be
  checked against `auth_clan_ids()` — a flat `<layout_id>.jpg` would leave
  nothing to filter on and push the check into the application, where
  forgetting it fails open. **No DELETE policy at all** (R4): removing a layout
  sets `deleted_at` and the image stays.

  **006 shipped a select policy only, for the fourth time.** 021, 022 and 023
  each had to add the write path for a table that already existed. A policy is
  not a grant.

- [x] **T8.2 — Browser-side compression**
  Resize and compress with canvas before upload. Target under 300 KB. This is what keeps you inside the 1 GB free tier.

  `lib/layout-image.ts`. Longest edge 1280, quality stepped down through five
  levels until the result fits, always emitting JPEG — a screenshot of a base is
  a photograph as far as an encoder is concerned, and PNG's lossless encoding
  runs several times the size for no visible gain. Never enlarges: scaling a
  600px screenshot up to 1280 makes a bigger file out of the same information.

  Quality is **measured rather than computed** from the input size, because the
  relationship between the two depends entirely on the picture's content.

  Two hundred layouts at 3 MB would be 600 MB of a 1 GB tier. At 250 KB the same
  two hundred cost 50 MB.

- [x] **T8.3 — Upload flow**
  Copy link, screenshot, Town Hall level, type (war / farming / trophy), description.
  Validate real file type, not the filename. Strip EXIF.

  **EXIF is stripped as a consequence, not as a step.** Drawing an image onto a
  canvas and re-encoding produces a file containing pixels and nothing else — no
  camera model, no timestamp, no GPS. That last one is why it matters: a
  screenshot usually carries none, but a *photograph of a screen* taken on a
  phone carries where it was taken, and members will do that. There is no
  separate strip-EXIF call anywhere, because re-encoding is what strips it and a
  stripper that could be forgotten would eventually be.

  **File type is sniffed from magic bytes**, never the filename — a filename is
  a string the client chose, and `evil.exe` renamed to `base.png` passes every
  extension check ever written. An allow-list of JPEG/PNG/WebP, because a
  deny-list is a promise to have thought of everything. The WebP check reads
  both `RIFF` *and* `WEBP`, or any RIFF container (a `.wav`) would match.

  **The copy link is checked as a parsed hostname**, so
  `https://evil.example/?x=link.clashofclans.com` does not pass. A member
  tapping "Open in game" has every reason to expect the game.

  **The image is uploaded before the row is inserted**, which is not the obvious
  order. The other way round leaves a row pointing at an image that does not
  exist whenever the upload fails, and it renders as a broken card forever with
  no way for a member to fix it. This way the failure mode is an orphaned object
  costing a few hundred kilobytes — the same trade 029's missing DELETE policy
  already accepts.

- [x] **T8.4 — Browse and filter**
  By Town Hall level and type.

  Filters compose and live in the URL, so a filtered library is a link. Applied
  in the query rather than after it, so a clan with two hundred layouts does not
  read all of them to show nine.

  **Images are served through signed URLs minted per request**, in one batch
  rather than one per card, for a member who has already passed the clan check.
  They expire, so a link pasted into a chat stops working rather than becoming a
  permanent hole. `base_layouts.image_url` therefore stores a *path*, not a URL.

- [x] **T8.5 — Voting**

  **`base_layouts.votes` is an integer, and an integer cannot answer the only
  question voting has to answer** — have I already voted for this one? Without
  that, every vote button is a +1 button, one member can hold it down, and the
  ranking measures who cared most rather than what the clan thinks. It also
  cannot be undone, because there is no record of who to undo.

  So `base_layout_votes` carries one row per member per layout, and the counter
  stays as a maintained cache so browse-by-popularity is a sort rather than an
  aggregate per row. Both move inside one definer function: two statements from
  the application can be interrupted between, leaving a score that disagrees
  with the number of voters and nothing to say which is right. `authenticated`
  has **no insert grant** on the votes table, so that path is the only one.

  **R4, and the suite was right where the first draft was wrong.** That draft
  used a real `DELETE` to withdraw a vote, arguing a retraction is not history.
  `migrations.test.ts` rejected it — and 023 had already solved this exact shape
  for `notification_preferences` with a **partial** unique index, so a tombstone
  does not block a fresh row. The predicate is also what lets a member who
  unvotes vote again later, which a plain unique constraint would have made
  impossible. An invariant that holds everywhere beats a table-sized exception.

  Another clan's layout raises **"layout not found" rather than "forbidden"**: a
  distinct error would confirm the id exists (R3).

---

# Phase 9 — Consolidation

- [x] **T9.1 — Cross-clan report**
  Participation across all three clans in one view. This is what the leader actually wants.

  **Done 2026-08-12** — `/report`, `services/cross-clan.ts`, linked from the nav
  for leadership only. Every member of every visible clan in one sortable list,
  plus a per-clan summary card.

  - **R3 — spanning clans is not the same as not filtering by clan**, and this
    is the second page where that distinction is the whole risk (search, T3B.6,
    was the first). One set of reads per clan over `visibleClans()`; nothing
    queries `players` or `member_snapshots` unscoped and leans on RLS to sort it
    out. RLS is the net, not the plan.
  - **Flagged members sort first.** The page exists to answer "who has stopped
    turning up", so the answer is at the top rather than behind a sort the
    leader has to know to apply.
  - **Median, not mean, for the per-clan ratio.** One member donating 40,000
    drags a mean far above what a typical member there is doing, and the leader
    reads that as "clan B is fine" while most of clan B donates nothing. The
    median describes the middle member, which is the one the question is about.
  - **Unknown is not zero.** A member the sync has not reached shows "—", never
    0 — the difference between "new" and "inactive".
  - `needsAttention()` (T3B.5) is called once with the whole list rather than
    reimplemented, so this page and the per-clan attention list cannot drift
    into two opinions. CWL counts are passed as zero and the flag they drive is
    inert at zero by design; wiring them would be a roster-and-attack read per
    player per season across every clan.

  Advisory only, and the flags carry their reasons rather than a bare score. A
  leader who cannot see why somebody was flagged cannot defend the decision to
  them.

- [x] **T9.2 — Admin page**
  `sync_log` history, failed jobs, manual sync trigger, member management.

  **Done 2026-08-11.** Member management already existed (`/admin/members`,
  T3.8); this added the other three to `/admin`.

  - **History** — `recentRuns()` in `repositories/sync-log.ts`, newest first.
    Descending matters more than it looks: ascending plus a limit returns the
    OLDEST runs, which is still a full table on the page and completely wrong,
    with nothing to notice. Deliberately unfiltered by clan — 006's policy
    already scopes the rows, and re-stating the filter here would have given a
    platform admin a narrower answer than the policy grants them.
  - **Failed jobs** — derived from the same read rather than a second query. Two
    reads of a table a live sync job is writing to can disagree, and a failure
    panel contradicting the history directly beneath it is worse than either
    alone. A `skipped` run is not a failure (R10) and a `running` one has not
    failed yet — it becomes a problem by being old, which is `staleJobs()`.
  - **Manual trigger** — `lib/github.ts`, and **R2 is the whole design**. The
    obvious implementation imports `syncClans()` and calls it from a Server
    Action, which puts a sync on Vercel where a ten-second timeout kills it
    partway through. This dispatches `workflow_dispatch` instead and returns
    immediately, so the manual path and the 2 AM path are the same code. The
    button says "asked GitHub to run it", never "sync complete": GitHub's 204
    means the request was accepted, not that the job ran.

  Needs two new environment variables, both optional — unconfigured is a
  first-class state that explains itself rather than a button that always fails,
  the same shape as `pushConfigured()`:

  ```
  GITHUB_DISPATCH_TOKEN   fine-grained PAT, Actions read+write, this repo only
  GITHUB_DISPATCH_REPO    owner/repo
  GITHUB_DISPATCH_REF     optional, defaults to main
  ```

  **R6 is untouched by this.** That token is neither the Supabase service key
  nor the Clash of Clans token, so the web app still cannot bypass RLS and still
  cannot read game data. A leak lets someone run this repository's workflows;
  those are idempotent (R5) and write only game facts, so the cost is throttling
  and wasted Actions minutes, not altered data.

- [~] **T9.3 — Full security review** — *code side done; the Vercel half needs the dashboard*
  Repeat T3.7 against every route. Confirm no secrets in Vercel. Confirm the repository is private.

  **Audited 2026-08-12.** Each of these was run as a check rather than asserted
  from memory, which matters because every one of them is the kind of thing that
  is true right up until somebody adds one import:

  | Rule | Check | Result |
  |---|---|---|
  | R6 | anything under `src/app`, `src/components`, `src/lib` importing `supabase/admin` | none — the service key reaches only `scripts/` |
  | R1 | any page or route importing `integration/` | `api/verify/route.ts` alone, which is R6's one documented carve-out |
  | R4 | any `.delete()` in `src/` | none — soft delete everywhere |
  | R3 | any repository with no clan filter | none; all ten filter explicitly |
  | R8 | the in-game token stored or logged in `/api/verify` | length-checked, passed to Supercell, never persisted |
  | — | `.env.local` tracked by git | untracked |
  | — | JWT/API-key shaped literals in tracked source | none |
  | T3.7 | `test/authorisation.test.ts` | 35 passing |

  **T0.8 confirmed the repository is private** (Settings → Danger Zone,
  2026-08-11).

  **What is NOT done, and cannot be from here: confirming no secrets in
  Vercel.** That is a dashboard check against a deployment that does not exist
  yet. When it does, the rule is `SUPABASE_SERVICE_KEY` must not appear there at
  all, and `COC_API_TOKEN` only because `/api/verify` needs it (R6's carve-out).
  `GITHUB_DISPATCH_TOKEN` (T9.2) is Vercel-safe and belongs there.

  **Phase 8 has since landed, and it did add that surface.** What it brought:
  a private bucket whose policies are the one part of this project the test
  suite cannot reach (029 explains why), file types sniffed from magic bytes
  rather than filenames, EXIF removed by re-encoding rather than by a step that
  could be skipped, and copy links validated as parsed hostnames. Those are
  worth re-reading during the deployment pass rather than taken on trust — a
  storage bucket is the first place in this project where a member supplies
  bytes rather than a form field.

- [~] **T9.4 — Restore test** — *tooling written; needs a scratch project to run against*
  Actually restore a backup into a scratch Supabase project. An untested backup is not a backup.

  **`npm run restore:verify -- --dump <file>` exists as of 2026-08-12.** It could
  have been discharged by restoring one dump by hand and ticking the box, but the
  thing under test is not the file, it is the PROCEDURE — the one that has to work
  on the worst day this project ever has, run by somebody who is not calm. A
  procedure executed once, months ago, from memory, is not one to meet then.

  What it checks, in order: pg_restore is present and new enough (a custom-format
  dump from pg_dump 17 is unreadable by pg_restore 15, and the error does not say
  so); the target is empty, because a restore into a populated database cannot be
  told apart from one that did nothing; every table in `PHASE1_TABLES` came back;
  and nothing restored empty that the live database has rows for.

  It names `IRREPLACEABLE` separately from the rest. Most of this database is a
  copy of something Supercell will still tell us and the next sync would replace
  within the hour. `cwl_*`, `wars`, `war_attacks`, `member_snapshots`,
  `raid_seasons`, `clan_games*`, `poll_responses` and `audit_log` would not come
  back from anywhere — the CWL endpoints serve the current season only, a war
  leaves `currentwar` when the next one starts, and the roster and audit tables
  are this project's own record of human decisions (R11, R12).

  **The refusal that matters more than any of the checks:** `--into` is compared
  against `SUPABASE_DB_URL` and rejected if they match. A restore is the one
  operation here that destroys rather than appends, and R4's protections do not
  apply to it — pg_restore passes through no policy, no grant and no definer
  function. Pointing it at production would cause exactly the loss this task
  exists to prevent, by way of the task itself.

  **Still outstanding:** running it. That needs a scratch Supabase project and a
  downloaded artifact from the `backup` workflow, neither of which exists from
  here.

- [x] **T9.5 — Member guide**
  One page: how to sign up, verify, and install the app.

  **Was already done and the box was simply never ticked** — `/guide`
  (`app/(app)/guide/page.tsx`, 225 lines) has covered all three since T5.7, plus
  the approval step in between and turning notifications on afterwards. Verified
  2026-08-11 rather than assumed: it carries the sign-in path, the link to
  `/verify`, the "this API token is safe to share, a Supercell ID password is
  never required" warning, and separate Android/Chrome and iPhone/Safari install
  sections. The iOS one is the reason the page exists at all, since iOS exposes
  push only to a site installed from Safari.

- [x] **T9.6 — Audit log viewer**
  Leader-only page reading `audit_log`: who changed what and when, filterable by user and by entity.
  R4 says every write is recorded. Without a viewer that record is invisible, and the protection against a departing member is theoretical.

- [x] **T9.7 — Global rate limiting**
  T3.3 rate limits verification only. Apply Upstash limits to every write route and every route that triggers a sync.
  Prevents the platform being used as an open proxy to the Clash of Clans API, which would get your key throttled.

  **Done 2026-08-11, in the middleware rather than in every action.** There are
  eleven files containing `"use server"` and there will be more; a check
  copy-pasted into each is a check that will be missing from the twelfth, and
  nothing fails when it is — the action works perfectly, it is simply
  unlimited, which is invisible until somebody finds it. `lib/supabase/middleware.ts`
  is the one place every action necessarily passes through. A Server Action is
  a POST carrying a `next-action` header, which is what distinguishes it from
  an ordinary navigation.

  Applied after the session is resolved, so the budget is per member rather
  than per IP, and after the unauthenticated redirect, so a signed-out request
  never consumes anyone's budget. `WRITE_LIMIT` is 30/minute.

  **API routes are deliberately excluded** — `/api/verify` has its own far
  stricter 5-per-hour budget (T3.3) and `/api/push/subscribe` its own. A second
  limiter over the top would only make the tighter one harder to reason about.
  The sync trigger added at T9.2 uses `SYNC_TRIGGER_LIMIT` (3/hour) at its own
  call site, because a workflow run costs Actions minutes and hits a
  rate-limited game API — a different budget from an ordinary write.

  **It fails open, and the distinction from `lib/rate-limit.ts`'s refusal to
  fall back in production matters.** That refusal is about a limiter
  CONFIGURED WRONG, which would pretend to work forever. This is about one
  configured correctly and momentarily unreachable. Rejecting every write in
  the product because Upstash is having a bad minute is worse than briefly not
  limiting, and the writes behind it are still gated by RLS and each action's
  own role check — the limiter is a budget, never the access control.

- [x] **T9.8 — Fan content compliance**
  Footer disclaimer stating the platform is not affiliated with, endorsed by, or sponsored by Supercell, using the wording recorded at T0.12.
  Confirm no advertising and no payment of any kind. The API key is non-commercial and can be revoked.

  Done 2026-08-11 — `src/app/layout.tsx`, the root layout rather than the
  `(app)` group's, specifically so it also covers `/login` and `/pending`:
  every page reachable before a session exists still displays Clash of Clans
  data or branding, and the policy's obligation is not conditional on being
  signed in. T0.12's wording copied verbatim, not paraphrased — the policy
  permits "a substantially similar notice," and a verbatim copy removes any
  question of whether a rewrite still qualifies. No advertising, no payment of
  any kind, anywhere in the codebase — confirmed by inspection, not merely by
  absence of a payment integration.

- [x] **T9.9 — Local time display**
  Every timestamp is stored UTC and displayed in the member's local time. Confirm war end times, CWL day boundaries, and raid weekend windows all show correctly for Sri Lanka.
  Off-by-one-day errors here are common and quietly make missed-attack lists wrong.

  **This one was a real bug, not a confirmation exercise.** Every page formatted
  timestamps with `new Date(iso).toLocaleString("en-GB", …)` inside a SERVER
  component — and only `/login` and `/verify` are client components, so that is
  all of them. `toLocaleString` there runs on the server and uses the server's
  zone, which on Vercel is UTC, for every reader. `war/page.tsx` even carried
  the comment *"UTC in the database, local in the browser (T9.9)"*, describing
  the intention rather than the behaviour.

  Sri Lanka is UTC+05:30, so a war ending 20:00 UTC on the 29th is 01:30 on the
  30th locally. It rendered as "29 Jul, 20:00" — right instant, wrong day,
  stated with complete confidence. Exactly the failure this task predicts.
  `coc-time.test.ts` had asserted the Colombo boundary since T1.13; the display
  layer simply never used it.

  Fixed with two mechanisms, in `lib/display-time.ts`:

  - **`formatDisplay()`** — server-side, always `DISPLAY_ZONE`
    (`Asia/Colombo`). Correct for every member of these clans, needs no
    JavaScript, cannot produce a hydration mismatch. Applied to all nine
    affected helpers.
  - **`<LocalTime>`** (`components/local-time.tsx`) — upgrades to the reader's
    real zone once mounted, used where the value is a DEADLINE they act on. It
    renders `DISPLAY_ZONE` on the server, so the two agree until the browser
    takes over; `suppressHydrationWarning` is correct here rather than swept
    under, because the server cannot know the reader's zone and the mismatch it
    warns about IS the feature.

  Two formatters deliberately stay UTC, and it is worth being explicit about
  why: `monthName()` in `games/page.tsx` and `monthLabel()` in the player
  profile both format a date CONSTRUCTED at midnight UTC to carry a `YYYY-MM`
  key. Re-zoning those rolls them backwards into the previous month and labels
  August's totals "Jul 2026".

- [~] **T9.10 — Empty and loading states** — *all but "no layouts", which waits on Phase 8*
  Every page needs a sensible state for: no war in progress, not CWL week, no layouts uploaded, new member with no history, and a sync that has never run. Three weeks of every month there is no CWL, so this is the normal state, not an edge case.

  **Loading half done 2026-08-11.** 0 of 33 pages had a `loading.tsx`, so every
  navigation rendered fully server-side with nothing shown until it finished —
  no spinner, no dimming, the previous page just sitting there unchanged. A
  700ms page therefore read as a dead link, and the natural response was to
  click it again. One `loading.tsx` at the `(app)` group root now covers all
  33 pages with a skeleton, streamed in ahead of the real content; the header
  and clan switcher live outside it so only the content area swaps. Same
  commit also parallelised two independent Supabase calls in that layout
  (`Promise.all`) that were awaited one after the other on every navigation.
  **Empty-states half audited 2026-08-12, and it was already there.** The note
  above said it was "not built"; that was wrong. Each page grew its own empty
  state as it was written, because a page whose normal condition is empty — and
  three weeks in four that is most of this product — is not usable without one.
  Every built page under `(app)` was checked individually:

  - **No war in progress** — `war/page.tsx` and the dashboard both distinguish
    "no war on right now, the board fills in within the hour" from "the sync has
    never run", which are different problems with different fixes.
  - **Not CWL week** — `cwl/page.tsx`, and `sync:cwl` records it as `skipped`
    rather than `failed` (R10) so the freshness indicator stays green.
  - **New member with no history** — the player profile has three separate ones,
    for CWL, donations and war, rather than one blanket message.
  - **A sync that has never run** — `DataFreshness` (T4.8), the admin history,
    and the members directory each say so explicitly.
  - Directories, polls, rosters, search, audit log and pending accounts all
    carry their own.

  **The audit's one real finding was an orphan route**, and it is removed in the
  same commit: `[clanTag]/cwl/import/` was T4.10's placeholder, still serving
  "Placeholder — see IMPLEMENTATION.md" to anyone who found the URL. T4.10 was
  dropped by decision (see T0.13), so the right empty state for it is not a
  better message — it is not being routable. Nothing linked to it.

  **"No layouts uploaded" is the one genuinely outstanding case**, and it is
  outstanding because Phase 8 is not built. Its two placeholder pages are
  unlinked, so no member reaches them; they get real empty states when the
  feature lands rather than a placeholder dressed up as one.

---

## Phase 10 — Signing in, and signing out

**The bug that started it, in the member's own words: he has two accounts — two
bases, two email addresses — and once signed in as one of them there was no way
to become the other.** He was right, and the cause was worse than he thought. A
search of the whole repository for `logout|signOut|sign-out|destroy session|
cookie delete` returned zero hits in `src/`, `supabase/`, `scripts/` and `test/`.
There was no `/logout` route, no `supabase.auth.signOut()` call anywhere, no
sign-out link in the shell, and no cookie deletion code of any kind. A session
ended when it expired and not before. Clearing site data by hand was the
workaround, and nothing in the product said so.

That is one missing button. The second half is why the button alone would not
have been enough: with the magic link as the only door, *every* switch between
those two accounts means opening an inbox and waiting for mail to arrive. So
Phase 10 is both — a real sign-out, and a password so that using it is cheap.

**What did NOT change: how an account is created.** Sign-up is still the magic
link, a leader still approves every account (T3.8), and verification still
proves a player tag (T3.3). Nobody new can get in by a route that did not exist
before.

- [x] **T10.1 — Migration 030: `username` and `password_set_at`**
  Two columns on `users`, no new policy, and the absence of the policy is the
  part worth reading.

  **No password is stored in this database and none ever should be.** Passwords
  live in `auth.users.encrypted_password`, written only by
  `supabase.auth.updateUser({ password })`. There is no password column, no
  salt, no hash, and `package.json` gained no hashing dependency —
  `test/account-credentials.test.ts` asserts that last point against
  `information_schema` so that it stays true rather than remaining true by
  nobody having got round to breaking it.

  **Why no policy was needed.** 015's `"own profile update"` already grants
  update on `users where id = auth.uid()`, and its guard trigger blocks exactly
  three columns: `is_platform_admin`, `status`, `requested_clan_id`. Both new
  columns therefore fall through as writable by their owner and nobody else,
  which is the rule wanted. The next person to read 030 will look for a policy
  and not find one, so the migration says this at length.

  **One deliberate hole, recorded rather than closed.** `password_set_at` is
  writable by its owner, so a member could set it without setting a password and
  skip the setup step. That harms only them — the Sign in button then fails for
  their account — and adding it to the guard trigger would block the setup
  action, which is the only thing that legitimately writes it.

  `username` is **not** the sign-in identifier. See T10.4.

- [x] **T10.2 — `safeNext` extracted, and given the tests it never had**
  It lived inside `auth/callback/route.ts` as a local function for eight phases,
  untested, being the one guard between a genuine ClanBridge magic link and a
  page on somebody else's domain. T10.4 gave it a second caller, so it moved to
  `lib/safe-next.ts` — two copies of a redirect guard is one copy that gets
  fixed and one that does not. `//evil.com` and `/\evil.com` both now have a
  named test.

- [x] **T10.3 — Sign out** — `src/app/auth/sign-out/route.ts`
  A `POST` route handler, and each of the three reasons it is not a Server
  Action matters: it sits under `/auth`, which `PUBLIC_PATHS` already reaches
  without a session, so signing out of an *expired* session does not itself
  bounce to `/login`; it is outside `(app)`, so neither the approval gate nor
  the new setup gate can redirect it, which is what lets a member stranded on
  `/account/setup` with the wrong account leave; and a plain
  `<form method="post">` reaches it with no JavaScript.

  **The failure it guards against is the silent one.** If one `sb-*` cookie
  survives, `updateSession()` still resolves a user on the next request, the
  member is bounced off `/login` back into the app, and the button looks like it
  does nothing — indistinguishable from the bug it was written to fix. So the
  route clears them explicitly on top of `signOut()`'s own clearing, because
  this project never states the `@supabase/ssr` cookie names anywhere and
  therefore cannot notice when they change.

  303, not the default 307: a 307 preserves the method and re-POSTs to `/login`,
  which is a page and answers 405. No `GET` handler — a GET sign-out is reachable
  by a prefetch, an `<img src>`, or a link scanner in somebody's mail client.
  Cross-origin POSTs are refused; a missing `Origin` is allowed, because a
  browser cannot suppress it on a cross-site form post.

- [x] **T10.4 — Password sign-in** — `src/app/api/auth/sign-in/route.ts`
  **The identifier is the EMAIL, not the username**, and that was a decision
  taken against the original request. Supabase Auth is keyed on email;
  `signInWithPassword` takes an email. Signing in by handle would need an
  endpoint that resolves a username to an email address, callable by anyone
  holding the public anon key — which is in the JavaScript bundle. That is a
  username-to-real-email harvester in exchange for a slightly shorter thing to
  type. The username is kept as the display handle instead, which is what
  actually solves the reported problem: the shell now shows *which* account you
  are on.

  **A route handler rather than calling `signInWithPassword` in the browser.**
  The browser client would work — `@supabase/ssr` writes cookies either way — and
  would be unlimited: every guess would travel from attacker to Supabase without
  passing through anything this project controls. Structure follows
  `/api/verify`: identify, limit, act.

  **`SIGN_IN_LIMIT` — 10 per 15 minutes, keyed on both the folded address and
  the host**, because the two stop different attacks: one account ground down
  from a thousand hosts, and one host walking a list of addresses.

  **It fails OPEN, and that is a deliberate disagreement with `/api/verify`,
  which fails closed on the same condition.** Verify fails closed because
  failing open exposes the game API key and there is nothing underneath it.
  Sign-in has something underneath it: Supabase rate-limits its own token
  endpoint per IP regardless. So the choice is not "limited or unlimited", it is
  "our budget plus theirs, or theirs alone" — and failing closed means nobody
  can get into the product at all because Upstash had a bad minute. Same
  reasoning as `hasWriteBudget()`.

  **Every credential failure returns the same sentence.** "Invalid login
  credentials" and "Email not confirmed" are different Supabase strings for
  different states; returning them turns this route into an oracle reporting
  which addresses have accounts here. The real reason goes to the log. Four
  distinct Supabase messages are asserted to produce byte-identical responses.

  **`PUBLIC_PATHS` had to grow `/api/auth`, and that is the line most likely to
  be dropped in a rewrite.** The middleware redirects every unauthenticated
  non-public request to `/login`, and an unauthenticated request is the *only*
  kind this route ever receives. Omitting it does not make the route secure — it
  makes sign-in silently never work, and nothing else in the suite would notice,
  because the route's own tests call `POST()` directly and pass.
  `test/public-paths.test.ts` exists for that one line.

- [x] **T10.5 — The compulsory setup step** — `(app)/account/setup/page.tsx`
  Every account is held here, once, immediately after its first magic link,
  until it has a username and a password.

  **Compulsory rather than optional in Settings, because the optional version
  fails silently:** members skip it, the Sign in button does not work for them,
  and they find out by trying to sign in without their inbox and failing. A door
  that works for some accounts and not others is worse than one door.

  **The gate runs BEFORE the T3.8 approval gate, and the ordering is the whole
  thing working.** A brand-new account is `pending` by definition, and every
  account that predates Phase 10 has neither column set. Approval-first would
  send all of them to `/pending`, where there is nothing to do and no way to
  finish — so the Sign in button would never work for anybody and the magic link
  would remain the only door. `"/account"` is in `GATE_EXEMPT` for the mirror
  reason: without it the approval gate bounces them straight back off the setup
  page.

  This is the same defect class as the `/admin` bootstrap deadlock that
  `lib/gate.ts` was written about, one phase later and worse — that one locked
  out the first user, this would have locked out every user. Nothing would fail
  loudly; every other test would pass. `src/lib/gate.test.ts` now asserts
  `/account/setup` is exempt from **both** gates as a single case, because it is
  a single bug.

  **Writes go username → password → `password_set_at`.** The username is the
  write that can fail on somebody else's data (the unique index), so it goes
  first; the flag goes last because while it is null the member re-enters this
  page, which is the correct place to be if any step above it did not finish.
  The page is re-entrant and the index permits rewriting your own handle to the
  value it already has — asserted in `test/account-credentials.test.ts`.

  **One query, not four.** `(app)/layout.tsx` runs on every navigation and now
  needs `status`, `username`, `password_set_at` and `email`. `accountProfile()`
  fetches all four in one read and `accountStatus()` delegates to it, so the
  gate cost nothing in round trips.

- [x] **T10.6 — `/login` rewritten: two doors**
  **Sign in** (email + password) and **Sign up** (the magic link, unchanged) as
  distinct buttons on one page. One page rather than a `/signup` route, because
  two forms can disagree about what an email address is.

  **The password reset is the sign-up door used again**, deliberately: forgotten
  password → get a link → Settings → Account → set a new one. No
  `resetPasswordForEmail`, no second email template, no extra route, and the
  mechanism it leans on is one that already has to work.

  A `?signed-out=1` confirmation is rendered, because an unannounced return to
  the login form is indistinguishable from a session that expired by itself —
  which is exactly the confusion the sign-out button was added to end.

  The old header comment and subtitle both asserted *"there is no password"*.
  Both are rewritten rather than left as comments that lie.

- [x] **T10.7 — Settings → Account** — `(app)/settings/account/page.tsx`
  Change the username, change the password, sign out. Validation is shared with
  T10.5 through `lib/account.ts` so the two pages cannot disagree about what a
  valid handle is.

  **The current password is not required, and that is a decision.** Requiring it
  would close the reset path above for exactly the people who need it — somebody
  who has forgotten their password cannot type it. The session is the proof, the
  same proof every other write in this product accepts. If that stops being an
  acceptable trade, the thing to turn on is Supabase's "secure password change"
  reauthentication setting, at the auth layer where it belongs; do not
  reimplement it in the page.

- [x] **T10.8 — The auth-adjacent security findings**
  Found while reading the system for the above, and fixed in the same pass.

  **a. `/report` had no role check** — and this is the real one. The page checked
  only `currentUserId` and `clans.length === 0`; the sole thing keeping ordinary
  members out was that the nav link is rendered for leadership only. That link's
  own comment says the page *"is a leader's view of the family, not a member's
  view of their own clan"*. Any approved member who typed the URL got every
  member of their clan with the reasons each was flagged. RLS still scoped it to
  their own clans, so nothing crossed a clan boundary — but a hidden link is not
  an access control, and this was the one page in the product gated by link
  hiding alone. Now filters `visibleClans()` to leadership, the way `/roster`
  already did.

  **b. The login form had no rate limit at all** — `signInWithOtp` goes from the
  browser straight to Supabase and never passes through this application, so
  only Supabase's own email throttle applied. T10.4 covers the password path,
  which is the one worth guessing at. The magic-link call is deliberately left
  client-side: routing it through a server route would add a second endpoint to
  protect in order to limit the *cheaper* attack.

  **c. No security headers** — `next.config.ts` set only `images.remotePatterns`.
  Added `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and
  HSTS (two years, subdomains, no `preload` — that is a submission to a list
  baked into browsers and should be a deliberate act, not a config default).
  Applied to `/:path*`, including `/api` and `/auth`; a header applied to pages
  only is a header missing from the two routes that handle credentials.

  **No CSP, and it is the obvious omission.** Next's App Router emits inline
  bootstrap scripts, so a real one needs a per-request nonce threaded through
  middleware — its own change, with its own way of silently breaking the app. A
  CSP containing `'unsafe-inline'` is a header that looks like protection and is
  not. **Outstanding, recorded rather than half-done.**

  **d. Raw Postgres errors reached the browser** — most Server Actions redirect
  with `?error=${error.message}`. React escapes it, so not XSS, but the member
  saw things like `new row violates row-level security policy for table
  "clan_roles"`, which tells them nothing actionable and tells a prober the
  schema. The RLS one is the worse half: naming the table a policy guards is
  describing the lock to whoever is picking it. `lib/errors.ts` logs the raw text
  and returns a sentence; applied in the new auth code and in both `admin/`
  files. **The remaining call sites are an outstanding mechanical sweep** —
  `[clanTag]/notices`, `polls`, `war`, `layouts`, `roster` — left out of this
  commit because a dozen unrelated files would make it unreviewable.

**Outstanding after Phase 10, all of it needing something outside the repo:**

- **Apply migration 030 to the live database**, then re-run `npm run types:db`.
  Until both happen `src/types/database.ts` is stale for `users` (nothing
  imports it today, which is why this type-checks regardless — that is a reason
  to fix it, not to relax).
- **Two Supabase dashboard settings**, and the app-side check is only a
  courtesy: raise **Minimum password length** to 10 to match `lib/account.ts`,
  and enable **leaked-password protection** (HaveIBeenPwned). `updateUser()`
  applies the project setting regardless of what this codebase says, so if these
  are not set the app promises something the backend does not keep.
- **T9.3 needs re-running**, and now for two reasons rather than one: its own
  note said to redo it after Phase 8 (which has since landed), and Phase 10 has
  added the first password field in the product.
- **The CSP** and **the `safeMessage` sweep**, both above.

---

# Phase 11 — Your bases, and what each of them is

*A member owns villages, not one village, and until now the product had nowhere to say so.*

`Architecture.md` §7.1 has promised this since the first draft: "a member may own
more than one player account, and accounts may sit in different clans. The model
supports this from the start." That has been true of the schema and false of the
product for ten phases. §0 above records how the gap was found and what was broken
underneath it; this block is the work.

Read Phase 11 in the order it is written. Every migration lands before the page
that needs it, and 031 lands first because two later files call the helper it
defines.

- [x] **T11.1 — Let a member read every base they own** — `supabase/migrations/031_own_players_policy.sql`
  `auth_owned_player_ids()`, mirroring 006's `auth_clan_ids()`, plus a second
  permissive SELECT policy on `players` using `user_id = auth.uid()`.
  **Done when:** a member of clan A who owns a village in clan B reads both
  villages, and still reads ZERO rows of `clans`, `clan_roles`,
  `member_snapshots` and `wars` for clan B.

  **The R3 argument belongs in the migration header, in full, because the
  unfiltered axis is clan and the next reader will flag the file.** R3's substance
  is that a member must not see another clan's data; this returns only rows whose
  `user_id` is the caller, so the replacement filter is strictly NARROWER than the
  clan filter would have been. Permissive SELECT policies are OR-ed, so it only
  ever adds rows and 006's policy is untouched. `clanMovement()` in
  `repositories/members.ts` is the existing precedent and says the same thing in
  its own words — "NOT filtered to one clan, that is the point".
  **Rejected:** widening 006's policy to a join through `clan_roles`, so that
  owning a village in a clan implies reading that clan's players. That grows the
  CLAN set, which is the R3 violation this is not, and would hand a member the
  full roster of a clan nobody approved them into.
  `test/account-bases.test.ts` seeds two clans with identically shaped rows, so a
  leak shows up as a visible row rather than as an absence.

- [x] **T11.2 — Stop a second base re-routing the first one's approval** — `supabase/migrations/032_link_verified_player_v2.sql`
  `create or replace` of 016's function with two clauses added to one statement:
  `status = 'pending'` and `requested_clan_id is null`.
  **Done when:** linking a second village moves nothing on `users`, and a FIRST
  link still routes the applicant to that clan's leader.

  016 is untouched — a migration that has been applied is never edited (§4), and
  017/018 are the precedent for replacing a function forward. Each clause prevents
  a distinct failure: without `requested_clan_id is null` a still-pending member
  vanishes out of the queue of the leader already asked, silently; without
  `status = 'pending'` an approved account is redressed as an applicant in a clan
  it was never approved into, visible to a leader there and actionable by nobody,
  because `approve_account()` requires 'pending' and can never run twice.
  **The tests were confirmed to have teeth** by building a harness without 032 and
  watching the old behaviour appear — the same technique `migrations.test.ts`
  uses in *"the isolation tests have teeth"*.
  **Deliberately not fixed:** a pending member routed to the wrong clan cannot
  re-route themselves. Self-service re-routing is exactly the escalation 016's
  guard trigger closed, and re-opening it through this function gives the same
  capability by another door. **Deliberately absent:** any "primary base". Nothing
  in Phase 11 needs one; the shape if it is ever wanted is
  `users.primary_player_id`, owner-writable for free like `username`, and NOT a
  flag on `player_nicknames`.

- [x] **T11.3 — A member names their own base** — `supabase/migrations/033_player_nicknames.sql`
  A human-decision table (R11) with plain owner policies through
  `auth_owned_player_ids()`, and `revoke insert, update … from service_role`.

  **A table, not a column on `players`.** `players` is a game fact written only by
  sync jobs, and a session has SELECT on it and nothing else — 016 ships a
  verification query asserting `has_table_privilege('authenticated','players','update')`
  is FALSE. The rejected version is a `nickname` column plus an update policy
  narrowed by WITH CHECK, which hands a session write access to the game-fact table
  and then trusts an expression to keep it away from `name`, `clan_id` and
  `th_level`.
  **Plain policies, not a definer function**, per the recorded exception: rows a
  member owns with no clan use plain policies, because `audit_log`'s read policy is
  `clan_id in (select auth_leader_clan_ids())` and `null in (...)` is never true.
  023's `notification_preferences` is the precedent. The header works through
  denormalising a `clan_id` to make the audit row readable and rejects it — a
  base's clan CHANGES, so a copy is either stale or maintained by a sync job
  writing a human-decision table, which is the R11 bug itself.
  **Recorded hole:** nickname changes are not audited.
  **The unique index is FULL where 023's and 028's are partial**, and this is the
  load-bearing detail. ON CONFLICT cannot infer a partial index, so a partial one
  forces the two-statement dance 028 hides inside a definer function (028:173-175
  says so) — and from a Server Action that is a race the index then rejects when a
  member presses Save twice. Full, so setting a nickname is one idempotent upsert
  that also revives a cleared one.
  **`revoke … from service_role` is the operative line, not the narrow grant beside
  it.** 014 set `alter default privileges … grant select, insert, update on tables
  to service_role`, so every table created after it is BORN writable by the sync
  jobs. 024 records the same finding after a test caught it.

- [x] **T11.4 — One profile picture per account** — `supabase/migrations/034_user_avatar.sql`, `src/lib/auth.ts`
  `users.avatar_path`, and a sixth column on the read `(app)/layout.tsx` already
  issues on every navigation.

  **Per account, not per base**, and that is a decision: a member with three
  villages is still one person, and a face repeated three times down a list carries
  no information. What distinguishes the villages is T11.3's label.
  **Named `avatar_path`, not `avatar_url`.** `base_layouts.image_url` holds a path
  and is named url, and the cost is a paragraph at the top of
  `[clanTag]/layouts/page.tsx` explaining that its `image_url` is not a URL.
  Fixing forward means not repeating the name.
  No policy, which is 030's answer for 030's reason, restated in the migration
  because the next reader will look for one. The check constraint is SHAPE, not
  authorisation — it stops a full URL or a traversal being stored at all; the
  authorisation is 035's storage policy, enforced where the bytes are.
  `accountProfile()` grows a column rather than gaining a second read, which is the
  whole reason it is cheap.

- [x] **T11.5 — The avatars bucket** — `supabase/migrations/035_avatars_storage.sql`
  Private, 100 KB, `image/jpeg` only, paths `<user_id>/<uuid>.jpg`, SELECT and
  INSERT policies only. **LIVE-ONLY**, like 029.

  **THE POLICIES ARE NOT COVERED BY THE TEST SUITE** — PGlite has no `storage`
  schema — so the migration says so in its own header and carries a written-out
  verification block, exactly as 029 does. It is also absent from
  `supabase/apply-all.sql`, because that bundle is built from `PHASE1_MIGRATIONS`
  only; `npm run migrations:apply` covers both lists.
  Three differences from 029, each argued in the header so none reads as an
  oversight: the size limit is DERIVED from T11.7's 40 KB target rather than
  copied; the mime list is JPEG alone because `compressAvatar()` always re-encodes;
  and there is **no UPDATE policy**, because the object name is a fresh uuid every
  time, so changing a picture is an insert plus a pointer move.
  **Rejected:** a fixed `<user_id>/avatar.jpg` with `upsert: true`. It needs that
  UPDATE policy *and* can serve a stale body from an already-signed URL, which a
  member cannot tell apart from a failed upload.
  **Recorded hole:** reads are owner-only. Showing avatars to clanmates needs a
  policy letting one member sign another's object, which is a real disclosure
  surface and its own decision — 030's argument about usernames.

- [x] **T11.6 — The reads and writes behind "my bases"** — `src/repositories/account-bases.ts`, `src/lib/nickname.ts`
  `basesForUser`, `setNickname`, `clearNickname`, and the validator paired with
  033's constraint.

  **This is the one repository in the directory filtered by OWNER rather than by
  clan, and its header says so at length so nobody "fixes" it.** The subject is
  "the villages this member proved they own", which is not a clan-shaped question.
  The explicit `.eq("user_id", userId)` is still the mechanism; 031's policy is the
  net.
  Two flat queries in parallel rather than a PostgREST embed, because `README.md`
  says repository code avoids embeds (the PGlite shim has none) and the pair costs
  nothing — the reads are independent, so wall-clock it is one round trip. The
  nicknames read needs NO filter at all, which is the part worth noticing: 033's
  policy is already owner-scoped, so an unfiltered select returns exactly this
  member's labels. Its one predicate is `deleted_at`, and that is R4, not
  authorisation.
  `lib/nickname.ts` pairs with 033 the way `lib/account.ts` pairs with 030 — the
  constraint is enforced, this produces a sentence. **One difference from
  `account.ts`, stated there:** an empty submission means "clear it", not "too
  short", because a member who blanked the box did not make a mistake.
  Writes hand back the UNWRAPPED error rather than `error.message`, which is the
  one thing not copied from `layouts.ts`: `safeMessage()` and `isUniqueViolation()`
  both read a `{ message }` shape, and flattening forces the caller to choose
  between logging nothing and showing a member the RLS text.

- [x] **T11.7 — Avatar compression, in the browser** — `src/lib/avatar-image.ts`
  Imports `sniffImageType`, `fitWithin` and `ImageRejected` from
  `layout-image.ts`; adds `AVATAR_EDGE`, `AVATAR_TARGET_BYTES`, `squareCrop()`,
  `avatarPath()`, `compressAvatar()`.

  **Share the primitives, not the tuning.** The magic-byte allow-list is the
  security-relevant half of both pipelines, and two copies is one copy that gets a
  new format added and one that does not — there is a test asserting this module
  does not re-export its own `sniffImageType`, so the sharing cannot quietly become
  duplication. The NUMBERS are separate because the pictures are: a base layout
  stays legible enough to copy a placement off (1280px, 300 KB); an avatar renders
  at 32px in the rail (256px, 40 KB) and is square, which layouts never are.
  **Rejected:** threading the constants through an options bag. `upload-form.tsx`
  reads them and 029's bucket limit is derived from one, so moving them to the call
  site means the next caller invents a third pair and no file owns the answer.
  `squareCrop` is CENTRED. A top-anchored crop is what naive implementations do
  because it usually catches a face in a portrait photograph, and it cuts the head
  off every landscape one. There is no face detection here and should not be.
  `compressAvatar()` is untestable in `environment: "node"` — no jsdom, no canvas —
  so everything decidable without a browser is pure and tested, which is this
  repo's stated rule for `upload-form.tsx`.

- [x] **T11.8 — `/account`: who you are, and which bases are yours** — `(app)/account/page.tsx`, `src/lib/gate.test.ts`
  The dashboard: username and email, the picture, the list of villages with an
  inline label form each, and a link to add another.

  **At `/account` rather than `/settings/profile` because `/account` is in
  `GATE_EXEMPT` and `/settings` is not.** A PENDING member is exactly who most
  needs to add a base — linking one is what puts them in a leader's queue at all —
  so putting this under `/settings` would make it unreachable until after the thing
  it helps accomplish. Deliberately NOT in `SETUP_EXEMPT`, so a brand-new account
  still chooses a username first. `lib/gate.test.ts` now asserts both halves as one
  case, because that pair went from incidental to load-bearing.
  Structurally `settings/account/page.tsx`: `force-dynamic`, a module-level `PATH`,
  `fail()`/`done()`, inline server actions that re-acquire and re-validate, and a
  whole SENTENCE through `?ok=` which `messageFor()` passes through unchanged — so
  `lib/feedback.ts` needs no new codes.
  **The degraded row cannot name the clan, and says so rather than papering over
  it.** `clans` RLS returns no row for a clan the member holds no role in, so the
  app genuinely cannot name it, and that it cannot is the honest signal.

- [x] **T11.9 — Uploading the picture** — `src/components/avatar-form.tsx`, `(app)/account/page.tsx`
  Compress on pick, Storage first, pointer second.

  **The order is not the obvious one**, and it is `upload-form.tsx`'s argument
  verbatim: writing the pointer first leaves the column naming an object that does
  not exist if the upload fails, which renders as a broken image with nothing to
  distinguish it from a bug. This way the failure mode is an orphaned 40 KB object.
  Compression on PICK matters more here than for a layout, because the centred
  crop is a decision made FOR the member and they should get to look at it.
  The file input accepts all three types `sniffImageType` knows while the bucket
  allows `image/jpeg` alone — the asymmetry is deliberate and both ends say so.
  The server action re-validates that the path starts with the caller's own id: a
  Server Action is independently addressable and cannot assume what called it.

- [x] **T11.10 — The picture in the rail** — `(app)/account/avatar/route.ts`, `src/components/account-menu.tsx`, `(app)/layout.tsx`
  A GET route that signs the CALLER'S OWN `avatar_path` and 302s to it, with
  `Cache-Control: private`.

  **There is no id parameter, and that is the security design rather than an
  omission.** The usual shape — `/avatar?user=<id>` with a permission check — is
  one forgotten check away from serving any member's photograph to any other.
  035's policy is the second layer underneath.
  **Rejected:** minting the signed URL in `(app)/layout.tsx`. That adds a Storage
  round trip to every navigation in the product to render a 32-pixel circle, which
  is exactly the cost T10.9 spent a phase removing from that file. The menu takes a
  BOOLEAN and points at a fixed path instead. `max-age` is deliberately a minute
  under the signature TTL, so a cached redirect can never outlive what it names.
  **Also rejected:** a public bucket, which needs no route and serves every face to
  anyone who ever sees a URL.
  The picture goes BESIDE the name, replacing the generic icon and nothing else —
  `account-menu.tsx` already argues that the name must stay the label, and two
  accounts belonging to one person tend to carry the same face. "Account" is
  renamed **"Sign-in and password"**, which is what that page does; "Account" and
  "My bases" a line apart is a menu you have to guess at.

- [x] **T11.11 — Extract the report so two pages cannot drift** — `src/repositories/player-report.ts`, `src/components/player-report-sections.tsx`, `[clanTag]/player/[tag]/page.tsx`
  The seven reads and the six panels, lifted out of the profile page unchanged.
  **Done when:** `/[clanTag]/player/[tag]` renders what it rendered before.

  Two copies of a six-read batch and five derivations is two pages that eventually
  disagree about what "missed" means — the failure this document keeps recording,
  most recently as a "Not built yet" panel three sections below a working link.
  `WAR_WINDOW`'s own comment, *"the same window /war/report uses, so the two pages
  never show different totals"*, becomes MORE true with a third caller, and that is
  the argument for moving it.
  A **repository** because it is queries; `services/README.md` draws the line at
  "anything that is a calculation rather than a query", and the calculations stay
  where they were. **Not** in `members.ts`, which would double in size while
  importing five sibling repositories. `clanId` stays an explicit parameter so R3 is
  visible at every call site.
  **Rejected:** redirecting `/account/bases/[tag]` to the profile page. It works
  only for bases in clans the member has a role in, so the degraded case becomes a
  redirect that 404s, and it loses the "my base" framing, which is the feature.
  **The plan assumed this was untestable and the plan was wrong.**
  `vitest.config.ts` includes `.ts` only and there is no jsdom, which reads like
  "no component tests" — but `components/toaster.test.ts` already renders a `.tsx`
  component from a `.ts` file with `renderToStaticMarkup`, and these sections have
  no state and no effects. 22 tests now cover every panel, every empty state, the
  movement table's more-than-one-clan rule, the newest-month-first ordering, and
  that an empty report renders SENTENCES rather than a plausible-looking "0 of 0".
  The comments that recorded the wrong assumption are corrected rather than left.

- [x] **T11.12 — The per-base report a member can reach without a clan role** — `(app)/account/bases/[tag]/page.tsx`
  The same report, authorised by ownership.

  **Authorisation is `basesForUser()`, NOT `requireClanByTag()`, and that is the
  whole point.** `requireClanByTag()` answers "is this one of the clans you hold a
  role in", which would 404 exactly the village this page exists to show. 404
  rather than 403 for a tag the member does not own, matching
  `requireClanByTag()`'s recorded reasoning: the candidate list is already
  caller-restricted, so a distinguishable "forbidden" would confirm which tags are
  real.
  **The degraded branch is ONE panel, not six empty ones.** Everything a report
  reads is still clan-filtered — 031 deliberately did not widen that — so for a
  village outside the member's clans there is genuinely nothing to read, and six
  sections each saying "no data" is the shape that let a dashed "Not built yet" box
  survive a whole phase unread. The report's seven queries live in a child
  component so the degraded path never issues them at all.

- [x] **T11.13 — Adding a second base from inside the app** — `(auth)/verify/page.tsx`, `(app)/pending/page.tsx`, `src/components/account-menu.tsx`
  `/verify` reads `?next=` through `safeNext()`; `/pending` redirects an approved
  member to `/account`.

  `safeNext()` returns `"/"` rather than null for anything it rejects, so the
  fallback is spelled out: a bare `safeNext(...) ?? "/pending"` would send every
  first-time member to the dashboard and let the gate bounce them — the same page
  via two redirects and a wrong-looking URL.
  **`/pending` redirecting is a fix, not a feature.** Nothing sent an approved
  member there before Phase 11; `/verify`'s Continue did, and the member landed on
  a page headed "Waiting for approval" immediately after successfully adding a
  base, which reads as the second base having un-approved them. A redirect rather
  than an inline "you are approved" panel: a page whose `<h1>` says the opposite
  cannot be patched into saying it without reading as a bug. The layout's gate
  cannot do this, because `/pending` is in `GATE_EXEMPT` precisely so an unapproved
  member can reach it, and exemption is not direction-aware.
  **Rejected:** moving `/verify` into `(app)`. It is gate-exempt but NOT
  setup-exempt, so moving it puts a brand-new account's first action behind
  `/account/setup` — reordering the most fragile path in the product to add a
  feature. **Also rejected:** a second in-app form, which means two copies of the
  anti-phishing warning that `(auth)/verify/page.tsx` says IS the page.
  Rate limiting is untouched at 5/hour/user. A member adding four villages in one
  sitting spends four of five, which is fine and should not be raised.

- [x] **T11.14 — Write Phase 11 down** — `IMPLEMENTATION.md`, `Architecture.md`
  This block, the §0 ledger entry, the §5 tree, and the §5B rows.

  Also corrects the §5 tree, which stopped at migration 027 while 028, 029 and 030
  existed — and states plainly why `src/types/database.ts` being stale does not
  break `typecheck` (no `Database` generic is passed to either Supabase client, and
  nothing imports the generated file), because "it type-checks anyway" is a fact
  worth knowing and a bad reason to leave it.
  `Architecture.md` gains **§7.4 The multi-base identity model**, hooked off §7.1's
  ten-phase-old promise, so the next reader finds the reasoning beside the identity
  diagram rather than only in a migration header. §1B's human-decision table list
  gains `player_nicknames`, because that list is where a reader checks R11.
  One thing noted rather than fixed: **Phase 10's heading is `##` where every other
  phase block is `#`.** Phase 11 and 11B use `#`, matching Phases 0–9. Changing
  Phase 10's would renumber nothing and alter no content, but it would put a
  cosmetic edit to a finished block in a commit about something else, and the
  inconsistency is more useful recorded than quietly tidied.

**Outstanding after Phase 11, all of it needing something outside the repo:**

- **Apply 031–035 to the live database**, then re-run `npm run types:db` — which
  clears 030's outstanding item at the same time. `npm run migrations:apply`
  covers both lists. **If the `apply-all.sql` paste path is used instead, 035 is
  not in it** and must be run separately.
- **Confirm the `avatars` bucket** in the Supabase dashboard after 035: private,
  100 KB, `image/jpeg`, and exactly the two policies. The suite cannot reach any of
  that.
- **Walk the manual script once against a real member with two villages.** The
  cross-clan case is the one no test can stand in for, because it needs a village
  in a clan the member holds no role in — and the assertion that matters is that
  the row shows a tag and a town hall level and **no clan name**.

---

# Phase 11B — How far along each base actually is

*A clash.ninja-style view of a village: every hero, pet, troop, siege machine and
spell against the cap for its Town Hall, and — from a pasted in-game export —
buildings, walls, traps and running timers.*

Phase 11 answers "what has this village DONE" from data the product already had.
This one answers "how far along is it", which is the half members actually compare
with each other, and the reason clash.ninja exists.

**Two ways in.** Every base on `/account` has a **Base details** button, and so does
its report. Leaders and co-leaders get the same button on a member's profile. The
page defaults to what the daily sync stored; the owner — and only the owner — can
also **paste their village export** to add buildings and timers, which is read in
the browser and never leaves it.

## The plan was built on a wrong premise, and it is corrected here

The first draft of this block said *"the API's `maxLevel` is already this player's
TH-relative maximum, so completion is TH-relative for free"*, and rejected a Town
Hall cap table as game knowledge R1 and R7 keep out of the codebase.

**It is not.** `fixtures/player.json` is a real TH17 capture whose Barbarian King
reads `100/110`, super troops `1/9` and pets `10/15`. `maxLevel` is the game's
ceiling. Built as planned, every base below the highest Town Hall would have read
as behind — and nothing would have reported it, because every figure would have
been plausible. `mappers.test.ts` now pins the fact so it cannot be re-assumed.

So there IS game data now (`src/data/game/`), and the rejection is withdrawn rather
than quietly ignored. It is **generated**, not typed: `scripts/game-data.ts` reads
two MIT-licensed datasets derived from the game files, at pinned versions, and
refuses to write if they disagree about any id. The real TH17 fixture is the
independent check — `game-data.test.ts` asserts no unit on it sits above its cap.

## Tasks

- [x] **T11B.1 — Capture what the player endpoint already sends** — `src/integration/coc-schemas.ts`
  `unitSchema`, `heroEquipmentSchema`, `heroSchema`; `troops`, `heroes`,
  `heroEquipment`, `spells` as `.default([])`, and the hall and trophy fields.
  `looseObject` throughout; `league` untouched.

- [x] **T11B.2 — Map it without letting a raw name out** — `src/integration/mappers/index.ts`, `src/types/domain.ts`
  `mapPlayerProgress()` → `PlayerProgress`, each unit `{ name, level, apiMax, village }`.
  **Named `apiMax`, not `maxLevel`,** because the obvious name carries the wrong
  assumption. A separate function from `mapPlayer()`, which clan-games calls once
  per member for one achievement value. It translates and does not classify.

- [x] **T11B.3 — Town Hall caps and unit groups, as generated data** — `scripts/game-data.ts`, `src/data/game/`
  Caps at every hall level, the group of every unit (the API cannot tell a pet or a
  siege machine from an Archer), and the numeric ids the export uses.
  **Builder Base troop caps are indexed by Builder Barracks level, not Builder Hall
  level** — the source arrays are 12 long against 10 halls — so they are translated
  through the barracks cap at each hall; without that a BH10 Raged Barbarian caps
  at 16 instead of 20. `resolveUnit()` falls back to `apiMax` with `capKnown: false`
  when a unit is newer than the data, the hall is unknown, or the player is ABOVE
  the data's cap — which can only mean the data is stale. The README says how to
  refresh it.

- [x] **T11B.4 — A daily progression snapshot** — `supabase/migrations/036_player_progress.sql`
  One row per village per UTC day, `units` as a jsonb array. **The cap applied at
  capture is stored with each level**, so refreshing the game data never re-scores
  history — the first draft's argument for storing maxima, kept.
  RLS is 006's clan policy OR 031's owner policy; `clan_id` is nullable because an
  owned village may have left every platform clan. SELECT to sessions, INSERT only
  to the sync role, and **UPDATE and DELETE revoked from it** — 014's default
  privileges would otherwise grant them. `sync_log.job_type` learns `players`.
  `test/player-progress.test.ts` asserts each of those.

- [x] **T11B.5 — The players sync** — `scripts/sync/players.ts`
  **Clan members AND every owned village**, deduplicated. The first draft read clan
  members only, which would have left the details page of any base outside the
  three clans empty forever. An owned village that has left the platform is filed
  under `clan_id = null`, so the clan it left stops receiving its readings. Units a
  hall allows but the player has not unlocked are stored at level 0
  (`lockedUnits()`), except equipment, which is collected rather than unlocked.
  The test stubs `fetch` per tag, because the fixture path maps every player to one
  file.

- [x] **T11B.6 — Put it on a schedule and watch it** — `.github/workflows/sync-players.yml`, `scripts/sync/health.ts`, `src/services/freshness.ts`, `test/cwl-services.test.ts`
  Daily at 06:11 UTC, in its own workflow (about 30 Actions minutes a month). All
  three watch lists changed in one commit.

- [x] **T11B.7 — What progress and being behind mean** — `src/services/progress.ts`
  Levels against caps, **summed**, not units maxed; floored, so 100% only ever means
  capped. Super troops are not counted — their level is the base troop's.
  `behindPreviousHall()` is the clash.ninja definition of rushed, **without the
  word**, following `needsAttention()`'s rule. `upgradesBetween()` keys by village
  AND name, because there are two Baby Dragons.

- [x] **T11B.8 — The reads** — `src/repositories/player-progress.ts`
  `baseProgress()`: the newest reading and the oldest inside 30 days. **The scope is
  a required `{ clanId } | "owner"`**, not an optional `clanId`, so dropping the clan
  filter has to be written at the call site rather than happen by omission.

- [x] **T11B.9 — The panels** — `src/components/base-details.tsx`, `src/components/ui/progress.tsx`
  Shared by both pages, like `player-report-sections.tsx`. The Home / Builder Base
  switch is a `?village=` link, not client state. Units whose cap is only the game
  maximum carry an asterisk and an explanation.

- [x] **T11B.10 — The pages and the buttons** — `(app)/account/bases/[tag]/details/page.tsx`, `(app)/[clanTag]/player/[tag]/details/page.tsx`
  The owner page is gated by `basesForUser()` **with no degraded branch** — unlike
  the report, progress is readable by ownership, so its button on `/account` shows
  for every base. The leader page is gated by `hasRole(clan.role, "co-leader")` →
  `notFound()`, and the profile shows the button only to whoever passes that gate.

- [x] **T11B.11 — Read a pasted village export** — `src/integration/village-export.ts`, `src/services/village.ts`, `src/types/village.ts`
  The in-game Data Export has no published schema, so its shape was **confirmed
  against two production parsers** (clashcwl.com, clashwatcher.com) rather than
  guessed, and every row field but `data` is optional. `timer` is seconds left AT
  the export's `timestamp`, and is counted down from there. Buildings are
  aggregated per type and summed per instance.

- [x] **T11B.12 — The paste button** — `src/components/village-export-paste.tsx`, `src/components/village-export-view.tsx`
  Owner page only. **Parsed in the browser: no fetch, no server action, no storage,
  no table.** R11 — a table written by pasting would be a game-fact table with a
  human writer. The export's tag must match the base. The parser and ~60 KB of game
  data load on the first "Show details", not with the page.

- [x] **T11B.13 — Write Phase 11B down** — `IMPLEMENTATION.md`, `Architecture.md`

**Outstanding after Phase 11B, all of it needing something outside the repo:**

- **Apply 036 to the live database** (`npm run migrations:apply`, or the
  `apply-all.sql` bundle — 036 IS in it), then `npm run types:db`.
- **Run the players sync once by hand** (Actions → sync-players → Run workflow, or
  `npm run sync:players` locally with `USE_FIXTURES=false`). Until it has run,
  every details page shows its empty state.
- **Capture a real village export** into `fixtures/`, scrubbed, and build
  `village-export.test.ts` on it. The inline exports there use only confirmed field
  names, but `fixtures/README.md` is right that a guessed shape is the one a parser
  is wrong about.
- **Building counts per Town Hall** ("7 of 7 cannons") are not generated — see the
  known gaps in `src/data/game/README.md`.
- **After each game update, `npm run game-data`** once the two sources publish it.

---

# Phase 11C — A base's CWL record follows it across the family's clans

*A village's CWL history is the village's, not the clan's it happens to be in now.*

**Found on a real base.** SK FLASH (`#GJUUGRVCU`) played 14 CWL wars and made 13
attacks across 2026-08 and 2026-09 — every one of them in **DH CWL ONLY**, the
family's CWL clan — and now lives in **Dark Hell**. Its report said *"No CWL record
for this member in Dark Hell yet."* That sentence was true and completely
misleading, and it had two causes, either of which alone would have produced it:

1. **The read asked one clan.** `playerReport()` → `playerSeasonHistory(clanId)` →
   `seasonHistoryForClan(clanId)` walked only the current clan's `cwl_seasons`. The
   data was intact — `players.tag` is unique, so `cwl_war_members.player_id` still
   points at the same row after a move — and was simply never asked for.
2. **RLS would have hidden it anyway.** 006's and 019's CWL policies admit a season
   only to a viewer holding a role in the clan that owns it, and the owner's only
   `clan_roles` row was Dark Hell. (The "co-leader" badge on the page is the
   in-game rank, not an app role.)

The same per-clan read fed the roster builder's **Last CWL** column and the members
page's **needs-attention** list, so a member who plays CWL in the CWL clan read as
having no CWL record on every page a leader decides from.

**Decision: family-wide visibility.** Anyone holding a role in any platform clan may
see any village's CWL season totals from every platform clan. **That is a
deliberate R3 exception**, and it is made as narrowly as it can be.

- [x] **T11C.1 — `family_cwl_history()`** — `supabase/migrations/037_family_cwl_history.sql`
  A definer function returning, per requested player, per clan, per season: the
  clan's id, tag and name, wars rostered, attacks used, stars. **Nothing else** — no
  opponents, results, destruction, positions, or any other player.
  **Rejected: widening the four CWL tables' policies**, which would hand every member
  every clan's entire CWL tree to render four numbers. The tables' own policies are
  untouched; the test asserts a member still reads zero of another clan's
  `cwl_seasons`, `cwl_wars`, `cwl_war_members` and `cwl_attacks` directly.
  It answers a caller with any clan role; a caller with none only for their own
  villages (031's `auth_owned_player_ids()`); the service role; and nobody else.
  At most 500 players per call. Its semantics are the walk it replaced: driven from
  the roster, an off-roster attack not counted, soft-deleted rows ignored, newest
  season first.

- [x] **T11C.2 — `familyCwlHistory()`** — `src/repositories/cwl.ts`, `test/pglite-supabase.ts`
  One round trip for any number of players, in `cache()`. The shim learned to pass a
  JS array as a Postgres array parameter — it had been rendering it as JSON, which
  `uuid[]` rejects. `test/family-cwl-history.test.ts` (the guard, the leak check,
  the arithmetic) landed in this commit rather than as its own T11C.6.

- [x] **T11C.3 — The report** — `src/repositories/player-report.ts`, `src/components/player-report-sections.tsx`
  CWL is now the one family-wide read in the bundle; the other five stay on `clanId`.
  The panel gains a **Clan** column; a season links to its clan's CWL page only when
  the reader can open that clan, and is plain text otherwise, so nobody is handed a
  404. The empty state names no clan, because naming one is the misreading this
  phase ended.

- [x] **T11C.4 — The roster builder** — `(app)/roster/[season]/page.tsx`
  One `familyCwlHistory()` for the whole pool instead of a history per clan. Last CWL
  is the newest season from any clan, with "in DH CWL ONLY" beneath it when that was
  not the member's own clan.

- [x] **T11C.5 — The members page, and the per-clan history goes** — `[clanTag]/members/page.tsx`, `src/repositories/cwl.ts`
  needs-attention totals are family-wide. `seasonHistoryForClan()` and
  `playerSeasonHistory()` had no callers left and are removed; their pinned
  expectations were rewritten against `familyCwlHistory()` in
  `test/cwl-history-repo.test.ts` first, and pass against the SQL.

- [x] **T11C.6 — Tests for the function** — folded into T11C.2; see above.

- [x] **T11C.7 — Write Phase 11C down** — `IMPLEMENTATION.md`, `Architecture.md` §7.3

**Outstanding after Phase 11C:**

- **Apply 037 to the live database** (`npm run migrations:apply`, or the
  `apply-all.sql` bundle, which includes it). Until then the report, the roster and
  the members page all fail soft: `familyCwlHistory()` treats an error as "no
  history", so they show no CWL rather than crash.
- **Check SK FLASH once it is applied:** its report should list 2026-09 and 2026-08
  under DH CWL ONLY, 14 wars and 13 attacks in all.
- **Clan movement and the other five report panels are unchanged** — still confined
  to clans the reader holds a role in. Only CWL was asked for.

---

## 5B. Coverage check

Every requirement traced to the tasks that deliver it. Use this to confirm nothing was dropped.

| Requirement | Module | Tasks |
|---|---|---|
| Identity, verification, roles | M1 | T3.1–T3.9 |
| **A member's own villages, in one place** | **M1** | **T11.1–T11.14** |
| Clan directory, donations, activity | M2 | T2.9, T3B.1–T3B.6 |
| **Per-base report, reachable by its owner** | **M2** | **T11.11, T11.12** |
| **CWL record follows the player across the family's clans** | **M3** | **T11C.1–T11C.7** |
| **Upgrade progress per Town Hall, and the village export** | **M2** | **T11B.1–T11B.13** |
| CWL tracking and history | M3 | T4.1–T4.8 |
| **Polls before CWL and war** | **M10** | **T4B.1–T4B.5, T6.7** |
| **Leader selects the roster per clan** | **M10** | **T4B.6–T4B.10, T6.8** |
| **Contribution shown after CWL and war** | **M10** | **T4B.11–T4B.13, T6.9, T6.10** |
| **Rosters and reports kept as history** | **M10** | **T4B.14** |
| Bonus medals with justification | M3 | T4.7, T4B.13, T9.6 |
| ~~Logbook history preserved~~ | M3 | ~~T0.13, T4.10~~ — **dropped by decision** |
| Clan war planning and results | M4 | T6.1–T6.10 |
| Raid Weekend | M5 | T7.1–T7.3 |
| Clan Games | M6 | T7.4–T7.5 |
| Base layout library | M7 | T8.1–T8.5 |
| Announcements | M8 | T5.1–T5.2 |
| Notifications without a bot | — | T5.3–T5.9 |
| Three clans in one platform | — | T1.9, T3.6, T3B.6, T4B.7, T9.1 |
| Admin and sync health | M9 | T4.8, T5.8, T9.2, T9.6 |
| Zero hosting cost | — | Stack in section 3 |
| Security and access control | — | T1.9, T3.7, T3.8, T9.3, T9.7 |
| Data never lost | — | T2.8, T9.4, R4, R5 |
| Supercell compliance | — | T0.12, T9.8 |

### Objectives

| # | Objective | Delivered by |
|---|---|---|
| O1 | CWL captured automatically | T4.1, T4.2 |
| O2 | Logbook eliminated — **forward-looking only** | T4.1–T4.8 (T4.10 dropped) |
| O3 | Single view across three clans | T9.1, T3B.6 |
| O4 | Any member's six-month history in 30 seconds | **T3B.4**, T11.11, T11.12 |
| O5 | Base layouts searchable | T8.4 |
| O6 | Zero recurring cost | Section 3 |
| O7 | Member data protected | T3.7, T3.8, T9.3, **T11.1** |

Two of those additions want a sentence each. **O4** gains T11.11 and T11.12 because
extracting the report is what makes the same thirty-second promise hold on a second
surface — a member asking it about their own village, rather than only a leader
asking it about somebody else's. **O7** gains T11.1 because widening a SELECT
policy is precisely the kind of change that objective exists to have an opinion
about, and the answer is that it narrows rather than widens: the filter it adds is
`user_id = auth.uid()`, and `test/account-bases.test.ts` asserts that every other
table still returns zero rows for a clan the member was never approved into.

---

## 6. Definition of done

A task is not finished until all of these are true:

- [ ] `npm run typecheck`, `npm run lint` and `npm test` all pass — CI runs these
- [ ] Runs locally with `USE_FIXTURES=true`
- [ ] Every database query filters by clan
- [ ] RLS policy exists for any new table
- [ ] No `DELETE` statements — soft delete only
- [ ] Sync jobs are idempotent — run twice, verify nothing changed
- [ ] `sync_log` written on start and finish
- [ ] No secrets in code, logs, or Vercel
- [ ] Committed with the task ID in the message

---

## 7. Pitfalls that will cost you a day each

| Symptom | Cause |
|---|---|
| `403 accessDenied` | Key IP does not match. Your home IP changed, or you are on a VPN |
| `404` on a valid tag | `#` not encoded as `%23` |
| `Invalid Date` everywhere | Using `new Date()` on Supercell's timestamp format. Use `lib/coc-time.ts` |
| Sync job fails 3 weeks a month | Treating a missing CWL group as an error instead of a normal state |
| Duplicate attack rows | Missing unique constraint, so `ON CONFLICT` does nothing |
| Sync times out on Vercel | Sync jobs must run on GitHub Actions (R2) |
| Member sees another clan's data | Missing clan filter. Check RLS first, then the service query |
| Site offline after a quiet week | Supabase free tier suspended. The daily job normally prevents this |
| CWL data missing for a day | Job failed silently. This is what `sync_log` and T4.8 exist to catch |

---

## 8. Working with an AI assistant

You are building this with AI assistance. It is good at features and unreliable at authorisation.

**What it gets right:** components, forms, styling, mapping functions, SQL syntax, workflow files.

**What it gets wrong, repeatedly:**

- Omits the clan filter from queries (R3)
- Writes `DELETE` instead of soft delete (R4)
- Calls the Clash of Clans API from a page or route handler (R1)
- Puts sync logic in a Vercel route (R2)
- Treats `notInWar` as an error (R10)
- Suggests storing the player API token "for later" (R8)
- Merges the leader's roster into the API roster table to "avoid duplication" (R11, R12)
- Lets a sync job update a table holding human decisions (R11)

**Practice:**

1. Paste section 2 into the assistant at the start of each session
2. Give it one task ID at a time, not a whole phase
3. Read every database query yourself before merging — look for the clan filter and the role check
4. Never accept a migration you have not read line by line

RLS is your safety net for the ones you miss. It is not a substitute for reading the queries.

---

## 9. Order matters

Phases 1 and 2 produce nothing anyone can see. Building them first will feel like wasted time.

It is not. Phase 4 — the CWL module your friend actually wants — takes days instead of weeks because of them, and T2.8 is the only thing standing between you and permanently losing data that no one can re-fetch from anywhere.

Start at T0.1.