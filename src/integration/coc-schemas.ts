// T2.2 — Zod schemas, one per endpoint.
//
// ⚠ WRITTEN AGAINST SUPERCELL'S DOCUMENTED SHAPES, NOT YET AGAINST CAPTURED JSON.
//
// IMPLEMENTATION.md wants these written against real fixtures, because a guessed
// shape is the shape the parser will be wrong about. No API key existed when
// they were written, so instead there is a gate: `npm run fixtures:capture`
// parses every captured file against every schema and fails loudly, naming the
// exact field, the moment reality disagrees. Run it and fix what it reports —
// that is the step that turns these from documented to verified.
//
// ── Design rule: PERMISSIVE ────────────────────────────────────────────────
// Every object is `looseObject`, so unknown fields pass through untouched.
// Supercell adds fields without notice, and a strict schema would turn a
// harmless addition into a failed CWL sync — losing a season that cannot be
// re-fetched. Fields this project actually reads are required; everything else
// is optional.
//
// Only shapes live here. Conversion to internal types is ./mappers/ (R7).

import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** `#2PP0JCCL`. Not validated against the alphabet here — normalisation is lib/tags.ts's job, and rejecting an odd-looking tag at the boundary would drop a real war. */
const tag = z.string().min(2);

/** `20260729T063000.000Z`. Kept a string; parsing is lib/coc-time.ts, called in the mappers. */
const cocTimestamp = z.string();

const badgeUrls = z
  .looseObject({
    small: z.string().optional(),
    medium: z.string().optional(),
    large: z.string().optional(),
  })
  .optional();

const league = z
  .looseObject({
    id: z.number().optional(),
    name: z.string().optional(),
    iconUrls: z.unknown().optional(),
  })
  .optional();

/**
 * In-game roles as the API spells them.
 *
 * Note `admin` — that is Supercell's wire name for Elder, and it catches people
 * out constantly. `notMember` appears in war rosters for players who have since
 * left. Mapped to our vocabulary in mappers/role.ts.
 */
export const apiRole = z.enum(["leader", "coLeader", "admin", "member", "notMember"]);

// ---------------------------------------------------------------------------
// /clans/{tag}
// ---------------------------------------------------------------------------

export const clanMemberSchema = z.looseObject({
  tag,
  name: z.string(),
  role: apiRole.optional(),
  townHallLevel: z.number().optional(),
  expLevel: z.number().optional(),
  league: league,
  trophies: z.number().optional(),
  builderBaseTrophies: z.number().optional(),
  clanRank: z.number().optional(),
  previousClanRank: z.number().optional(),
  donations: z.number().optional(),
  donationsReceived: z.number().optional(),
});

export const clanSchema = z.looseObject({
  tag,
  name: z.string(),
  clanLevel: z.number().optional(),
  badgeUrls,
  warLeague: league,
  members: z.number().optional(),
  memberList: z.array(clanMemberSchema).default([]),

  /**
   * T0.1 IS MACHINE-CHECKABLE AFTER ALL.
   *
   * The spec treats "confirm war logs are public" as a manual in-game check, but
   * the clan endpoint reports it directly. sync:clans reads it and warns, so a
   * clan switched to private mid-season is caught on the next hourly run rather
   * than discovered as an unexplained 403 in the war module weeks later.
   */
  isWarLogPublic: z.boolean().optional(),

  /** 'open' | 'inviteOnly' | 'closed'. Relevant to T0.11's invite-only question. */
  type: z.string().optional(),
  warWins: z.number().optional(),
  warWinStreak: z.number().optional(),
});

// ---------------------------------------------------------------------------
// /clans/{tag}/currentwar  and  /clanwarleagues/wars/{warTag}
// ---------------------------------------------------------------------------

export const warAttackSchema = z.looseObject({
  attackerTag: tag,
  defenderTag: tag,
  stars: z.number(),
  destructionPercentage: z.number(),
  order: z.number().optional(),
  duration: z.number().optional(),
});

