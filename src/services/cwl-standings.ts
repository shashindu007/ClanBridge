// The CWL group table, derived from its wars (048). Never stored — see the
// migration's header for why a stored ranking is a second source of truth.
//
// HOW THE GAME RANKS A GROUP
//
//   stars        every star won across the week, PLUS 10 for each war won
//   tie-break    total destruction, summed over the wars
//
// A war still in battle day counts its stars and destruction as they stand —
// that is the "live" table the game shows mid-week — but its +10 goes to
// nobody until it ends, because until then nobody has won it.
//
// Preparation-day wars count for nothing: no attack is possible yet.

import type { GroupClan, GroupWar } from "@/repositories/cwl";

export const WIN_BONUS_STARS = 10;

export interface Standing {
  tag: string;
  name: string;
  badgeUrl: string | null;
  rank: number;
  /** Stars won in attacks plus the win bonus — the number the game ranks on. */
  stars: number;
  /** Stars won in attacks alone. */
  attackStars: number;
  destruction: number;
  wins: number;
  losses: number;
  ties: number;
  /** Wars that have started (live or over). */
  played: number;
  isUs: boolean;
}

function outcome(
  mine: number,
  theirs: number,
  mineDestruction: number,
  theirDestruction: number,
): "win" | "loss" | "tie" {
  if (mine !== theirs) return mine > theirs ? "win" : "loss";
  if (mineDestruction !== theirDestruction) return mineDestruction > theirDestruction ? "win" : "loss";
  return "tie";
}

export function groupStandings(
  clans: GroupClan[],
  wars: GroupWar[],
  ourTag: string,
): Standing[] {
  const rows = new Map<string, Omit<Standing, "rank">>();
  const row = (tag: string) => {
    let r = rows.get(tag);
    if (!r) {
      const clan = clans.find((c) => c.tag === tag);
      r = {
        tag,
        name: clan?.name ?? tag,
        badgeUrl: clan?.badgeUrl ?? null,
        stars: 0,
        attackStars: 0,
        destruction: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        played: 0,
        isUs: tag === ourTag,
      };
      rows.set(tag, r);
    }
    return r;
  };

  // Every clan in the group appears, even before its first war has a score.
  for (const clan of clans) row(clan.tag);

  for (const war of wars) {
    if (war.state !== "inWar" && war.state !== "warEnded") continue;
    const a = row(war.clanTag);
    const b = row(war.opponentTag);
    const aStars = war.clanStars ?? 0;
    const bStars = war.opponentStars ?? 0;
    const aPct = war.clanDestruction ?? 0;
    const bPct = war.opponentDestruction ?? 0;

    a.attackStars += aStars;
    b.attackStars += bStars;
    a.destruction += aPct;
    b.destruction += bPct;
    a.played += 1;
    b.played += 1;

    if (war.state !== "warEnded") continue;
    const result = outcome(aStars, bStars, aPct, bPct);
    if (result === "win") {
      a.wins += 1;
      b.losses += 1;
    } else if (result === "loss") {
      b.wins += 1;
      a.losses += 1;
    } else {
      a.ties += 1;
      b.ties += 1;
    }
  }

  const list = [...rows.values()].map((r) => ({ ...r, stars: r.attackStars + WIN_BONUS_STARS * r.wins }));
  list.sort(
    (x, y) =>
      y.stars - x.stars ||
      y.destruction - x.destruction ||
      x.name.localeCompare(y.name),
  );
  return list.map((r, index) => ({ ...r, rank: index + 1 }));
}

/** Our row, or null when the group was never captured. */
export function ourStanding(standings: Standing[]): Standing | null {
  return standings.find((s) => s.isUs) ?? null;
}
