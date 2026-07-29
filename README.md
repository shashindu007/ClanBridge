# ClanBridge

Private clan management platform for three Clash of Clans clans. Replaces WhatsApp
threads and a paper logbook.

**The build spec is [IMPLEMENTATION.md](IMPLEMENTATION.md). Read it before changing
anything here.** This README only covers how to run the repo.

The core reason this project exists: Clan War League data is deleted from Supercell's
API when the season ends and cannot ever be recovered. Everything else is secondary.

## Status

Skeleton only. Every file below the root configs is a labelled placeholder — no logic
has been written yet, and Phase 0 (accounts and API keys) has not started.
Begin at **T0.1**.

## Running it

```bash
npm install
npm run dev
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
- **No test runner is configured yet.** Decide at T1.12; Vitest is the recommended fit.

---

This project is not affiliated with, endorsed by, or sponsored by Supercell.
See T0.12 and T9.8 for the required wording.
