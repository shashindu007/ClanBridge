# ClanBridge

## Technical architecture and stack design

| | |
|---|---|
| **Project** | ClanBridge — Clash of Clans clan management platform |
| **Document** | Technical design |
| **Version** | 1.0 |
| **Date** | July 2026 |
| **Companion to** | ClanBridge Project Proposal v1.0 |

---

## 1. The governing rule

One decision shapes everything else in this document:

> **The website never reads from the Clash of Clans API. It reads from our own database. Only the scheduled sync jobs talk to Supercell.**

Every consequence below follows from this. Pages load fast because they query PostgreSQL, not a slow external API. The rate limit is never at risk, because page views do not generate API calls. The site keeps working when Supercell's API is down or in maintenance. And the historical data problem is solved automatically, because storing is the only way data gets in.

If a feature seems to need a live API call during a page load, the correct fix is almost always to sync it more often, not to call the API from the page.

---

## 1B. The two kinds of data

The system stores two categories of information with opposite properties. Almost every design decision below depends on keeping them apart.

| | Game facts | Human decisions |
|---|---|---|
| Source | Supercell's API | People using the application |
| Examples | Attacks, stars, results, member lists, donations | Poll answers, roster selections, clan assignments, target calls, bonus awards, notes |
| Written by | Sync jobs only | Application routes only |
| Can a human edit it? | No | Yes, subject to role |
| Exists in the game? | Yes | No — it exists nowhere but here |
| Lost if not captured? | Yes, permanently | Not applicable |

**They live in separate tables, and each table has exactly one writer.**

A sync job that writes to `cwl_rosters` is a bug. A form that writes to `cwl_attacks` is a bug.

The reason is practical rather than theoretical. Sync jobs re-run every few hours and overwrite what they find. If a leader's roster selection lived in a table a sync job touched, a routine 2 AM run would silently erase an hour of the leader's work, and nobody would know why.

### Plan versus reality

Wherever both kinds describe the same thing, both are kept:

| Plan (human) | Reality (game) |
|---|---|
| `cwl_rosters` — who the leader chose | API roster — who actually played |
| `war_lineups` — who was picked for the war | API roster — who was in it |
| `war_targets` — who was told to attack what | `war_attacks` — what they actually did |

The plan is never overwritten by the outcome. Showing the gap between them is the most useful output of the whole system — it is how a leader sees who did not follow the plan, which is exactly what the logbook and WhatsApp cannot do.

### The human decision tables

```
polls               id, scope, clan_id, season, poll_type, title,
                    question, opens_at, closes_at, status, created_by
poll_options        id, poll_id, label, sort_order
poll_responses      id, poll_id, player_id, option_id, note,
                    responded_at, updated_at

cwl_rosters         id, season, clan_id, status, slot_count,
                    created_by, published_at
cwl_roster_members  id, roster_id, player_id, position, added_by

war_lineups         id, war_id, clan_id, status, created_by, published_at
war_lineup_members  id, lineup_id, player_id, added_by
```

`polls.scope` is `clan` or `family`. A CWL availability poll uses `family` scope, because the leader decides across all three clans at once and needs one pool of responses rather than three separate ones.

Two constraints matter more than they look. `poll_responses(poll_id, player_id)` is unique — one answer per player, editable until the poll closes, with `updated_at` recording late changes. And a player may appear in only one CWL roster per season across all three clans, enforced in the database rather than only in the form, because the alternative is discovering a double-booking on day one of CWL.

### Consequence for the architecture

This is why the application needs a genuine backend and not just a sync pipeline. Roughly half the system is ordinary web application work: forms, permissions, validation, state, and audit trails. The sync side is the unusual half, but it is not the larger half.

---

## 2. Technology stack

### 2.1 Application

