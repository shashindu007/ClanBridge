# ClanBridge

Private clan management platform for three Clash of Clans clans. Replaces WhatsApp
threads and a paper logbook.

**The build spec is [IMPLEMENTATION.md](IMPLEMENTATION.md). Read it before changing
anything here.** This README only covers how to run the repo.

The core reason this project exists: Clan War League data is deleted from Supercell's
API when the season ends and cannot ever be recovered. Everything else is secondary.

## Status

Phases 1, 2 and 3 are complete. Phase 4 (CWL) is complete except bonus recording
(T4.7) and the logbook import (T4.10). Everything from Phase 3B onward is still a
labelled placeholder — each stub names the task ID that fills it.

`IMPLEMENTATION.md` carries the per-task ledger. Three things are worth knowing
before you touch anything:

- **The fixtures in `fixtures/` are synthetic, not captured.** The suite passes
  against shapes written by hand to match the schemas, which means the schemas are
  documented rather than verified. Capturing real ones is T2.1 and it can only be
  done for `cwlgroup`/`cwlwar` during CWL week — the first week of the month.
- **Upstash is not configured** (T0.9), so `/api/verify` throws in production by
  design rather than rate limiting with a per-instance counter that limits nothing.
- **No sync job has been run against the live API yet.** The workflows are written;
  none has had a green run.

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
| `src/app/` | Next.js App Router. `(auth)` is public, `(app)` requires a session |
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