export const warMemberSchema = z.looseObject({
  tag,
  name: z.string(),
  townhallLevel: z.number().optional(), // note the lowercase 'h' — differs from clanMember
  mapPosition: z.number().optional(),
  opponentAttacks: z.number().optional(),
  // ABSENT, not empty, when the player has not attacked. Missed attacks are
  // derived from roster minus attacks (T4.3), never from a zero-length array
  // that the API did not send.
  attacks: z.array(warAttackSchema).optional(),
  bestOpponentAttack: warAttackSchema.optional(),
});

export const warClanSchema = z.looseObject({
  tag: tag.optional(), // absent on some notInWar responses
  name: z.string().optional(),
  badgeUrls,
  clanLevel: z.number().optional(),
  attacks: z.number().optional(),
  stars: z.number().optional(),
  destructionPercentage: z.number().optional(),
  members: z.array(warMemberSchema).default([]),
});

/**
 * R10 — `notInWar` is an ordinary state for most of the month, and on it the API
 * returns almost nothing: no clan, no times, no roster. Everything below the
 * state is therefore optional. A schema that required them would make the war
 * sync fail three weeks out of four.
 */
export const warSchema = z.looseObject({
  state: z.string(),
  teamSize: z.number().optional(),
  attacksPerMember: z.number().optional(),
  preparationStartTime: cocTimestamp.optional(),
  startTime: cocTimestamp.optional(),
  endTime: cocTimestamp.optional(),
  clan: warClanSchema.optional(),
  opponent: warClanSchema.optional(),
  // CWL wars only. Identifies which of the group's wars this is.
  warTag: tag.optional(),
});

// ---------------------------------------------------------------------------
// /clans/{tag}/currentwar/leaguegroup
//
// 404s outside CWL week, which is the normal state for three weeks of every
// month (R10). The client raises CocNotFoundError; the caller treats it as a
// clean skip rather than a failure.
// ---------------------------------------------------------------------------

export const cwlGroupSchema = z.looseObject({
  state: z.string().optional(),
  // NOT 'YYYY-MM', whatever the documentation implies. The live API returned
  // '2026-08-03' — a full date. Left as a bare string here on purpose: this
  // schema records what Supercell actually sends, and `normaliseCwlSeason()` in
  // the mappers is what reduces it to the 'YYYY-MM' key the rest of the project
  // uses. Tightening this to a regex would turn a real CWL week into a failed
  // sync the first time the shape shifts again, which is the one outcome this
  // project cannot afford (R10).
  season: z.string(),
  clans: z
    .array(
      z.looseObject({
        tag,
        name: z.string().optional(),
        clanLevel: z.number().optional(),
        badgeUrls,
        members: z.array(z.looseObject({ tag, name: z.string().optional() })).default([]),
      }),
    )
    .default([]),
  // One entry per round. `#0` is a placeholder for a war that has not started —
  // it must be filtered out before fetching, or you get a 404 per round.
  rounds: z.array(z.looseObject({ warTags: z.array(z.string()).default([]) })).default([]),
});

// ---------------------------------------------------------------------------
// /clans/{tag}/capitalraidseasons
// ---------------------------------------------------------------------------

export const raidMemberSchema = z.looseObject({
  tag,
  name: z.string(),
  attacks: z.number().optional(),
  attackLimit: z.number().optional(),
  bonusAttackLimit: z.number().optional(),
  capitalResourcesLooted: z.number().optional(),
});

export const raidSeasonSchema = z.looseObject({
  state: z.string().optional(),
  startTime: cocTimestamp,
  endTime: cocTimestamp,
  capitalTotalLoot: z.number().optional(),
  raidsCompleted: z.number().optional(),
  totalAttacks: z.number().optional(),
  offensiveReward: z.number().optional(),
  defensiveReward: z.number().optional(),
  members: z.array(raidMemberSchema).optional(),
});