| Concern | Choice | Why this one |
|---|---|---|
| Framework | Next.js 15, App Router | Server components mean most pages query the database directly with no client-side loading spinner. One codebase for pages and API |
| Language | TypeScript, strict mode | The API returns deeply nested and inconsistent JSON. Types catch the mistakes early |
| UI library | React 19 | Bundled with Next.js |
| Styling | Tailwind CSS v4 | Fast, no separate design system to maintain |
| Components | shadcn/ui | Copied into the repository rather than installed, so it can be modified freely |
| Validation | Zod | Validates both API responses and user input. One schema, used in both directions |
| Client data fetching | TanStack Query | Only needed for interactive pages such as the war board. Most pages need nothing |
| Dates | date-fns with UTC handling | Clash of Clans timestamps are UTC in a non-standard format and must be parsed explicitly |

### 2.2 Data and infrastructure

| Concern | Choice | Free tier |
|---|---|---|
| Database | Supabase PostgreSQL | 500 MB |
| Auth | Supabase Auth, email magic link | 50,000 monthly active users |
| File storage | Supabase Storage | 1 GB |
| Database access | supabase-js plus SQL migrations | — |
| Hosting | Vercel Hobby | Free, no card |
| Scheduled jobs | GitHub Actions | 2,000 minutes per month on private repositories |
| Rate limiting | Upstash Redis | 10,000 commands per day |
| Push notifications | web-push, VAPID | Free, self-hosted |
| Game API | Official API via RoyaleAPI proxy | Free |

Magic-link authentication is chosen deliberately: no passwords to store, no password reset flow to build, and no password-related vulnerabilities. For a clan of ordinary members this is also easier to explain than any alternative.

### 2.3 Deliberately not used

| Rejected | Reason |
|---|---|
| Separate backend service | Next.js route handlers are sufficient. A second service doubles deployment and cost |
| Prisma | Heavy cold starts on serverless. Drizzle or plain SQL is a better fit |
| Redis as a data cache | The database is the cache. Redis is used only for rate limiting |
| Vercel Cron | Hobby tier allows only daily execution. CWL requires more frequent runs |
| Vercel functions for sync jobs | Execution time limits are too short. See section 5 |
| Sharp for image processing | Compression happens in the browser before upload, which costs nothing and uses no server time |

---

## 3. System architecture

```
   Member's browser / installed PWA
                 |
                 |  HTTPS
                 v
   +-------------------------------+
   |     Vercel (Next.js)          |
   |                               |
   |  Server components  --------+ |
   |  Route handlers  -----------+ |     READ ONLY from database
   |  Auth middleware            | |     Never calls Supercell
   +-----------------------------|-+
                 |               |
                 v               v
        +----------------+   +----------+
        |   Supabase     |   | Upstash  |
        |                |   |  Redis   |
        | PostgreSQL     |   | (limits) |
        | + RLS          |   +----------+
        | Auth           |
        | Storage        |
        +----------------+
                 ^
                 | writes only
                 |
   +-------------------------------+
   |   GitHub Actions runners      |
   |                               |
   |  sync:clans   (hourly)        |
   |  sync:war     (15 min)        |
   |  sync:cwl     (2 hourly)      |     ONLY these call Supercell
   |  sync:raids   (daily)         |
   |  backup:db    (weekly)        |
   +-------------------------------+
                 |
                 v
        cocproxy.royaleapi.dev
                 |
                 v
        api.clashofclans.com
```

The two halves never overlap. Vercel reads; GitHub Actions writes. This separation is what makes the free tier viable.

---

## 4. Application layers

Four layers, with one strict rule between them.

```
  Presentation      pages, components
        |
        v
  Route handlers    HTTP, auth check, input validation
        |
        v
  Services          domain logic: "who missed attacks?"
        |
        v
  Repositories      database queries
```

Separately, and used only by sync jobs:

```
  Integration       CoC API client, response mapping
```

**The rule: raw Clash of Clans API shapes never escape the integration layer.** The API returns awkward structures — attacks nested inside members inside clans, tags with hash symbols, timestamps formatted as `20260729T063000.000Z`. All of that is mapped to clean internal types at the boundary. Nothing above the integration layer should ever see a field named `attackerTag`.

This matters more than it sounds. When Supercell changes a field name, you edit one mapper instead of hunting through forty files.

### 4.1 Repository structure

