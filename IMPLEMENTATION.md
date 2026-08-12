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
and T9.10 done apart from the parts that wait on a deployment.

**Every phase in this document is now complete except T9.4 (restore test) and
the deployment-side half of T9.3.** Both need something outside the codebase: a
scratch Supabase project to restore into, and a Vercel deployment to inspect.
Phase 8 is placeholders that name their own task ID.

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
│   └── make-icons.ts        T5.3  writes public/icons/ — no image dependency
│
├── scripts/sync/
│   ├── shared.ts            T2.5  sync_log helpers (R9) + T5.8 failure alert
│   ├── alerts.ts            T5.8  who is told, and what counts as stale
│   ├── health.ts            T5.8  the watchdog. Nothing reports its own absence
│   ├── clans.ts             T2.6 + T2.9 + T3.9
│   ├── cwl.ts               T4.1
│   ├── war.ts               T6.1
│   ├── raids.ts             T7.1
│   └── clan-games.ts        T7.4
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
│       └── 027_raid_detail.sql        T7.1/T7.4  raid rewards + attack limits,
│                                             clan_games.settled_at. Written BEFORE
│                                             the sync, unlike 019/020/026
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
    │   │   │   ├── polls/             T4B.2-4
    │   │   │   ├── cwl/               T4.4, T4.5, T4B.10-13  (T4.10 dropped)
    │   │   │   ├── war/               T6.3-6.6, T6.8-6.10
    │   │   │   ├── raids/  games/     T7.3, T7.5
    │   │   │   ├── layouts/           T8.2-8.4
    │   │   │   └── notices/           T5.1
    │   │   ├── settings/notifications/  T5.5 + T5.9  device on/off, and kinds
    │   │   └── admin/                 T9.2, T9.6
    │   └── api/
    │       ├── verify/route.ts            T3.3
    │       └── push/subscribe/route.ts    T5.5
    │
    ├── components/
    │   ├── push-toggle.tsx  T5.5  asks permission on a click, never on load
    │   ├── data-freshness.tsx  T4.8
    │   └── ui/              shadcn copies land here
    │
    ├── integration/         R7 — raw API shapes stop here
    │   ├── coc-client.ts    T2.3
    │   ├── coc-schemas.ts   T2.2  zod, one per endpoint
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
    │   └── utils.ts         cn() for shadcn
    │
    ├── repositories/        T4.3 onward — every query filters by clan (R3)
    ├── services/            derived values: missed attacks, donation deltas
    └── types/
        ├── database.ts      generated from Supabase
        └── domain.ts        internal types (R7)
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

## 5B. Coverage check

Every requirement traced to the tasks that deliver it. Use this to confirm nothing was dropped.

| Requirement | Module | Tasks |
|---|---|---|
| Identity, verification, roles | M1 | T3.1–T3.9 |
| Clan directory, donations, activity | M2 | T2.9, T3B.1–T3B.6 |
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
| O4 | Any member's six-month history in 30 seconds | **T3B.4** |
| O5 | Base layouts searchable | T8.4 |
| O6 | Zero recurring cost | Section 3 |
| O7 | Member data protected | T3.7, T3.8, T9.3 |

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