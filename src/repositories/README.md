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
```

### Not every table has a `clan_id` to filter on

An earlier version of this file finished that example with
`.eq("clan_id", clanId)`. **That column does not exist on `cwl_attacks`** — nor on
`cwl_wars` or `cwl_war_members`. Copying it produces a query that fails outright,
and the natural next move is to drop the clan check entirely, which is how the
advice ends up causing the bug it warns about.

Where the column exists (`players`, `cwl_seasons`, `wars`, `announcements`,
`member_snapshots`), filter on it directly. Where it does not, resolve the parent
under an explicit clan filter first and then read children by that id:

```ts
// RIGHT — the season is proven to be this clan's, so its wars and their
// attacks are too. Mirrors the RLS policy's own join (006_rls.sql:172-181).
const season = await seasonByName(supabase, clanId, "2026-08"); // .eq("clan_id", clanId)
const wars   = await warsInSeason(supabase, season.id);
const attacks = await attacksForWar(supabase, wars[0].id);
```

The chain is `cwl_attacks → cwl_wars → cwl_seasons.clan_id`. See
[`cwl.ts`](./cwl.ts) for the worked implementation.

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

## Audited writes go through SQL functions, not through this layer

Every mutation records who did it and when — but **not** by having the
application append an `audit_log` row after the fact. That needs two statements
with no transaction between them, and an INSERT policy on `audit_log` that would
let any signed-in member forge entries attributing actions to anyone.

So an audited write is a `security definer` function that writes the row and its
audit entry, or neither: `approve_account()` / `reject_account()` (015, 017),
`link_verified_player()` (016), `post_announcement()` / `edit_announcement()` /
`remove_announcement()` (021). `audit_log` has no insert policy and must not get
one.

`lib/audit.ts` is the READ side — the shared vocabulary plus the queries T9.6's
viewer needs. Its header explains the reasoning in full.