```
clanbridge/
├── .github/workflows/
│   ├── sync-clans.yml
│   ├── sync-war.yml
│   ├── sync-cwl.yml
│   ├── sync-raids.yml
│   └── backup.yml
├── src/
│   ├── app/
│   │   ├── (auth)/login/
│   │   ├── (app)/
│   │   │   ├── [clanTag]/
│   │   │   │   ├── page.tsx           dashboard
│   │   │   │   ├── cwl/
│   │   │   │   ├── war/
│   │   │   │   ├── raids/
│   │   │   │   ├── layouts/
│   │   │   │   └── notices/
│   │   │   └── admin/
│   │   └── api/
│   │       ├── verify/route.ts        player tag verification
│   │       ├── war/targets/route.ts   assignment writes
│   │       ├── layouts/route.ts       uploads
│   │       └── push/route.ts          subscriptions
│   ├── integration/
│   │   ├── coc-client.ts              fetch, retry, timeout
│   │   ├── coc-schemas.ts             Zod schemas for responses
│   │   └── mappers/                   API shape -> internal type
│   ├── services/
│   ├── repositories/
│   ├── lib/
│   │   ├── supabase/                  server, client, middleware
│   │   ├── auth.ts
│   │   └── tags.ts                    #ABC -> %23ABC
│   └── types/
├── scripts/sync/                      run by GitHub Actions, not Vercel
│   ├── clans.ts
│   ├── war.ts
│   ├── cwl.ts
│   ├── raids.ts
│   └── shared.ts
├── supabase/migrations/               numbered SQL files
└── fixtures/                          saved API responses for offline dev
```

The `scripts/sync/` directory is important: it runs on GitHub Actions, not on Vercel. It imports from `integration/` and `repositories/` but never from `app/`.

---

## 5. Why sync jobs do not run on Vercel

This is the least obvious decision in the design, and skipping it causes failures that are hard to diagnose.

Vercel's Hobby tier limits how long a serverless function may run. A full CWL sync must fetch the league group, then eight clans' rosters, then up to seven war days, for three clan families. That is well over a hundred sequential API calls, each with proxy latency and deliberate spacing to respect rate limits. It will exceed the limit, and it will fail partway through — leaving half-written data with no clear error.

GitHub Actions runners allow up to six hours. Running sync as a plain Node script there removes the constraint entirely.

The scripts connect straight to Supabase using the service role key and the Postgres connection string. They do not go through the web application at all.

```yaml
# .github/workflows/sync-cwl.yml
name: sync-cwl
on:
  schedule:
    - cron: '0 */2 * * *'
  workflow_dispatch:        # allows manual runs when debugging

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: npm ci
      - run: npx tsx scripts/sync/cwl.ts
        env:
          COC_API_TOKEN: ${{ secrets.COC_API_TOKEN }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
```

`workflow_dispatch` is not optional. Without it you cannot trigger a sync manually, and during a live CWL season you will need to.

**Scheduled runs are not punctual.** GitHub delays them when busy, sometimes by twenty minutes. No job may assume it runs at an exact time.

---

## 6. The Clash of Clans API client

One module. Every call goes through it.

Responsibilities:

- **Tag encoding.** Clan and player tags contain `#`, which must become `%23` in a URL. Handle it in one helper and never think about it again.
- **Base URL from environment.** Development points at `api.clashofclans.com` with a home IP key; production points at `cocproxy.royaleapi.dev`. Same code, different variable.
- **Timeout.** 10 seconds, then abort. The proxy occasionally hangs.
- **Retry with backoff.** Retry on 429 and 5xx only. Never retry on 403 or 404 — those are configuration problems and retrying wastes the rate limit.
- **Throttling.** A short delay between calls. Never fire 150 player requests in parallel.
- **Error mapping.** Convert HTTP failures into named errors the caller can branch on.
- **Response validation.** Parse through Zod. If Supercell changes a shape, fail loudly at the boundary rather than silently writing nulls.

These states are normal operating conditions, not exceptions, and each needs explicit handling:

| Condition | Meaning | Correct response |
|---|---|---|
| `notInWar` | No war right now | Exit cleanly, log success |
| `warEnded` | War finished | Capture final state, mark complete |
| `preparation` | War declared, not started | Store roster, no attacks yet |
| 403 on war log | War log is private | Log a clear warning naming the clan |
| 404 on CWL group | Not CWL week | Exit cleanly. Expected for three weeks each month |
| 429 | Rate limited | Back off and retry |

