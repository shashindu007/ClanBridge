# Mappers

T2.4 — Supercell's JSON shape to the internal types in `src/types/domain.ts`.

One file per endpoint: `clan.ts`, `war.ts`, `cwl-group.ts`, `cwl-war.ts`,
`capital-raids.ts`, `player.ts`.

**R7 — this is the boundary.** No raw API field name escapes this folder. Nothing
above `src/integration/` sees `attackerTag`, `defenderTag`, `opponentAttacks`, or a
timestamp shaped `20260729T063000.000Z`.

Mappers are where the API's quirks get absorbed, not passed along:

- Timestamps go through `lib/coc-time.ts` here, not later.
- Tags are normalised through `lib/tags.ts` here — uppercase, with the hash.
- `attacks` is **absent**, not empty, when a player has not attacked. Missed attacks
  are derived from the roster (see `../../services/README.md`), never from a
  zero-length array that the API did not send.
- Destruction percentages come back as numbers on some endpoints and strings on
  others. Normalise once, here.

Mappers are pure functions: no database access, no network calls, no clock reads.
That is what makes them testable against `fixtures/` alone.
