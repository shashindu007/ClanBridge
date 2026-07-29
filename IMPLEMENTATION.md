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

### R6 — Secrets never reach Vercel

`COC_API_TOKEN` and `SUPABASE_SERVICE_KEY` live only in GitHub Actions secrets and your local `.env.local`.

If either appears in a Vercel environment variable, the architecture has drifted. The web app has no reason to hold them.

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
│   ├── sync-clans.yml       T2.7  hourly
│   ├── sync-cwl.yml         T4.2  every 2h
│   ├── sync-war.yml         T6.2  every 15m
│   ├── sync-raids.yml       T7.2  daily
│   └── backup.yml           T2.8  weekly pg_dump
│
├── fixtures/                T2.1  captured API responses, for USE_FIXTURES
│   └── clan · currentwar · cwlgroup · cwlwar · capitalraids · player .json
│
├── public/
│   ├── manifest.json        T5.3
│   ├── sw.js                T5.4
│   └── icons/
│
├── scripts/sync/
│   ├── shared.ts            T2.5  sync_log helpers (R9)
│   ├── clans.ts             T2.6 + T2.9 + T3.9
│   ├── cwl.ts               T4.1
│   ├── war.ts               T6.1
│   ├── raids.ts             T7.1
│   └── clan-games.ts        T7.4
│
├── supabase/
│   ├── seed.sql             T1.10  the three clans
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
│       └── 012_war_lineups.sql        T6.8
│
├── test/                    QA — runs the migrations against real Postgres (PGlite)
│   ├── pg-harness.ts
│   └── migrations.test.ts
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
    │   │   │   ├── cwl/               T4.4, T4.5, T4.10, T4B.10-13
    │   │   │   ├── war/               T6.3-6.6, T6.8-6.10
    │   │   │   ├── raids/  games/     T7.3, T7.5
    │   │   │   ├── layouts/           T8.2-8.4
    │   │   │   └── notices/           T5.1
    │   │   └── admin/                 T9.2, T9.6
    │   └── api/
    │       ├── verify/route.ts            T3.3
    │       └── push/subscribe/route.ts    T5.5
    │
    ├── components/ui/       shadcn copies land here
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

- [ ] **T0.1 — Confirm war logs are public**
  All three clans, in game, Clan Settings. If private, the API returns 403 and the war module cannot work at all.

- [ ] **T0.2 — Record the three clan tags**
  Write them into a scratch file. Uppercase, with the hash.

- [ ] **T0.3 — Create a Clash of Clans developer account**
  `https://developer.clashofclans.com`. Separate from your game login. Check spam for the confirmation email.
  *If the site will not load:* try mobile data instead of WiFi, set DNS to `1.1.1.1`, try incognito. Turn off any VPN — if you register the key against a VPN IP it will fail once you disconnect.

- [ ] **T0.4 — Create the development API key**
  IP address = your current public IP. Save the token in a password manager.

- [ ] **T0.5 — Create the production API key**
  IP address = the RoyaleAPI proxy IP. Check the current value at `docs.royaleapi.com/proxy` before entering it.

- [ ] **T0.6 — Test the key**
  ```bash
  curl -H "Authorization: Bearer $TOKEN" \
    "https://api.clashofclans.com/v1/clans/%232PP0JCCL"
  ```
  `403` means the IP does not match. `404` means the tag is wrong. The `#` must be `%23`.

- [ ] **T0.7 — Create the Supabase project**
  Region closest to Sri Lanka. Save the project URL, anon key, and service role key.

- [ ] **T0.8 — Create a private GitHub repository**

- [ ] **T0.9 — Create the Upstash Redis database**
  Save the REST URL and token.

- [ ] **T0.10 — Generate VAPID keys**
  ```bash
  npx web-push generate-vapid-keys
  ```

- [ ] **T0.11 — Ask the clan leader four questions**
  May a leader of clan A view clan B's data? (Recommend yes.)
  What is the rule for allocating bonus medals?
  How does a new member get an account — invite only, or open signup? (Recommend invite only.)
  When a member leaves a clan, should their history stay visible?

- [ ] **T0.12 — Read Supercell's Fan Content Policy**
  The platform must display a disclaimer that it is not affiliated with or endorsed by Supercell, and must not be monetised. The API key is issued for non-commercial use only. Note the exact wording required — it goes in the footer at T9.8.

