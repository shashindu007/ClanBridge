# Services

Business logic between route handlers / Server Components and `../repositories/`.
Anything that is a calculation rather than a query belongs here.

Starts being filled at T4.3.

Expected files as their tasks come up:

| File | Task | What it computes |
|---|---|---|
| `cwl.ts` | T4.3 | Missed attacks = roster minus recorded attacks |
| `members.ts` | T3B.3 | Per-season donations, differenced across the monthly reset |
| `activity.ts` | T3B.5 | Activity score from wars, CWL, raids, donations, last seen |
| `freshness.ts` | T4.8 | "Updated N minutes ago" from `sync_log`, and the red threshold |
| `war.ts` | T6.5 | Assigned target beside actual outcome |
| `clan-games.ts` | T7.4 | End-of-period achievement value minus start |
| `reports.ts` | T9.1 | Cross-clan participation |

Two things the calculations depend on and that are easy to get wrong:

- **Missed attacks are derived, not stored.** The API never says "this player did not
  attack" — it simply returns no attack. The roster is the source of truth for who
  was expected.
- **Donations are cumulative season totals that Supercell resets monthly.** A raw
  reading is meaningless on its own; the figure comes from differencing
  `member_snapshots` (T2.9), and the difference goes negative at the reset.

Services take `clanId` and pass it down. They never bypass the repositories to query
directly.
