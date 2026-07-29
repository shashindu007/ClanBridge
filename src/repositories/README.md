# Repositories

Database access. One file per aggregate: `cwl.ts`, `wars.ts`, `players.ts`,
`raids.ts`, `layouts.ts`, `announcements.ts`, `sync-log.ts`, `audit.ts`.

Starts being filled at T4.3.

## R3 — every query filters by clan

Three clans share one database. Every function here takes `clanId` and uses it, even
when a join makes it look redundant.

**This is the single most common AI-generated bug in this project.** The shape it
takes is always the same:

```ts
// WRONG — war_id alone does not prove the caller may see this war
.from("cwl_attacks").select("*").eq("war_id", warId)

// RIGHT
.from("cwl_attacks").select("*").eq("war_id", warId).eq("clan_id", clanId)
```

RLS (T1.9) is the safety net for the ones that slip through. It is not a substitute
for reading the query.

## R11 — two kinds of table, never mixed

Repositories fall into two groups, and a single file must not span both.

| Group | Written by | Tables |
|---|---|---|
| **Game facts** | `scripts/sync/` only | `players`, `cwl_attacks`, `war_attacks`, `member_snapshots`, `raid_*`, `clan_games_*` |
| **Human decisions** | the app only | `polls`, `poll_responses`, `cwl_rosters`, `war_lineups`, `war_targets`, `cwl_bonuses`, `announcements` |

A repository function that writes to a game-fact table from a form is a bug. A
sync job importing a human-decision repository is a bug.

## R12 — never overwrite the plan with the outcome

`cwl_roster_members` is who the leader chose. The API roster is who actually
played. Both are kept; the difference between them is the report at T4B.11 and
T6.10, and it is the most useful thing this system produces.

The tempting "cleanup" — reconciling the roster against what the API reported, so
there is one list instead of two — silently deletes the only record of who was
picked and did not show up. There is no way to recover it (R4).

## R4 — nothing is deleted

No `DELETE` statements. Set `deleted_at` and filter `.is("deleted_at", null)` on read.
Deleted CWL history cannot be re-fetched from anywhere.

## Writes go through lib/audit.ts

Every mutation records who did it and when.
