# ClanBridge

Private clan management platform for three Clash of Clans clans. Replaces WhatsApp
threads and a paper logbook.

**The build spec is [IMPLEMENTATION.md](IMPLEMENTATION.md). Read it before changing
anything here.** This README only covers how to run the repo.

The core reason this project exists: Clan War League data is deleted from Supercell's
API when the season ends and cannot ever be recovered. Everything else is secondary.

## Status

**`IMPLEMENTATION.md` is the ledger. Read the checkboxes there; this file does
not keep a second copy of them.**

That rule is the finding, not a preference. This section has now gone stale
twice, the same way, about the same subject. The first time it claimed phases 1
to 3B were done and "everything from Phase 4B onward is still a labelled
placeholder", and that no sync job had run against the live API — untrue for
months. It was rewritten with a note saying so, and within days it was wrong
again: it said Phase 11B was "scoped rather than built" with "every box unticked"
while all thirteen T11B boxes were ticked and the code was under test, and it
said migrations 030 to 035 were unapplied while the regenerated
`src/types/database.ts` showed all of them live.

Both times the cause was the same. Status that lives in two files diverges, and
the file nobody edits during a phase is the one that lies. So the count is gone
rather than corrected — a number here would only go stale a third time.

What needs a live environment rather than a commit, and is therefore genuinely
outstanding:

- **T9.4 — the restore test.** Needs a scratch Supabase project to restore into.
  `npm run restore:verify` exists and has nowhere to point. The weekly dump runs;
  it has never been restored, so its success rate is unknown, and the data it
  protects cannot be re-fetched from anywhere.
- **The deployment half of T9.3.** Needs a Vercel deployment to inspect.
- **T0.9 — Upstash functional verification.** See the note at the end of this
  section; the limiter fails open, so a misconfiguration is invisible.

What is worth knowing before you touch anything:

- **The application has run against real data since 2026-08-09**, and the
  fixtures in `fixtures/` are real captures rather than the synthetic shapes they
  started as (T2.1).
- **Four clans are active** (as of 2026-10): `Dark Heaven™`, `Dark Hell`,
  `DH CWL ONLY` and `DH v2` — the last is a test clan. Clans are added at
  `/admin`. Anywhere the docs say "three clans", read it as intent rather than
  state; the database is the list, and `select tag, name from clans where
  deleted_at is null` is the only answer that cannot go stale.
- **Backups are encrypted, because this repository is public.** A public
  repository's workflow artifacts can be downloaded by anyone signed in to
  GitHub, and the dump contains every member's account data. `backup.yml`
  refuses to run without the `BACKUP_PASSPHRASE` secret and uploads only the
  `.gpg` file. `SUPABASE_DB_URL` in GitHub must be the **session pooler** string
  (`*.pooler.supabase.com:5432`): the direct `db.<ref>.supabase.co` address is
  IPv6-only and GitHub's runners cannot reach it. To restore, put the same
  passphrase in `.env.local` as `BACKUP_PASSPHRASE`; `npm run restore:verify`
  decrypts a `.gpg` dump itself (GnuPG must be installed).
- **A private war log is a warning, not a failed sync.** The war sync logs it
  and the clan's home page says so; the CWL sync still fails on it, because
  during league week it means a season is being lost.
- **Applying migrations is `npm run migrations:apply`, then `npm run types:db`.**
  Do not read a migration number off this file to decide what is outstanding —
  compare `supabase/migrations/` against the database, because that is the only
  comparison that cannot go stale. `src/types/database.ts` states the table count
  and the date it was generated at the top; if that disagrees with the migration
  list, regenerate it before trusting it.
  Two dashboard settings go with 030 (see the T10 block in IMPLEMENTATION.md),
  and 035 creates a Storage bucket worth confirming by eye, because the test
  suite cannot reach a bucket policy.
  **If you apply by pasting `supabase/apply-all.sql` instead, 029 and 035 are not
  in it** — that bundle is built from the PGlite-testable list only, and both
  Storage migrations have to be run separately.
