// Internal domain types — the vocabulary everything above src/integration/ uses.
//
// R7 — no raw API field names past this boundary. Nothing outside integration/
// sees attackerTag, townhallLevel, opponentAttacks, or a timestamp shaped
// 20260729T063000.000Z. Dates here are real Date objects, tags are normalised,
// and roles use our four names rather than Supercell's.
//
// R11 — the two groups below are separate on purpose. Keep them separate here
// too, and do not write a convenience type that merges a roster with the API
// roster it is meant to be compared against.

// ---------------------------------------------------------------------------
// GAME FACTS — written by scripts/sync/ only
// ---------------------------------------------------------------------------

/** leader / co-leader / elder / member. Supercell calls Elder "admin" on the wire. */
export type ClanRole = "leader" | "co-leader" | "elder" | "member";

export type WarState = "preparation" | "inWar" | "warEnded";
export type WarResult = "win" | "lose" | "tie";

export interface Clan {
  tag: string;
  name: string;
  level?: number;
  badgeUrl?: string;
  warLeague?: string;
  memberCount?: number;
  /**
   * T0.1 — false means the war module cannot collect anything for this clan.
   * The API reports it, so it is checked on every sync rather than trusted once.
   */
  isWarLogPublic?: boolean;
}

export interface Player {
  tag: string;
  name: string;
  thLevel?: number;
  role?: ClanRole;
  trophies?: number;
  donations?: number;
  donationsReceived?: number;
  warStars?: number;
  expLevel?: number;
  league?: string;
  /** The clan the API currently reports them in, if any. */
  clanTag?: string;
}

/** One point-in-time reading, differenced across a season to derive real figures (T2.9). */
export interface MemberSnapshot {
  playerTag: string;
  donations?: number;
  donationsReceived?: number;
  trophies?: number;
  warStars?: number;
  thLevel?: number;
  role?: ClanRole;
}

export interface WarAttack {
  attackerTag: string;
  defenderTag: string;
  stars: number;
  destruction: number;
  order?: number;
}

export interface WarMember {
  tag: string;
  name: string;
  thLevel?: number;
  mapPosition?: number;
  /**
   * Empty when the player did not attack.
   *
   * The API omits the field entirely rather than sending an empty array, so this
   * is normalised here. Missed attacks are still DERIVED from roster minus
   * attacks (T4.3) — never stored as zero-star placeholder rows.
   */
  attacks: WarAttack[];
}

export interface War {
  state: WarState | "notInWar";
  teamSize?: number;
  attacksPerMember?: number;
  startTime?: Date;
  endTime?: Date;
  preparationStartTime?: Date;
  /** CWL only — identifies which war within the league group this is. */
  warTag?: string;
  clan?: WarSide;
  opponent?: WarSide;
}

export interface WarSide {
  tag?: string;
  name?: string;
  /** The clan's badge on api-assets.clashofclans.com (medium, else small). */
  badgeUrl?: string;
  stars?: number;
  destruction?: number;
  attackCount?: number;
  members: WarMember[];
}

export interface CwlGroup {
  /** 'YYYY-MM' */
  season: string;
  state?: string;
  clanTags: string[];
  /** Placeholder `#0` rounds are already filtered out — fetching one is a guaranteed 404. */
  warTags: string[];
}

export interface RaidSeason {
  startTime: Date;
  endTime: Date;
  totalLoot?: number;
  /** 'ongoing' | 'ended'. R10 — an ongoing weekend is not a failed sync. */
  state?: string;
  raidsCompleted?: number;
  totalAttacks?: number;
  /** Raid medals. The offensive one is what every member is paid. */
  offensiveReward?: number;
  defensiveReward?: number;
  participants: RaidParticipant[];
}

export interface RaidParticipant {
  playerTag: string;
  name: string;
  attacksUsed?: number;
  /**
   * The denominator, and the reason 027 exists.
   *
   * It is per-member and it varies — a bonus attack goes to some members and
   * not others — so unlike a regular war's two attacks it cannot be inferred
   * from a constant. `attacksUsed` alone cannot answer "did they do what was
   * asked": 5 of 5 and 5 of 6 are different answers.
   */
  attackLimit?: number;
  bonusAttackLimit?: number;
  loot?: number;
}

export interface PlayerDetail extends Player {
  /** T7.4 differences the "Games Champion" value between two snapshots. */
  gamesChampionValue?: number;
}

/** Which village a unit belongs to. Supercell spells the second one "builderBase". */
export type Village = "home" | "builder";

/**
 * One hero, piece of equipment, troop, pet, siege machine or spell (T11B.2).
 *
 * `apiMax` is named for where it came from because it is NOT what most readers
 * will assume: it is the game's absolute maximum, not the cap for this player's
 * Town Hall. The Town Hall cap lives in src/data/game/.
 */
export interface ProgressUnit {
  name: string;
  level: number;
  apiMax: number;
  village: Village;
}

/** Everything the player endpoint says about how far along a village is. */
/**
 * 052 — the lifetime donation achievements and the clan counters, read from ONE
 * /players response so they describe the same instant.
 *
 * Each field is undefined when the API omitted it, never 0: a zero would be a
 * real reading of nothing donated and would corrupt every difference taken
 * against it.
 */
export interface DonationCounters {
  tag: string;
  /** The clan the API says the player is in right now, if any. */
  clanTag?: string;
  /** "Friend in Need" — troop capacity donated, lifetime. */
  troopsDonated?: number;
  /** "Sharing is caring" — spell capacity donated, lifetime. */
  spellsDonated?: number;
  /** "Siege Sharer" — siege machines donated, lifetime. */
  siegesDonated?: number;
  /** The clan counter: since the last reset or the last clan join. */
  clanDonations?: number;
  clanDonationsReceived?: number;
}

export interface PlayerProgress {
  tag: string;
  thLevel?: number;
  thWeaponLevel?: number;
  bhLevel?: number;
  heroes: ProgressUnit[];
  equipment: ProgressUnit[];
  /** Troops, pets, siege machines and super troops — the API does not separate them. */
  troops: ProgressUnit[];
  spells: ProgressUnit[];
}

// ---------------------------------------------------------------------------
// HUMAN DECISIONS — written by people through the app only (R11)
//
// Typed as their tasks land: Poll, PollOption, PollResponse, CwlRoster,
// CwlRosterMember, WarLineup, WarLineupMember, WarTarget, CwlBonus,
// Announcement, BaseLayout.
// ---------------------------------------------------------------------------
