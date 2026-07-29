# Route handlers

Route handlers read PostgreSQL only (R1) and hold no secrets (R6). The single
exception is `verify/`, which performs Supercell's token handshake — see the note in
that file.

Sync logic never goes here. Vercel's free function timeout will kill a CWL sync
partway through and leave half-written data (R2); sync runs on GitHub Actions from
`scripts/sync/`.

## Scaffolded

| Route | Task |
|---|---|
| `POST /api/verify` | T3.3 — player token verification, rate limited 5/user/hr |
| `POST /api/push/subscribe` | T5.5 — store a push subscription |

## Planned

Added as their tasks come up. Server Actions are fine instead of a handler where the
call is only made from one form.

| Route | Task |
|---|---|
| `/api/polls` | T4B.2 — create a poll, leader and co-leader only |
| `/api/polls/[id]/respond` | T4B.3 — one answer per player, editable until close |
| `/api/cwl/rosters` | T4B.8 — draft roster autosave |
| `/api/cwl/rosters/[id]/publish` | T4B.9 — draft to published, writes audit_log |
| `/api/war/lineups` | T6.8 — war lineup selection |
| `/api/cwl/bonuses` | T4.7 — assign bonus medals, writes audit_log |
| `/api/cwl/import` | T4.10 — logbook rows, `source = 'manual'` |
| `/api/war/targets` | T6.4 — assign or claim a target |
| `/api/announcements` | T5.1 — post, pin, edit, soft delete |
| `/api/layouts` | T8.3 — layout metadata after a direct-to-Storage upload |
| `/api/layouts/vote` | T8.5 |
| `/api/admin/sync` | T9.2 — manual `workflow_dispatch` trigger |

Before merging any of these, check the two things generated code gets wrong here:
the clan filter on every query (R3), and the role check before every write (T3.5).

Every write route needs an Upstash rate limit (T9.7) — not just `verify`.

## R11 — everything here writes human decisions

Every route in both tables above writes a table that **no sync job may touch**:
polls, rosters, lineups, targets, bonuses, announcements, layouts.

The inverse holds too. No route handler writes `cwl_attacks`, `war_attacks`,
`players` or `member_snapshots` — those come from `scripts/sync/` alone. A form
that writes an attack row is a bug, however convenient it looks for the logbook
import (T4.10 writes `cwl_attacks` rows marked `source = 'manual'`, which is the
one sanctioned exception, and it is leader-only and audited).

`/api/cwl/rosters/[id]/publish` records a new `audit_log` entry on **every**
publish, including republishes. Members will ask when they were dropped from a
roster, and the answer must not depend on anyone's memory (T4B.9).