export const raidSeasonsSchema = z.looseObject({
  items: z.array(raidSeasonSchema).default([]),
  paging: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// /players/{tag}
// ---------------------------------------------------------------------------

export const achievementSchema = z.looseObject({
  name: z.string(),
  stars: z.number().optional(),
  value: z.number(),
  target: z.number().optional(),
  info: z.string().optional(),
  completionInfo: z.string().nullable().optional(),
  village: z.string().optional(),
});

/**
 * 'home' | 'builderBase'. Kept a string rather than an enum: a third village
 * (the Clan Capital already exists outside this endpoint) must not fail a sync.
 */
const village = z.string().optional();

/**
 * One troop, spell, pet or siege machine (T11B.1).
 *
 * `maxLevel` is the unit's ABSOLUTE maximum in the current game, NOT the cap for
 * this player's Town Hall — the TH17 fixture carries heroes at 100/110 and pets
 * at 10/15. Anything that means "maxed for their Town Hall" has to come from
 * src/data/game/, never from this field.
 *
 * Pets and siege machines arrive in `troops` with nothing to tell them apart
 * from an Archer. That grouping is game data too.
 */
export const unitSchema = z.looseObject({
  name: z.string(),
  level: z.number(),
  maxLevel: z.number(),
  village,
  /** Present only on super troops, and only true while one is boosted. */
  superTroopIsActive: z.boolean().optional(),
});

export const heroEquipmentSchema = z.looseObject({
  name: z.string(),
  level: z.number(),
  maxLevel: z.number(),
  village,
});

export const heroSchema = unitSchema.extend({
  /** What the hero is currently wearing — a subset of `heroEquipment`. */
  equipment: z.array(heroEquipmentSchema).optional(),
});

export const playerSchema = z.looseObject({
  tag,
  name: z.string(),
  townHallLevel: z.number().optional(),
  builderHallLevel: z.number().optional(),
  expLevel: z.number().optional(),
  trophies: z.number().optional(),
  bestTrophies: z.number().optional(),
  builderBaseTrophies: z.number().optional(),
  attackWins: z.number().optional(),
  defenseWins: z.number().optional(),
  warStars: z.number().optional(),
  donations: z.number().optional(),
  donationsReceived: z.number().optional(),
  role: apiRole.optional(),
  /**
   * 'in' | 'out' — the member's own in-game war preference.
   *
   * Worth capturing: T4B.7's availability pool can show it beside the poll
   * answer, which catches the case where someone answers "in" on a poll but has
   * war preference set to out in game and will never be picked by matchmaking.
   */
  warPreference: z.string().optional(),
  townHallWeaponLevel: z.number().optional(),
  clanCapitalContributions: z.number().optional(),
  clan: z
    .looseObject({ tag, name: z.string().optional(), badgeUrls })
    .optional(),
  league: league,
  // T7.4 derives Clan Games scores by differencing the "Games Champion"
  // achievement between two snapshots — the API exposes no per-season score.
  achievements: z.array(achievementSchema).default([]),
  // T11B.1 — base progress. `.default([])` for the reason `achievements` has it:
  // a TH3 account with no heroes must be [], not undefined, or every consumer
  // needs a null check.
  troops: z.array(unitSchema).default([]),
  heroes: z.array(heroSchema).default([]),
  heroEquipment: z.array(heroEquipmentSchema).default([]),
  spells: z.array(unitSchema).default([]),
});

// ---------------------------------------------------------------------------
// Every schema, keyed by the fixture it validates. Used by the capture gate to
// check reality against these assumptions the moment real JSON arrives.
// ---------------------------------------------------------------------------

export const FIXTURE_SCHEMAS = {
  "clan.json": clanSchema,
  "currentwar.json": warSchema,
  "cwlgroup.json": cwlGroupSchema,
  "cwlwar.json": warSchema,
  "capitalraids.json": raidSeasonsSchema,
  "player.json": playerSchema,
} as const;

export type ApiClan = z.infer<typeof clanSchema>;
export type ApiClanMember = z.infer<typeof clanMemberSchema>;
export type ApiWar = z.infer<typeof warSchema>;
export type ApiWarMember = z.infer<typeof warMemberSchema>;
export type ApiWarAttack = z.infer<typeof warAttackSchema>;
export type ApiCwlGroup = z.infer<typeof cwlGroupSchema>;
export type ApiRaidSeasons = z.infer<typeof raidSeasonsSchema>;
export type ApiRaidSeason = z.infer<typeof raidSeasonSchema>;
export type ApiPlayer = z.infer<typeof playerSchema>;
export type ApiUnit = z.infer<typeof unitSchema>;
export type ApiRole = z.infer<typeof apiRole>;
