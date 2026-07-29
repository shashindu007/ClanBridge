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
| `polls.ts` | T4B.4 | Counts, and the non-responder list |
| `rosters.ts` | T4B.8 | Slot counts, and the cross-clan double-booking check |
| `selection.ts` | T4B.11, T6.10 | Plan vs reality (R12) |
| `contribution.ts` | T4B.12, T4B.13 | Per-season contribution and bonus ranking |

Two things the calculations depend on and that are easy to get wrong:

- **Missed attacks are derived, not stored.** The API never says "this player did not
  attack" — it simply returns no attack. The roster is the source of truth for who
  was expected.
- **Donations are cumulative season totals that Supercell resets monthly.** A raw
  reading is meaningless on its own; the figure comes from differencing
  `member_snapshots` (T2.9), and the difference goes negative at the reset.

- **Plan-vs-reality is a three-way split, not a diff.** `selection.ts` returns
  *selected and played*, *selected but absent*, and *played but not selected* —
  the third group is the one that surprises people, and a naive set difference
  drops it.
- **Bonus ranking is advisory.** `contribution.ts` suggests an order; the leader
  decides and the decision is recorded with a note (T4.7, T4B.13). Same rule as
  the inactivity score: never automate a decision about a person.

Services take `clanId` and pass it down. They never bypass the repositories to query
directly.

Two services are deliberately **cross-clan**: `rosters.ts` (a player may be in only
one roster per season across all three clans) and the availability pool behind
T4B.7. These take a set of clan IDs the user may see, resolved from `clan_roles` —
never a hardcoded list of three, and never "all clans" (R3).
