// The Player rating: every section's marks turned into one number per player.
//
// The clan set these rules; this file is the one place they are written down.
// DONATION_MARKS and RATING_WEIGHTS hold every number, and /rating prints from
// the same constants, so the explanation cannot drift from the sums.
//
//   DONATION MARKS   +1 for every 1,000 given in the family, -1 for every 2,000
//                    received, +1 for every 2,000 given in other clans, all in
//                    proportion (1,500 given is +1.50).
//
//   SHARE            a player's marks in a section ÷ the plus marks of every
//                    player in the WHOLE FAMILY, as a %. War, CWL, Clan Games
//                    and raids use the `marks` their own pages show, not their
//                    ratings: those are shares of one clan, and a share of a
//                    small lineup is worth more than a share of a large one.
//                    Marks are not, so they are what compares across clans.
//
//   RATING           20% donations + 20% war + 30% CWL + 10% Clan Games + 20%
//                    raids, each of those being the share above.
//
// MISSING A SECTION IS ZERO. A player not fielded in CWL scores nothing for it
// and the weights stay put: sharing them out over the rest would reward sitting
// a section out. A section nobody has marks in yet is zero for everyone, so the
// rating fills up through the month.
//
// STORED, UNLIKE THE SECTIONS' OWN RATINGS. No viewer can read every clan, and
// the service key never reaches Vercel (R6), so scripts/sync/ratings.ts works
// this out and migration 073 holds the result.

import type { RatingKind } from "@/lib/rating";
import { round2 } from "@/services/raid-rating";
import type { SeasonDonation } from "@/services/season-donations";

export const DONATION_MARKS = {
  /** Given in a family clan: `marks` for every `per`, in proportion. */
  given: { per: 1_000, marks: 1 },
  received: { per: 2_000, marks: -1 },
  /** Given in a clan outside the family. */
  other: { per: 2_000, marks: 1 },
} as const;

/** % of the rating each section is worth. Adds up to 100. */
export const RATING_WEIGHTS: Readonly<Record<RatingKind, number>> = {
  donations: 20,
  war: 20,
  cwl: 30,
  games: 10,
  raids: 20,
};

/** The lowest a share can go, as on the section ratings. */
export const WORST_SHARE = -100;

export const RATING_KINDS = Object.keys(RATING_WEIGHTS) as RatingKind[];

/** A season's donations as marks. No reading of other clans counts as none. */
export function donationMarks(row: Pick<SeasonDonation, "byClan" | "other" | "received">): number {
  const given = row.byClan.reduce((sum, clan) => sum + clan.given, 0);
  const { given: g, received: r, other: o } = DONATION_MARKS;
  return round2(
    (given / g.per) * g.marks +
      (row.received / r.per) * r.marks +
      ((row.other ?? 0) / o.per) * o.marks,
  );
}

export interface PlayerRating {
  playerId: string;
  /** Marks per section, 0 where they have none. */
  marks: Record<RatingKind, number>;
  /** % of the family's plus marks per section. */
  shares: Record<RatingKind, number>;
  /** The shares, weighed by RATING_WEIGHTS. */
  rating: number;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Every player's rating, best first.
 *
 * `players` are who is ranked, and the only ones whose marks count towards a
 * share: a mark held by anybody else is ignored.
 */
export function playerRatings(
  players: readonly string[],
  marks: Readonly<Record<RatingKind, ReadonlyMap<string, number>>>,
): PlayerRating[] {
  const plusMarks = Object.fromEntries(
    RATING_KINDS.map((kind) => [
      kind,
      players.reduce((sum, id) => sum + Math.max(0, marks[kind].get(id) ?? 0), 0),
    ]),
  ) as Record<RatingKind, number>;

  return players
    .map((playerId) => {
      const held = {} as Record<RatingKind, number>;
      const shares = {} as Record<RatingKind, number>;
      let rating = 0;

      for (const kind of RATING_KINDS) {
        held[kind] = round2(marks[kind].get(playerId) ?? 0);
        const share =
          plusMarks[kind] > 0
            ? Math.max(WORST_SHARE, (held[kind] / plusMarks[kind]) * 100)
            : 0;
        shares[kind] = round3(share);
        rating += (share * RATING_WEIGHTS[kind]) / 100;
      }

      return { playerId, marks: held, shares, rating: round3(rating) };
    })
    .sort((a, b) => b.rating - a.rating || a.playerId.localeCompare(b.playerId));
}