- [ ] **T0.13 — Photograph the existing logbooks**
  Before anything else, capture every page of the handwritten CWL records. This is the only copy of that history, and T4.10 imports it. Do it now, not when you get to phase 4.

---

# Phase 1 — Foundation

*Builds nothing visible. Makes everything after it fast.*

- [ ] **T1.1 — Initialise the project**
  ```bash
  npx create-next-app@latest clanbridge --typescript --tailwind --app --src-dir
  ```
  Set `"strict": true` in `tsconfig.json`. Commit.

- [ ] **T1.2 — Install dependencies**
  ```bash
  npm i @supabase/supabase-js @supabase/ssr zod date-fns date-fns-tz
  npm i @tanstack/react-query @upstash/ratelimit @upstash/redis web-push
  npm i -D tsx @types/web-push
  ```

- [ ] **T1.3 — Environment files**
  Create `.env.local` and `.env.example`. Confirm `.env.local` is in `.gitignore` before the first commit.
  Variables: see section 8 of the architecture document.
  **Done when:** `git status` never shows `.env.local`.

- [ ] **T1.4 — Migration 001: core tables**
  `clans`, `users`, `players`, `clan_roles`.
  Every table gets `id`, `created_at`, `deleted_at`.
  Unique constraint on `players(tag)`.

- [ ] **T1.5 — Migration 002: CWL tables**
  `cwl_seasons`, `cwl_wars`, `cwl_attacks`, `cwl_bonuses`.
  **Critical:** unique constraint `cwl_attacks(war_id, player_id, attack_order)`. This is what makes sync idempotent (R5).

- [ ] **T1.6 — Migration 003: war tables**
  `wars`, `war_targets`, `war_attacks`.
  Unique constraint `war_attacks(war_id, player_id, attack_order)`.
  Keep `war_targets` (the plan) separate from `war_attacks` (what happened). Never merge them.

- [ ] **T1.7 — Migration 004: remaining tables**
  `raid_seasons`, `raid_participants`, `clan_games`, `clan_games_scores`, `base_layouts`, `announcements`, `push_subscriptions`.

- [ ] **T1.8 — Migration 005: operational tables**
  `sync_log`, `audit_log`.

- [ ] **T1.9 — Migration 006: RLS**
  ```sql
  create function auth_clan_ids() returns setof uuid
  language sql stable security definer as $$
    select clan_id from clan_roles where user_id = auth.uid()
  $$;
  ```
  Enable RLS on every table with clan data and write a select policy for each.
  **Done when:** with the anon key and no session, every table returns zero rows.

- [ ] **T1.10 — Seed the three clans**
  Insert the three clan rows with real tags.

- [ ] **T1.11 — Supabase clients**
  `lib/supabase/server.ts`, `client.ts`, `middleware.ts`, and a separate `admin.ts` using the service key — used only by `scripts/`.

- [ ] **T1.12 — `lib/tags.ts`**
  `normaliseTag()` uppercase with hash; `encodeTag()` hash to `%23`. Unit test both.

- [ ] **T1.13 — `lib/coc-time.ts`**
  Parse `20260729T063000.000Z` to a `Date`. Unit test it. This format breaks `new Date()` and will silently produce `Invalid Date` if you skip this.

---

# Phase 2 — API client and first sync

- [ ] **T2.1 — Capture fixtures**
  Save real responses to `fixtures/`: `clan.json`, `currentwar.json`, `cwlgroup.json`, `cwlwar.json`, `capitalraids.json`, `player.json`.
  Capture a CWL fixture during an actual CWL week — that is the first week of the month only.

- [ ] **T2.2 — Zod schemas**
  `integration/coc-schemas.ts`, one schema per endpoint, written against the fixtures.

- [ ] **T2.3 — The API client**
  `integration/coc-client.ts`:
  - Base URL from `COC_API_BASE`
  - 10 second timeout with `AbortController`
  - Retry with backoff on 429 and 5xx only — never on 403 or 404
  - 200 ms delay between calls
  - Parse every response through Zod
  - Named errors: `CocAuthError`, `CocNotFoundError`, `CocRateLimitError`, `CocPrivateLogError`
  - `USE_FIXTURES=true` reads from `fixtures/` instead of the network
  **Done when:** the whole client works offline with `USE_FIXTURES=true`.

- [ ] **T2.4 — Mappers**
  `integration/mappers/` — API shape to internal type. No raw field names escape this folder (R7).

