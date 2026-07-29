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
| `/api/cwl/signups` | T4.9 — member marks in / out / maybe |
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