A sync job that treats "not in war" as an error will spend most of the month reporting failure, and you will start ignoring the alerts.

---

## 7. Authentication and authorisation

### 7.1 Identity chain

```
  Supabase auth user  (email)
          |
          v
  users            application profile
          |
          v
  players          one per Clash of Clans account, verified
          |
          v
  clan_roles       role within each clan
```

A member may own more than one player account, and accounts may sit in different clans. The model supports this from the start because in a three-clan family it is common.

### 7.2 Player verification

The member opens Settings, More Settings, API Token in the game and copies the short code. They paste it into ClanBridge with their player tag. The server calls Supercell's verification endpoint. If it returns valid, the player row is marked verified and linked to their user.

The token is verified and discarded. It is never stored, never logged, never included in an error message.

### 7.3 Authorisation

Two layers, and the second is the one that matters.

**Application layer.** Route handlers check the session and role before acting. This produces good error messages.

**Database layer.** Row Level Security policies in PostgreSQL. These cannot be bypassed by an application bug, a forgotten filter, or a route that was added in a hurry at midnight.

```sql
-- Which clans does the current user belong to?
create function auth_clan_ids() returns setof uuid
language sql stable security definer as $$
  select clan_id from clan_roles
  where user_id = auth.uid()
$$;

alter table cwl_attacks enable row level security;

create policy "read own clan family attacks"
on cwl_attacks for select
using (
  exists (
    select 1 from cwl_wars w
    join cwl_seasons s on s.id = w.season_id
    where w.id = cwl_attacks.war_id
      and s.clan_id in (select auth_clan_ids())
  )
);
```

Every table carrying clan data gets an equivalent policy. Sync jobs use the service role key, which bypasses RLS by design — that is correct, because jobs are not acting on behalf of any user.

**Test this deliberately.** Sign in as an ordinary member of clan one, then request clan two's data by editing the URL directly. If anything comes back, there is a hole. Repeat this test after every phase.

---

## 8. Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel, local | Public, safe in browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel, local | Public, protected by RLS |
| `NEXT_PUBLIC_SITE_URL` | Vercel, local | Magic-link redirects, push deep links |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Vercel, local | Push. Must be `NEXT_PUBLIC_` — the browser reads it when subscribing |
| `UPSTASH_REDIS_REST_URL` | Vercel | Rate limiting |
| `UPSTASH_REDIS_REST_TOKEN` | Vercel | Rate limiting |
| `SUPABASE_URL` | GitHub Actions, local | Same value as the public URL; sync scripts do not use the `NEXT_PUBLIC_` name |
| `SUPABASE_SERVICE_KEY` | GitHub Actions, local | Bypasses RLS. **Never** on Vercel or in browser code |
| `SUPABASE_DB_URL` | GitHub Actions | `pg_dump` connection string for the backup job (T2.8) |
| `COC_API_TOKEN` | GitHub Actions, local, **and Vercel** | Supercell key. On Vercel solely for `/api/verify` (T3.3) — see R6 |
| `COC_API_BASE` | GitHub Actions, local | Direct API in dev, proxy in production |
| `VAPID_PRIVATE_KEY` | GitHub Actions, local | Push is **sent from sync jobs** (T5.6), not from Vercel |
| `VAPID_SUBJECT` | GitHub Actions, local | `mailto:` contact required by the Web Push spec |
| `USE_FIXTURES` | Local only | Read saved responses instead of the live API |

The service role key belongs only in GitHub Actions secrets and your local `.env.local`. If it ends up in a Vercel environment variable, something in the architecture has gone wrong — it bypasses RLS, so its leak makes every access rule in section 7 decoration.

The Clash of Clans token is *also* set on Vercel, for one route only. `/api/verify` (T3.3) performs Supercell's `verifytoken` handshake on behalf of a member signing up, and that exchange is interactive — there is no way to do it from a scheduled job. The route is rate limited to 5 attempts per user per hour, and the API is read-only, so a leak means throttling rather than harm to anyone's account. Nothing else on Vercel may read it.

