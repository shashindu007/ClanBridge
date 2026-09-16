// T2.4 — API shape to internal type.
//
// R7 — THIS IS THE BOUNDARY. No raw API field name escapes this folder. Above
// src/integration/, nothing sees attackerTag, townhallLevel, opponentAttacks, or
// a timestamp shaped 20260729T063000.000Z.
//
// Everything here is a pure function: no database, no network, no clock. That is
// what makes them testable against fixtures alone, and it is why a mapper never
// decides anything — it only translates.

import { parseCocTime, parseCocTimeOrNull } from "@/lib/coc-time";
import { normaliseTag } from "@/lib/tags";
import type {
  Clan,
  ClanRole,
  CwlGroup,
  MemberSnapshot,
  Player,
  PlayerDetail,
  PlayerProgress,
  ProgressUnit,
  RaidSeason,
  Village,
  War,
  WarAttack,
  WarMember,
  WarSide,
  WarState,
} from "@/types/domain";
import type {
  ApiClan,
  ApiClanMember,
  ApiCwlGroup,
  ApiPlayer,
  ApiRaidSeasons,
  ApiRole,
  ApiUnit,
  ApiWar,
  ApiWarAttack,
  ApiWarMember,
} from "../coc-schemas";

/**
 * Supercell's role names to ours.
 *
 * `admin` is Elder. That single mismatch is the most common mapping mistake
 * against this API, because "admin" reads like a leadership rank and is not one.
 * `notMember` appears in war rosters for players who have since left the clan.
 */
export function mapRole(role: ApiRole | undefined): ClanRole | undefined {
  switch (role) {
    case "leader":
      return "leader";
    case "coLeader":
      return "co-leader";
    case "admin":
      return "elder";
    case "member":
      return "member";
    default:
      return undefined;
  }
}

export function mapClan(api: ApiClan): Clan {
  return {
    tag: normaliseTag(api.tag),
    name: api.name,
    level: api.clanLevel,
    badgeUrl: api.badgeUrls?.medium ?? api.badgeUrls?.small,
    warLeague: api.warLeague?.name,
    memberCount: api.members ?? api.memberList.length,
    isWarLogPublic: api.isWarLogPublic,
  };
}

export function mapClanMember(api: ApiClanMember, clanTag?: string): Player {
  return {
    tag: normaliseTag(api.tag),
    name: api.name,
    thLevel: api.townHallLevel,
    role: mapRole(api.role),
    trophies: api.trophies,
    donations: api.donations,
    donationsReceived: api.donationsReceived,
    expLevel: api.expLevel,
    league: api.league?.name,
    clanTag: clanTag ? normaliseTag(clanTag) : undefined,
  };
}

export function mapClanMembers(api: ApiClan): Player[] {
  return api.memberList.map((m) => mapClanMember(m, api.tag));
}

/**
 * T2.9 — the snapshot written on every sync run.
 *
 * warStars is absent from the clan member list; it only appears on the player
 * endpoint. Left undefined rather than defaulted to 0, because a 0 would look
 * like a real reading and corrupt the season difference.
 */
export function mapSnapshot(api: ApiClanMember): MemberSnapshot {
  return {
    playerTag: normaliseTag(api.tag),
    donations: api.donations,
    donationsReceived: api.donationsReceived,
    trophies: api.trophies,
    thLevel: api.townHallLevel,
    role: mapRole(api.role),
  };
}

export function mapPlayer(api: ApiPlayer): PlayerDetail {
  const gamesChampion = api.achievements.find((a) => a.name === "Games Champion");

  return {
    tag: normaliseTag(api.tag),
    name: api.name,
    thLevel: api.townHallLevel,
    role: mapRole(api.role),
    trophies: api.trophies,
    donations: api.donations,
    donationsReceived: api.donationsReceived,
    warStars: api.warStars,
    expLevel: api.expLevel,
    league: api.league?.name,
    clanTag: api.clan ? normaliseTag(api.clan.tag) : undefined,
    gamesChampionValue: gamesChampion?.value,
  };
}

/**
 * 'builderBase' to 'builder'; anything else — including a missing field — is the
 * home village, which is where every unit lived before the Builder Base existed.
 */
function mapVillage(village: string | undefined): Village {
  return village === "builderBase" ? "builder" : "home";
}

function mapUnit(api: Pick<ApiUnit, "name" | "level" | "maxLevel" | "village">): ProgressUnit {
  return {
    name: api.name,
    level: api.level,
    apiMax: api.maxLevel,
    village: mapVillage(api.village),
  };
}

/**
 * T11B.2 — how far along a village is, as the API reports it.
 *
 * A separate function from mapPlayer() rather than more fields on PlayerDetail:
 * clan-games maps a player once per member for one achievement value, and has no
 * use for 150 unit objects per call.
 *
 * It translates and does not classify. Which troop is a pet, which is a super
 * troop and what this Town Hall allows are game data, and a mapper that decided
 * them would be the one place nobody looks after a game update.
 */
export function mapPlayerProgress(api: ApiPlayer): PlayerProgress {
  return {
    tag: normaliseTag(api.tag),
    thLevel: api.townHallLevel,
    thWeaponLevel: api.townHallWeaponLevel,
    bhLevel: api.builderHallLevel,
    heroes: api.heroes.map(mapUnit),
    equipment: api.heroEquipment.map(mapUnit),
    troops: api.troops.map(mapUnit),
    spells: api.spells.map(mapUnit),
  };
}

function mapWarAttack(api: ApiWarAttack): WarAttack {
  return {
    attackerTag: normaliseTag(api.attackerTag),
    defenderTag: normaliseTag(api.defenderTag),
    stars: api.stars,
    // Renamed from destructionPercentage: shorter, and it stops the raw name
    // leaking into service and repository code.
    destruction: api.destructionPercentage,
    order: api.order,
  };
}

