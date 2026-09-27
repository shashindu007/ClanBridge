// CWL league medals — what the game pays, by league and final group position.
//
// THE API DOES NOT REPORT MEDALS. Not per player, not per clan, and not the
// bonus medals a leader hands out in game. What it does report is enough to
// work them out: the clan's war league (clans.war_league), and every war in the
// group (cwl_group_wars, 048), from which the final position is derived
// (services/cwl-standings.ts). This table is the third piece.
//
// SOURCE: War Report, "How are Clan War League medals calculated?"
//   https://warreport.app/about/blog/clan_war_league_medals/
// read 27 Sept 2026, cross-checked against the Clash of Clans wiki's CWL page
// and its FAQ for the star rule. Supercell changes these with game updates —
// Titan and Legend leagues are recent — so when a leader reports that the
// in-game results screen disagrees, the game is right and this file is stale.
//
// THE STAR RULE (Clash of Clans wiki, CWL FAQ): a player earns 20% of their
// clan's placement payout for being on the roster, plus 10% per war star they
// win across the week, reaching the full payout at 8 stars. A player on the
// roster who is never put on the war map gets the 20% floor.
//
// BONUS MEDALS are given by the clan leader IN GAME, after the season. The
// league sets how many and how much each is worth; every war the clan wins adds
// one more. This site shows those numbers and the evidence for the choice. It
// does not record who received them — the game does, and a second record here
// was a second place for them to disagree.

export interface LeaguePayout {
  /** Medals for finishing 1st … 8th in the group, before the star rule. */
  byPosition: readonly [number, number, number, number, number, number, number, number];
  /** What one bonus medal award is worth. */
  bonusValue: number;
  /** Bonus awards guaranteed before any war wins. */
  bonusBase: number;
}

/** Keyed by the league's name exactly as the API spells it. */
export const CWL_MEDALS: Readonly<Record<string, LeaguePayout>> = {
  "Bronze League III": { byPosition: [46, 44, 42, 40, 38, 36, 34, 32], bonusValue: 42, bonusBase: 1 },
  "Bronze League II": { byPosition: [58, 56, 54, 52, 50, 48, 46, 44], bonusValue: 45, bonusBase: 1 },
  "Bronze League I": { byPosition: [70, 68, 66, 64, 62, 60, 58, 56], bonusValue: 48, bonusBase: 1 },
  "Silver League III": { byPosition: [88, 85, 82, 79, 76, 73, 70, 67], bonusValue: 51, bonusBase: 1 },
  "Silver League II": { byPosition: [106, 103, 100, 97, 94, 91, 88, 85], bonusValue: 54, bonusBase: 1 },
  "Silver League I": { byPosition: [124, 121, 118, 115, 112, 109, 106, 103], bonusValue: 57, bonusBase: 1 },
  "Gold League III": { byPosition: [148, 144, 140, 136, 132, 128, 124, 120], bonusValue: 60, bonusBase: 2 },
  "Gold League II": { byPosition: [172, 168, 164, 160, 156, 152, 148, 144], bonusValue: 63, bonusBase: 2 },
  "Gold League I": { byPosition: [196, 192, 188, 184, 180, 176, 172, 168], bonusValue: 66, bonusBase: 2 },
  "Crystal League III": { byPosition: [220, 216, 212, 208, 204, 200, 196, 192], bonusValue: 69, bonusBase: 2 },
  "Crystal League II": { byPosition: [244, 240, 236, 232, 228, 224, 220, 216], bonusValue: 72, bonusBase: 2 },
  "Crystal League I": { byPosition: [274, 269, 264, 259, 254, 249, 244, 239], bonusValue: 75, bonusBase: 2 },
  "Master League III": { byPosition: [304, 299, 294, 289, 284, 279, 274, 269], bonusValue: 78, bonusBase: 3 },
  "Master League II": { byPosition: [334, 329, 324, 319, 314, 309, 304, 299], bonusValue: 81, bonusBase: 3 },
  "Master League I": { byPosition: [364, 359, 354, 349, 344, 339, 334, 329], bonusValue: 84, bonusBase: 3 },
  "Champion League III": { byPosition: [388, 384, 380, 376, 372, 368, 364, 360], bonusValue: 87, bonusBase: 4 },
  "Champion League II": { byPosition: [412, 408, 404, 400, 396, 392, 388, 384], bonusValue: 90, bonusBase: 4 },
  "Champion League I": { byPosition: [436, 432, 428, 424, 420, 416, 412, 408], bonusValue: 93, bonusBase: 4 },
  "Titan League III": { byPosition: [454, 451, 448, 445, 442, 439, 436, 433], bonusValue: 96, bonusBase: 5 },
  "Titan League II": { byPosition: [472, 469, 466, 463, 460, 457, 454, 451], bonusValue: 99, bonusBase: 5 },
  "Titan League I": { byPosition: [490, 487, 484, 481, 478, 475, 472, 469], bonusValue: 102, bonusBase: 5 },
  "Legend League": { byPosition: [508, 505, 502, 499, 496, 493, 490, 487], bonusValue: 105, bonusBase: 6 },
};

/** Every league, lowest first — the order for a picker. */
export const CWL_LEAGUES: readonly string[] = Object.keys(CWL_MEDALS);

/**
 * The payout table for a league, or null for an unknown or unranked one.
 *
 * Forgiving about "League" and case, because the name reaches this from three
 * places (the API, a stored season, a URL) and "Master III" meaning Master
 * League III is not worth a blank medals page.
 */
export function leaguePayout(league: string | null | undefined): LeaguePayout | null {
  if (!league) return null;
  const exact = CWL_MEDALS[league];
  if (exact) return exact;
  const norm = (s: string) => s.toLowerCase().replace(/\bleague\b/g, "").replace(/\s+/g, " ").trim();
  const wanted = norm(league);
  const hit = CWL_LEAGUES.find((name) => norm(name) === wanted);
  return hit ? CWL_MEDALS[hit]! : null;
}

/** The canonical name for a league, as the table spells it. */
export function canonicalLeague(league: string | null | undefined): string | null {
  if (!league) return null;
  if (CWL_MEDALS[league]) return league;
  const payout = leaguePayout(league);
  return payout ? (CWL_LEAGUES.find((name) => CWL_MEDALS[name] === payout) ?? null) : null;
}

/** Stars at which a player earns the full placement payout. */
export const FULL_PAYOUT_STARS = 8;

/** 20% for being on the roster, +10% a star, capped at 100%. */
export function starShare(stars: number): number {
  const s = Math.max(0, Math.floor(stars));
  return Math.min(1, 0.2 + 0.1 * s);
}

/**
 * One player's league medals: the placement payout scaled by their stars.
 * Rounded, and shown as approximate on the page — the game's own rounding is
 * not documented.
 */
export function playerMedals(payout: LeaguePayout, position: number, stars: number): number {
  const index = Math.min(8, Math.max(1, Math.round(position))) - 1;
  return Math.round(payout.byPosition[index]! * starShare(stars));
}

/** How many bonus medals the leader may give in game: the base plus one per win. */
export function bonusCount(payout: LeaguePayout, warsWon: number): number {
  return payout.bonusBase + Math.max(0, warsWon);
}