- [ ] **T2.5 — `scripts/sync/shared.ts`**
  Supabase admin client, `startSyncLog()`, `finishSyncLog()`, top-level error capture. Every job uses these (R9).

- [ ] **T2.6 — `scripts/sync/clans.ts`**
  For each of the three clans: fetch members, upsert `players`, update roles, write `sync_log`.
  Run it locally with fixtures, then against the live API.
  **Done when:** running it twice produces no duplicate rows.

- [ ] **T2.7 — First GitHub Actions workflow**
  `sync-clans.yml`, hourly, with `workflow_dispatch` so you can trigger it manually.
  Add secrets: `COC_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `COC_API_BASE` set to the proxy.
  **Done when:** a manual run succeeds and `sync_log` shows a row.

- [ ] **T2.8 — Backup workflow**
  `backup.yml`, weekly `pg_dump` committed to a private repository or uploaded as an artifact.
  **Do this now, not later.** A backup added in month six protects nothing lost in month three.

- [ ] **T2.9 — Donation and activity snapshots**
  Migration 007: `member_snapshots` — `clan_id`, `player_id`, `captured_at`, `donations`, `donations_received`, `trophies`, `war_stars`, `th_level`, `role`.
  Extend `scripts/sync/clans.ts` to write one row per player per run.
  These are cumulative season totals that Supercell resets monthly. Snapshotting is the only way to derive per-season figures and to detect inactivity later. Without this, phase 3B has nothing to display.

---

# Phase 3 — Auth and identity

- [ ] **T3.1 — Magic link login**
  `/login` page, Supabase Auth email OTP. No passwords.

- [ ] **T3.2 — Session middleware**
  Refresh the session, redirect unauthenticated users to `/login`.

- [ ] **T3.3 — Player verification**
  `/api/verify` route handler. Input: player tag plus in-game API token.
  Call Supercell's `/players/{tag}/verifytoken` endpoint. On success set `players.verified = true` and link `user_id`.
  **The token is verified and discarded** (R8).
  Rate limit this route with Upstash — 5 attempts per user per hour.

- [ ] **T3.4 — Verification page**
  Step-by-step instructions with screenshots of Settings → More Settings → API Token.
  Include the warning: this API token is safe to share; a Supercell ID password is never required by any website.

- [ ] **T3.5 — Roles and `requireRole()` helper**
  leader / co-leader / elder / member. A helper that route handlers call before acting.

- [ ] **T3.6 — Clan switcher**
  Layout shell with navigation between the three clans, showing only clans the user may see.

- [ ] **T3.7 — Authorisation test**
  Sign in as an ordinary member of clan 1. Request clan 2's data by editing the URL directly. Try the API routes too.
  **Done when:** every attempt returns empty or forbidden. Repeat this test at the end of every later phase.

- [ ] **T3.8 — Account approval gate**
  Magic-link signup alone means anyone with an email address can create an account. Verification proves they own *a* Clash of Clans account, not that they belong to *your* clans.
  Gate it: a new user lands in a pending state and sees nothing until either their verified player tag matches a current member of one of the three clans, or a leader approves them manually.
  **Done when:** an account created with a random email and a stranger's verified tag can see no clan data.

- [ ] **T3.9 — Member movement and former members**
  Players move between your three clans, and some leave entirely. Handle this in `scripts/sync/clans.ts`:
  - Player appears in a different clan → update `players.clan_id`, keep all history attached to the player, not the clan
  - Player no longer in any of the three clans → set `left_at`, keep the row, revoke access
  Migration 008 adds `players.left_at`.
  **Done when:** moving a test player between two clans in game preserves their CWL history and does not duplicate the player row.

---

# Phase 3B — Clan directory and member profiles

*This is the module every other page links into. It was the largest gap in the first draft of this plan.*

- [ ] **T3B.1 — Clan dashboard**
  `/[clanTag]/page.tsx` — clan name, badge, level, member count, war league, current war state, next CWL date, latest announcement, data freshness. The landing page after login.

- [ ] **T3B.2 — Member directory**
  Sortable table: name, tag, role, Town Hall, trophies, donations given and received, ratio, war stars, last seen active.
  Sort and filter by each column. This replaces "scroll WhatsApp and guess".

- [ ] **T3B.3 — Donation ratio and season totals**
  Derive per-season donations from `member_snapshots` (T2.9) by differencing across the season, handling the monthly reset.
  Flag members below a configurable ratio threshold.

- [ ] **T3B.4 — Player profile page**
  `/[clanTag]/player/[tag]` — one member, everything: CWL history, war attacks, raid participation, Clan Games points, donation trend, clan movement history.
  **This page is objective O4.** The leader must be able to answer "how active has this member been for six months" in under thirty seconds. Nothing else in the plan delivers that.

- [ ] **T3B.5 — Inactivity detection**
  Compute a simple activity score from war participation, CWL attacks, raid attacks, donations, and last seen.
  Show a "needs attention" list per clan. Advisory only — never automate kick decisions.

- [ ] **T3B.6 — Cross-clan member search**
  Search by name or tag across all three clans at once. Useful when a leader remembers a name but not which clan.

---

# Phase 4 — Clan War League

*The urgent one. A CWL season that passes before this works is unrecoverable.*

- [ ] **T4.1 — `scripts/sync/cwl.ts`**
  Fetch the league group. For each war tag, fetch the war, then insert seasons, wars, and attacks with `ON CONFLICT DO NOTHING`.
  Handle a missing CWL group as a clean exit, not an error (R10) — it is absent for three weeks of every month.

- [ ] **T4.2 — `sync-cwl.yml`**
  Every 2 hours, plus `workflow_dispatch`.
  Do not assume punctual execution. GitHub delays scheduled runs by up to twenty minutes.

- [ ] **T4.3 — CWL repositories and services**
  Season list, war days, attacks by player, missed attacks calculated from roster minus attacks.
  Every query filters by clan (R3).

- [ ] **T4.4 — Season overview page**
  `/[clanTag]/cwl` — day-by-day results, stars, position.

- [ ] **T4.5 — Day detail page**
  Roster, each attack with stars and destruction, and a clear list of who has not attacked.

- [ ] **T4.6 — Member CWL history**
  One player across seasons: attacks used, stars, missed days.

- [ ] **T4.7 — Bonus medal recording**
  Leader and co-leader assign bonuses. Store `awarded_by`, `awarded_at`, and a note. Write to `audit_log`.

- [ ] **T4.8 — Data freshness indicator**
  Every page shows "updated N minutes ago" from `sync_log`. Turns red past a threshold.
  This is how you find out a job died before it costs you a season.

- [ ] **T4.9 — Moved**
  CWL roster planning is now Phase 4B. It became a module, not a task.

- [ ] **T4.10 — Import the handwritten logbooks**
  A leader-only form to enter past CWL seasons by hand from the photographs taken at T0.13: season, player, day, attacks used, stars, bonus received.
  Mark these rows `source = 'manual'` so they are visually distinguishable from API-captured data.
  This is objective O2 taken seriously. Without it the platform starts with an empty history and the logbook years are lost anyway.

---

# Phase 4B — Polls, rosters and selection

*This is the leader's actual workload, and it was the weakest part of the first plan.*

*Everything before this phase records what the game did. This phase supports what people decide. It is the reason the system needs a real backend and not just sync jobs.*

**Assumption to confirm:** the leader selects players across all three clans together, deciding which clan each available player should play CWL in. The design below supports that. If instead each clan chooses separately, the same tables work — you simply never move a player between clans. Confirm before building T4B.6.

## Polls

- [ ] **T4B.1 — Migration 010: poll tables**
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

- [ ] **T4B.2 — Create a poll**
  Leader and co-leader only. Title, question, options, open and close times, scope.
  A "CWL availability" template pre-fills the options: In / Out / Maybe.

- [ ] **T4B.3 — Answer a poll**
  Members see open polls on the dashboard and answer in one tap.
  Answers are editable until `closes_at`, then locked. Record `updated_at` so a leader can see late changes.

- [ ] **T4B.4 — Poll results**
  Live counts, and the full list of who answered what. Critically, also the list of **who has not answered** — that is the list the leader chases.
  Members see counts; leadership sees names.

- [ ] **T4B.5 — Poll reminders**
  Push to non-responders before the poll closes. Reuses T5.6.

## CWL roster selection

- [ ] **T4B.6 — Migration 011: roster tables**
  ```
  cwl_rosters        id, season, clan_id, status, slot_count,
                     created_by, published_at, created_at, deleted_at
  cwl_roster_members id, roster_id, player_id, position, added_by, added_at
  ```
  `status` is `draft` or `published`. `slot_count` is 15 or 30.
  Unique constraint `cwl_roster_members(roster_id, player_id)`.
  Second constraint: a player may appear in only one roster per season across all three clans. Enforce it in the database, not only in the form — otherwise the leader will double-book someone and not find out until CWL starts.

- [ ] **T4B.7 — Season availability pool**
  One screen showing every player across all three clans for the season, with: their poll answer, current clan, Town Hall level, hero levels, last season's CWL performance, and their activity score from T3B.5.
  Filter and sort by any of these. This is the screen the leader makes the decision on, so it must show everything needed to decide, in one place.

- [ ] **T4B.8 — Roster builder**
  Three roster panels, one per clan, each with its slot count. The leader assigns available players into clans.
  Show live: slots filled, slots remaining, and a warning if a player is already placed in another clan's roster.
  Saves continuously as `draft`. The leader will not finish this in one sitting.

- [ ] **T4B.9 — Publish the roster**
  Draft becomes published. Members can now see it. Push notification to selected and non-selected players.
  Publishing is recorded in `audit_log`. Republishing after a change records a new entry — members will ask when they were dropped, and the answer should not depend on memory.

- [ ] **T4B.10 — Roster view for members**
  Read-only published lineup per clan. Everyone can see it. This replaces the WhatsApp message that gets buried.

## After CWL

- [ ] **T4B.11 — Plan versus reality**
  Compare `cwl_roster_members` against the roster the API reported. Show three groups: selected and played, selected but did not appear, appeared but was not selected.
  This is R12 in practice, and it is the report that ends arguments.

- [ ] **T4B.12 — Contribution report**
  Per selected player for the season: attacks used out of 7, stars earned, average destruction, missed days, and bonus medal received or not.
  Sortable, exportable, and linked from the player profile (T3B.4).

- [ ] **T4B.13 — Bonus medal suggestion**
  Rank selected players by contribution and suggest an order for bonus allocation, using the rule confirmed at T0.11.
  **Suggestion only.** The leader always decides, and the decision is recorded with a note (T4.7).

- [ ] **T4B.14 — Roster history**
  Every past season's roster, poll, and contribution report, browsable by season and clan. Permanent.
  This is what the logbook was trying to be.

---

# Phase 5 — Announcements and notifications

- [ ] **T5.1 — Announcements table UI**
  Post, pin, edit, soft delete. Leadership posts, everyone reads.

- [ ] **T5.2 — Safe rendering**
  Plain text or restricted markdown. Never render raw HTML.

- [ ] **T5.3 — PWA manifest and icons**
  `manifest.json`, icons at 192 and 512 px, `display: standalone`.

- [ ] **T5.4 — Service worker**
  Handle push events and notification clicks.

- [ ] **T5.5 — Push subscription flow**
  Ask permission after login, store in `push_subscriptions`.

- [ ] **T5.6 — Push sending**
  Triggered from sync jobs: new announcement, CWL day ending with unused attacks.

- [ ] **T5.7 — Install instructions page**
  Android: Chrome menu → Add to Home Screen.
  iPhone: Safari share → Add to Home Screen. Push only works after installing.

- [ ] **T5.8 — Sync failure alert**
  When a sync job fails, or when the last successful run for a job type is older than its threshold, push a notification to the leader and to you.
  T4.8 tells you something is wrong if you happen to look at a page. This tells you without looking, which is the version that actually saves a CWL season.

- [ ] **T5.9 — Notification preferences**
  Per-member toggles: war reminders, CWL reminders, raid reminders, announcements. Without these, a member who finds the notifications annoying will disable them entirely and stop receiving the important ones.

---

# Phase 6 — Clan war

*Reuses phase 4 almost entirely.*

- [ ] **T6.1 — `scripts/sync/war.ts`**
  Handle `notInWar`, `preparation`, `inWar`, `warEnded` explicitly (R10).

- [ ] **T6.2 — `sync-war.yml`**
  Every 15 minutes.

- [ ] **T6.3 — War board page**
  Both rosters, attack status per base, live from the database.

- [ ] **T6.4 — Target assignment**
  Leadership assigns targets, writes to `war_targets`. Members may claim an unassigned target.
  Keep plan and outcome separate — never write results into `war_targets`.

- [ ] **T6.5 — Plan versus outcome view**
  Show assigned target beside what actually happened.

- [ ] **T6.6 — War history**

- [ ] **T6.7 — War availability poll**
  Reuses the poll tables from T4B.1 with `poll_type = war_availability`, scoped to one clan.
  Leader opens it before declaring war. Members answer in one tap. The leader sees the count before choosing the war size.

- [ ] **T6.8 — War lineup selection**
  Migration 012: `war_lineups`, `war_lineup_members` — same shape as the CWL roster tables.
  The leader picks the lineup from those available. Published to members before the war is declared in game.
  The API cannot tell you who *will* be in a war, only who is. So this is entirely human-decision data (R11).

- [ ] **T6.9 — War contribution report**
  Per member per war: attacks used, stars, destruction, and whether they followed their assigned target.
  Aggregate view across the last N wars, linked from the player profile.

- [ ] **T6.10 — War plan versus reality**
  Compare `war_lineup_members` against the roster the API reported, and `war_targets` against `war_attacks`.
  Same principle as T4B.11 (R12).

---

# Phase 7 — Raids and Clan Games

- [ ] **T7.1 — `scripts/sync/raids.ts`**
  Capital raid seasons. The API keeps recent history here, which makes this the easiest sync to write.

- [ ] **T7.2 — `sync-raids.yml`**
  Daily.

- [ ] **T7.3 — Raid pages**
  Participation, attacks used, capital loot, history per member.

- [ ] **T7.4 — Clan Games sync**
  The API gives no per-season score. Snapshot each player's "Games Champion" achievement value at the start and end of the period; the difference is that season's score.

- [ ] **T7.5 — Clan Games page**

---

# Phase 8 — Base layouts

*Fully independent of everything else.*

- [ ] **T8.1 — Storage bucket and policies**
  Supabase Storage, RLS on the bucket.

- [ ] **T8.2 — Browser-side compression**
  Resize and compress with canvas before upload. Target under 300 KB. This is what keeps you inside the 1 GB free tier.

- [ ] **T8.3 — Upload flow**
  Copy link, screenshot, Town Hall level, type (war / farming / trophy), description.
  Validate real file type, not the filename. Strip EXIF.

- [ ] **T8.4 — Browse and filter**
  By Town Hall level and type.

- [ ] **T8.5 — Voting**

---

# Phase 9 — Consolidation

- [ ] **T9.1 — Cross-clan report**
  Participation across all three clans in one view. This is what the leader actually wants.

- [ ] **T9.2 — Admin page**
  `sync_log` history, failed jobs, manual sync trigger, member management.

- [ ] **T9.3 — Full security review**
  Repeat T3.7 against every route. Confirm no secrets in Vercel. Confirm the repository is private.

- [ ] **T9.4 — Restore test**
  Actually restore a backup into a scratch Supabase project. An untested backup is not a backup.

- [ ] **T9.5 — Member guide**
  One page: how to sign up, verify, and install the app.

- [ ] **T9.6 — Audit log viewer**
  Leader-only page reading `audit_log`: who changed what and when, filterable by user and by entity.
  R4 says every write is recorded. Without a viewer that record is invisible, and the protection against a departing member is theoretical.

- [ ] **T9.7 — Global rate limiting**
  T3.3 rate limits verification only. Apply Upstash limits to every write route and every route that triggers a sync.
  Prevents the platform being used as an open proxy to the Clash of Clans API, which would get your key throttled.

- [ ] **T9.8 — Fan content compliance**
  Footer disclaimer stating the platform is not affiliated with, endorsed by, or sponsored by Supercell, using the wording recorded at T0.12.
  Confirm no advertising and no payment of any kind. The API key is non-commercial and can be revoked.

- [ ] **T9.9 — Local time display**
  Every timestamp is stored UTC and displayed in the member's local time. Confirm war end times, CWL day boundaries, and raid weekend windows all show correctly for Sri Lanka.
  Off-by-one-day errors here are common and quietly make missed-attack lists wrong.

- [ ] **T9.10 — Empty and loading states**
  Every page needs a sensible state for: no war in progress, not CWL week, no layouts uploaded, new member with no history, and a sync that has never run. Three weeks of every month there is no CWL, so this is the normal state, not an edge case.

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
| Logbook history preserved | M3 | T0.13, T4.10 |
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
| O2 | Logbook eliminated | T4.1–T4.10 |
| O3 | Single view across three clans | T9.1, T3B.6 |
| O4 | Any member's six-month history in 30 seconds | **T3B.4** |
| O5 | Base layouts searchable | T8.4 |
| O6 | Zero recurring cost | Section 3 |
| O7 | Member data protected | T3.7, T3.8, T9.3 |

---

## 6. Definition of done

A task is not finished until all of these are true:

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