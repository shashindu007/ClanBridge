# Fixtures

T2.1 — real Clash of Clans API responses, saved verbatim. Two jobs:

1. The Zod schemas (T2.2) and mappers (T2.4) are written **against these**, not
   against the documentation, which is incomplete and occasionally wrong.
2. `USE_FIXTURES=true` makes the whole client read from here instead of the network,
   so every sync job runs offline with no API key and no rate limit.

All six files are currently `{}` placeholders. Capture them at T2.1.

| File | Endpoint |
|---|---|
| `clan.json` | `/clans/{tag}` |
| `currentwar.json` | `/clans/{tag}/currentwar` |
| `cwlgroup.json` | `/clans/{tag}/currentwar/leaguegroup` |
| `cwlwar.json` | `/clanwarleagues/wars/{warTag}` |
| `capitalraids.json` | `/clans/{tag}/capitalraidseasons` |
| `player.json` | `/players/{tag}` |

## Capturing them

```bash
curl -H "Authorization: Bearer $COC_API_TOKEN" \
  "https://api.clashofclans.com/v1/clans/%232PP0JCCL" > fixtures/clan.json
```

The `#` must be `%23` or you get a 404 on a perfectly valid tag.

## Timing

**`cwlgroup.json` and `cwlwar.json` can only be captured during an actual CWL week —
the first week of the month.** For the other three weeks the group endpoint returns
404 and there is nothing to save. If you reach T2.2 outside that window, write the
other schemas first and come back; do not invent a CWL fixture by hand, because the
shape you guess is the shape your parser will be wrong about.

`currentwar.json` is worth capturing more than once, in different states —
`notInWar`, `preparation`, `inWar`, `warEnded`. R10 says each is an ordinary
condition, and you cannot test that with a single fixture.

## These files are committed, and scrubbed

They are **not** gitignored: CI runs the offline suite from them, which is most of what
`USE_FIXTURES` exists for.

That means real clan-mates' data would otherwise sit in git history permanently, so
`capture-fixtures.ts` replaces identity before writing:

| Replaced | Kept exactly |
|---|---|
| Player names → `Player 01`, `Player 02`, … | Every number: donations, trophies, stars, destruction |
| Player tags → valid random tags from Supercell's alphabet | Every field name, type, array length and nesting |
| | Clan names, league names, badge URLs — not personal data |

The mapping is deterministic and shared across files, so a member who appears in both
`clan.json` and `player.json` gets the same replacement tag in each. Replacement tags are
built from `0289PYLQGRJCUV`, so they still satisfy `lib/tags.ts` and the database check
constraints.

Shapes are what the schemas and mappers are written against, and shapes are untouched.

## Editing them

Don't, beyond what the scrubber already does. A hand-tweaked fixture makes the parser pass
locally and fail against the live API. If you need a variant, save it as a separate file.
