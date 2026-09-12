# Onboarding

For someone setting up ClanBridge on a machine that has never run it before.
`README.md` covers day-to-day commands once you're set up; this covers the
one-time setup itself. Read `IMPLEMENTATION.md` before changing anything —
same rule as the README gives everyone else.

## 0. Access to get from whoever invited you

Before you start, ask the project owner for:

- **GitHub repo access** — a collaborator invite to `shashindu007/ClanBridge`
- **A Supabase project** — either an invite to the existing one (Supabase
  dashboard → Project Settings → Team), or ask for `NEXT_PUBLIC_SUPABASE_URL`
  and `NEXT_PUBLIC_SUPABASE_ANON_KEY` if you're standing up your own
- Anything else only if you'll be running live sync jobs, not just browsing
  the app — see [Step 5](#5-only-if-youll-run-live-sync-jobs). Ask for these
  over a password manager or similar, never in chat or email.

If you're the one granting access rather than requesting it: the above three
bullets are the complete list of what to send. Nothing else in this doc needs
handing over — everything past this point, the new person can do themselves.

## 1. Prerequisites

- Node.js ≥ 20
- Git

## 2. Clone and install

```bash
git clone https://github.com/shashindu007/ClanBridge.git
cd ClanBridge
npm install
```

## 3. Environment variables

```bash
cp .env.example .env.local
```

Fill in, at minimum:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from Step 0
- `NEXT_PUBLIC_SITE_URL=http://localhost:3000`
- `USE_FIXTURES=true` — the API client reads `fixtures/` instead of hitting
  Supercell's API, so nothing else in Group B of `.env.example` is needed for
  local development
- `OWNER_EMAIL` — your own email, so you can claim platform admin at `/admin`
  on first sign-in (only works if no admin has claimed it yet)

Everything else in `.env.example` (Group B: `COC_API_TOKEN`,
`SUPABASE_SERVICE_KEY`, `SUPABASE_DB_URL`, VAPID keys, `RESTORE_TARGET_URL`,
`GITHUB_DISPATCH_*`) is for sync jobs, push notifications, or backups. Leave
blank unless you're doing one of those.

## 4. Database

If you're using your own fresh Supabase project rather than an invite to the
existing one:

```bash
npm run migrations:apply
npm run types:db
```

If you were invited to the existing project, both are already done — skip
this step. (Check with the owner whether migration 030 has landed yet; if
not, `src/types/database.ts` will be stale for `users` until it has.)

## 5. Run it

```bash
npm run dev
```

Visit `http://localhost:3000/login` → **Sign up** for a magic link → complete
`/account/setup` with a username and password. A leader (or you, if you
claimed `/admin` via `OWNER_EMAIL`) still has to approve the account before
any clan data is visible.

## 6. Verify the setup

```bash
npm run typecheck
npm run lint
npm test        # vitest; migrations run against real Postgres via PGlite, no network needed
```

## 7. Only if you'll run live sync jobs

Sync jobs pull real data from Supercell's API and only matter if you're
maintaining production data, not for local development:

```bash
npm run sync:clans
npm run sync:cwl
npm run sync:war
npm run sync:raids
```

These need `COC_API_TOKEN` set and `USE_FIXTURES` unset/false. Get your own
dev key at [developer.clashofclans.com](https://developer.clashofclans.com) —
tokens are bound to the IP that requested them, so a shared token usually
breaks the moment a second person uses it from a different network.

## Known gotchas

- **Two clans exist right now, not three** (`DH CWL ONLY` and `DH v2`) —
  wherever the docs say "three clans," read it as intent, not current state.
- **Migration 030** may not be applied to whichever Supabase project you're
  pointed at — see Step 4.