function mapWarMember(api: ApiWarMember): WarMember {
  return {
    tag: normaliseTag(api.tag),
    name: api.name,
    // townhallLevel — lowercase 'h' on war endpoints, capital 'H' on the clan
    // endpoint. Absorbed here so nothing above ever has to remember which.
    thLevel: api.townhallLevel,
    mapPosition: api.mapPosition,
    // The API OMITS this field for a player who did not attack. Normalised to []
    // so callers can iterate safely — but a missed attack is still derived from
    // roster minus attacks (T4.3), never stored as a zero-star row.
    attacks: (api.attacks ?? []).map(mapWarAttack),
  };
}

function mapWarSide(api: NonNullable<ApiWar["clan"]>): WarSide {
  return {
    tag: api.tag ? normaliseTag(api.tag) : undefined,
    name: api.name,
    stars: api.stars,
    destruction: api.destructionPercentage,
    attackCount: api.attacks,
    members: api.members.map(mapWarMember),
  };
}

const WAR_STATES: WarState[] = ["preparation", "inWar", "warEnded"];

/**
 * R10 — `notInWar` is an ordinary state, not a failure, and on it the API sends
 * almost nothing. Every field below the state is therefore optional, and an
 * unrecognised state is passed through rather than throwing: Supercell has added
 * states before, and a war sync that dies on an unknown one loses the war.
 */
export function mapWar(api: ApiWar): War {
  const state = WAR_STATES.includes(api.state as WarState)
    ? (api.state as WarState)
    : "notInWar";

  return {
    state,
    teamSize: api.teamSize,
    attacksPerMember: api.attacksPerMember,
    startTime: parseCocTimeOrNull(api.startTime) ?? undefined,
    endTime: parseCocTimeOrNull(api.endTime) ?? undefined,
    preparationStartTime: parseCocTimeOrNull(api.preparationStartTime) ?? undefined,
    warTag: api.warTag ? normaliseTag(api.warTag) : undefined,
    clan: api.clan ? mapWarSide(api.clan) : undefined,
    opponent: api.opponent ? mapWarSide(api.opponent) : undefined,
  };
}

/**
 * The API's season string, reduced to the 'YYYY-MM' every other layer expects.
 *
 * THE FIRST REAL-DATA BUG T2.1 CAUGHT, and a textbook one. The synthetic fixture
 * carried `"2026-07"`, because that is what the documented shape looked like. The
 * live API returned **`"2026-08-03"`** — a full date, the day the round opened.
 *
 * `coc-schemas.ts` declares this field as a bare `z.string()`, so the capture's
 * validation gate passed it without complaint and the wrong shape travelled all
 * the way to the database. That is precisely the failure IMPLEMENTATION.md
 * predicts: "the shape you guess is the shape the parser will be wrong about."
 *
 * WHY THIS MATTERS MORE THAN A DISPLAY GLITCH. `season` is a natural key:
 *
 *   cwl_seasons(clan_id, season)     written by the sync, from this value
 *   cwl_rosters.season               written by the LEADER, through the UI
 *
 * T4B.6's rule — a player may appear in only one roster per season across all
 * three clans — compares those two. `"2026-08-03"` and `"2026-08"` are different
 * strings, so the constraint would have matched nothing, every season lookup
 * would have returned null, and the double-booking it exists to prevent would
 * have been discovered on CWL day one. Silently, with no error anywhere.
 *
 * Truncating is safe because CWL runs once per calendar month, so 'YYYY-MM'
 * identifies a season uniquely. A value that is already 'YYYY-MM' passes through
 * unchanged, so this handles both shapes rather than betting on the new one.
 */
export function normaliseCwlSeason(season: string): string {
  const match = /^(\d{4}-\d{2})/.exec(season);
  // Unrecognised shapes are returned untouched rather than mangled: a third
  // format would then surface as a visibly odd season key, which is findable,
  // instead of being silently truncated into a plausible-looking wrong month.
  return match ? match[1]! : season;
}

/**
 * `#0` is the API's placeholder for a round that has not started. Fetching one
 * is a guaranteed 404, so they are filtered out here rather than in every caller.
 */
export function mapCwlGroup(api: ApiCwlGroup): CwlGroup {
  return {
    season: normaliseCwlSeason(api.season),
    state: api.state,
    clanTags: api.clans.map((c) => normaliseTag(c.tag)),
    warTags: api.rounds
      .flatMap((r) => r.warTags)
      .filter((t) => t && t !== "#0")
      .map((t) => normaliseTag(t)),
  };
}

/**
 * Every field the response carries, not the four that fitted the old table.
 *
 * The mapper is where the discard bug lives each time it happens: 019, 020 and
 * 026 were all cases of the API having already sent something and nothing
 * carrying it further. Widen this and `RaidSeason` together with the migration
 * — a mapper that drops a column the table now has is how the fifth one starts.
 */
export function mapRaidSeasons(api: ApiRaidSeasons): RaidSeason[] {
  return api.items.map((season) => ({
    startTime: parseCocTime(season.startTime),
    endTime: parseCocTime(season.endTime),
    totalLoot: season.capitalTotalLoot,
    state: season.state,
    raidsCompleted: season.raidsCompleted,
    totalAttacks: season.totalAttacks,
    offensiveReward: season.offensiveReward,
    defensiveReward: season.defensiveReward,
    participants: (season.members ?? []).map((m) => ({
      playerTag: normaliseTag(m.tag),
      name: m.name,
      attacksUsed: m.attacks,
      attackLimit: m.attackLimit,
      bonusAttackLimit: m.bonusAttackLimit,
      loot: m.capitalResourcesLooted,
    })),
  }));
}