- **Upstash functional verification is still outstanding** (T0.9). The
  credentials are in `.env.local` and `getRateLimiter()` only throws under
  `NODE_ENV=production`, so local development was never blocked by it.

## Signing in

Two doors on `/login`, and they do different jobs:

- **Sign up** sends a magic link. Still the only way an account is created, and a
  leader still approves every one before any clan data is visible.
- **Sign in** takes an email and a password. Every account is held on
  `/account/setup` after its first link until it has chosen a username and a
  password, so this door works for everybody.

There is a **Sign out** button in the shell. Before Phase 10 there was not — no
`/logout`, no `signOut()` call, no cookie deletion anywhere — which meant a member
with two accounts was stuck on whichever one they last opened a link with. That is
what the password is for: switching accounts should not require an inbox.

Forgotten password: sign up with a link again, then **Sign-in and password** in the
account menu. There is no separate reset flow, deliberately.

## Your bases

One account can own several villages, and since Phase 11 the product says so.
**My bases** in the account menu lists every village you have verified, lets you
name each one so two near-identical in-game names are tellable apart, holds one
profile picture for the account, and links to a report per village. Adding another
is the same in-game API token flow as the first.

A village in a clan you hold no role in is still listed — it is yours — but it has
no report, because everything a report reads is filtered by clan and that filter was
deliberately not widened. The page says so, and cannot name the clan, for the same
reason. `Architecture.md` §7.4 has the whole model.

## Running it

```bash
npm install
npm run dev
```

Checks, all of which CI also runs:

```bash
npm run typecheck
npm run lint
npm test          # vitest; migrations run against real Postgres via PGlite
```

Sync jobs run from the command line, never from the web app (R1, R2):

```bash
npm run sync:clans     # tsx scripts/sync/clans.ts
npm run sync:cwl
npm run sync:war
npm run sync:raids
```

With `USE_FIXTURES=true` the API client reads `fixtures/` instead of the network, so
everything above works offline and without an API key.

## Layout

| Path | What lives there |
|---|---|
| `src/app/` | Next.js App Router. `(app)` requires a session; `(auth)` is the shell for `/login` and `/verify`, only the first of which is public |
| `src/integration/` | The only code that knows Supercell's JSON shape (R7) |
| `src/repositories/` | Database access. Every query filters by clan (R3) |
| `src/services/` | Business logic between route handlers and repositories |
| `src/lib/` | Supabase clients, tag and time parsing, auth, rate limiting |
| `scripts/sync/` | The only code that calls the game API (R1). Run by GitHub Actions (R2) |
| `supabase/migrations/` | Numbered SQL. Never edit one after it has been applied |
| `fixtures/` | Captured API responses for offline development |

| `test/` | Vitest. Migrations against PGlite, plus the authorisation suite (T3.7) |
| `scripts/` | Migration, fixture and schema tooling outside `sync/` |

Each placeholder file names the task ID from IMPLEMENTATION.md that fills it.

## Before you commit anything

Section 6 of IMPLEMENTATION.md is the definition of done. The two that get missed:
every database query filters by clan, and nothing is ever hard-deleted.

## Notes on the stack

- **Tailwind is v4**, which is CSS-first. There is deliberately no `tailwind.config.ts`
  — theme configuration goes in `src/app/globals.css` under `@theme`.
- **shadcn/ui components are copied in**, not installed. `components.json` points the
  CLI at `src/components/ui/`. The first `npx shadcn@latest add …` will also pull in
  `clsx`, `tailwind-merge`, `class-variance-authority` and `lucide-react`.
- **Vitest is the test runner.** `test/pg-harness.ts` boots PGlite so migrations are
  executed rather than eyeballed, and `test/pglite-supabase.ts` is a supabase-js
  stand-in over it — which is why repository code avoids PostgREST embedded selects.

---

This project is not affiliated with, endorsed by, or sponsored by Supercell.
See T0.12 and T9.8 for the required wording.
