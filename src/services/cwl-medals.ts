// What this season pays: the league table (data/cwl-medals.ts) applied to the
// group position (services/cwl-standings.ts) and each player's stars.
//
// Pure — the page gathers the three inputs and this does the arithmetic, so the
// medals page, the season tile and the printed report all say the same number.

import {
  bonusCount,
  leaguePayout,
  playerMedals,
  starShare,
  type LeaguePayout,
} from "@/data/cwl-medals";

export interface MedalPlayer {
  playerId: string;
  tag: string;
  name: string;
  warsPlayed: number;
  attacksUsed: number;
  stars: number;
  /** 0.2 – 1: the share of the placement payout their stars earn. */
  share: number;
  medals: number;
}

export interface MedalPlan {
  league: string;
  payout: LeaguePayout;
  /** 1–8. Null when the group was not captured, so no position is known. */
  position: number | null;
  /** False while the season is still running: the position may still move. */
  final: boolean;
  /** The full placement payout at this position — what 8 stars earns. */
  fullPayout: number | null;
  warsWon: number;
  bonusCount: number;
  bonusValue: number;
  players: MedalPlayer[];
}

export function medalPlan(input: {
  league: string | null;
  position: number | null;
  final: boolean;
  warsWon: number;
  players: Array<Omit<MedalPlayer, "share" | "medals">>;
}): MedalPlan | null {
  const payout = leaguePayout(input.league);
  if (!payout || !input.league) return null;
  const position = input.position;
  return {
    league: input.league,
    payout,
    position,
    final: input.final,
    fullPayout: position ? payout.byPosition[Math.min(8, Math.max(1, position)) - 1]! : null,
    warsWon: input.warsWon,
    bonusCount: bonusCount(payout, input.warsWon),
    bonusValue: payout.bonusValue,
    players: input.players
      .map((p) => ({
        ...p,
        share: starShare(p.stars),
        medals: position ? playerMedals(payout, position, p.stars) : 0,
      }))
      .sort((a, b) => b.stars - a.stars || b.attacksUsed - a.attacksUsed || a.name.localeCompare(b.name)),
  };
}