Three names in this table are exact rather than descriptive, and getting them wrong fails in ways that are hard to read:

- **`UPSTASH_REDIS_REST_URL` / `_REST_TOKEN`** — this is what `Redis.fromEnv()` looks for. Shortened names are simply not found, and the client fails at first use rather than at startup.
- **`NEXT_PUBLIC_VAPID_PUBLIC_KEY`** — without the prefix Next.js does not expose it to the browser, and `pushManager.subscribe()` has nothing to send.
- **`VAPID_PRIVATE_KEY` lives with the sync jobs, not on Vercel.** Push notifications are triggered from `scripts/sync/`, so the signing key belongs where those run.

---

## 9. Offline development

`USE_FIXTURES=true` makes the API client read saved JSON from `fixtures/` instead of calling Supercell. This is worth setting up on day one:

- Development continues while the developer portal is unreachable or the key IP is wrong
- Tests run without network access and without consuming rate limit
- Rare conditions can be reproduced on demand, including a CWL day with missed attacks, a private war log, and a war in preparation

Capture the fixtures once during a live CWL season and they stay useful permanently — which is a small, pleasing echo of the whole project's purpose.

---

## 10. Caching

| Data | Strategy |
|---|---|
| Completed CWL and war history | Immutable once finished. Cache indefinitely |
| Current war board | Revalidate every 60 seconds |
| Member lists | Revalidate every 5 minutes |
| Base layouts | Revalidate on write |
| Push subscriptions | Never cached |

Next.js caching is used for page-level results. The database itself needs no cache in front of it at this scale.

---

## 11. Failure handling

Three failure modes have permanent consequences, so each gets a specific mechanism rather than general good intentions.

**A sync job fails silently.** Every job writes to `sync_log` at start and finish, with status and error text. Every page displays the age of its data. When the number goes stale, it turns red, and a member will report it before a leader notices. The alternative — discovering on CWL day six that nothing was recorded since day two — cannot be undone.

**Someone deletes something.** No table is ever physically deleted from. Every row carries `deleted_at`, and every write is recorded in `audit_log` with the user who made it. Deleted CWL history cannot be re-fetched from any source, so this is not over-engineering.

**The database is lost.** A weekly GitHub Action dumps the full database to a private repository. This is built in phase one, before any feature. A backup added in month six protects nothing that was lost in month three.

---

## 12. Migration path

Everything chosen here is standard and portable, which is deliberate insurance against free tiers changing.

| If this fails | Move to | Effort |
|---|---|---|
| Supabase free tier | Neon, or self-hosted PostgreSQL | Low. Plain PostgreSQL with SQL migrations |
| Vercel Hobby | Any Node host, or a small virtual server | Low. Next.js runs anywhere |
| GitHub Actions | Any cron, or systemd timers | Low. Plain Node scripts |
| RoyaleAPI proxy | Virtual server with a fixed IP | Low. One environment variable |

The whole system fits on a five dollar per month virtual server if every free tier disappeared at once. No managed service is load-bearing.

---

## 13. Build sequence

Order matters. Each step makes the next one cheaper.

| Step | Build | Why here |
|---|---|---|
| 1 | Migrations, RLS policies, seed the three clans | Access rules are painful to retrofit |
| 2 | API client, Zod schemas, fixtures | Everything downstream depends on it |
| 3 | `sync:clans` plus `sync_log` | Simplest job. Proves the whole pipeline works |
| 4 | Backup workflow | Before any data exists that matters |
| 5 | Auth, verification, roles | Gates every user-facing feature |
| 6 | `sync:cwl`, then CWL pages | The urgent one. A missed season is unrecoverable |
| 7 | Notices, PWA, push | Small, and this is what replaces WhatsApp |
| 8 | War module | Reuses step 6 almost entirely |
| 9 | Raids, Clan Games | Straightforward once the pattern exists |
| 10 | Base layouts | Fully independent. Safe to leave last |

Steps 1 to 4 produce nothing a user can see. Build them anyway. They are the reason step 6 takes days instead of weeks.

---

*End of document*