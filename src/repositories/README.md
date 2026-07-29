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

## R4 — nothing is deleted

No `DELETE` statements. Set `deleted_at` and filter `.is("deleted_at", null)` on read.
Deleted CWL history cannot be re-fetched from anywhere.

## Writes go through lib/audit.ts

Every mutation records who did it and when.
