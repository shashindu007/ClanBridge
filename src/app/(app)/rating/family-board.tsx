// The stored family ranking, read and turned into board rows, for the two
// pages that show it: Overall (/rating) and the donations board.
//
// Donations ranks on the same stored numbers as Overall's Donations column, so
// the two can never disagree; a figure worked out from the season report would
// not count a family clan the viewer is outside of the way the rating does.
//
// R3 — THE WHOLE FAMILY, ON PURPOSE: see family_player_ratings() (073). A player
// is linked only in a clan the viewer belongs to, because the profile is a 404
// anywhere else.

import { redirect } from "next/navigation";
import { currentUserId } from "@/lib/auth";
import { clanAccent } from "@/lib/clan-accent";
import { visibleClans } from "@/lib/clans";
import { openMonths, rankAnchor } from "@/lib/rating";
import { createClient } from "@/lib/supabase/server";
import { canSeeMemberStats } from "@/lib/visibility";
import type { BoardRow, ChoiceItem } from "@/components/rating-board";
import type { DockEntry } from "@/components/rank-dock";
import { basesForUser } from "@/repositories/account-bases";
import { familyRatings, ratingMonths, type RatedPlayer } from "@/repositories/player-ratings";

export type FamilyLoad =
  | { kind: "no-clan" }
  | { kind: "no-month" }
  | {
      kind: "ok";
      months: string[];
      month: string;
      everyone: RatedPlayer[];
      /** The viewer's own villages, by player id. */
      ownIds: Set<string>;
      /** The clans whose profiles this viewer may open. */
      mine: Set<string>;
      /** Still counting: this month, or last month until the 10th. */
      isOpen: boolean;
    };

/** Every rated player in the month asked for, or the latest one. */
export async function loadFamily(monthParam: string | undefined): Promise<FamilyLoad> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clans = (await visibleClans(supabase, userId)).filter((c) => canSeeMemberStats(c.role));
  if (clans.length === 0) return { kind: "no-clan" };

  const months = await ratingMonths(supabase);
  // An unknown or missing month is the latest one, never an error.
  const month = months.find((m) => m === monthParam) ?? months[0] ?? null;
  if (!month) return { kind: "no-month" };

  const [everyone, bases] = await Promise.all([familyRatings(supabase, month), basesForUser(supabase, userId)]);
  return {
    kind: "ok",
    months,
    month,
    everyone,
    ownIds: new Set(bases.map((b) => b.playerId)),
    mine: new Set(clans.map((c) => c.id)),
    isOpen: openMonths(new Date()).includes(month),
  };
}

export interface FamilyClan {
  id: string;
  tag: string;
  name: string;
  count: number;
}

/** Every clan with a rated player this month, by name. */
export function familyClans(everyone: readonly RatedPlayer[]): FamilyClan[] {
  const counts = new Map<string, FamilyClan>();
  for (const p of everyone) {
    const clan = counts.get(p.clanId) ?? { id: p.clanId, tag: p.clanTag, name: p.clanName, count: 0 };
    clan.count += 1;
    counts.set(p.clanId, clan);
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** "All clans", then each clan in its colour. */
export function clanChoices(
  clans: readonly FamilyClan[],
  total: number,
  only: FamilyClan | null,
  href: (clanTag: string | null) => string,
): ChoiceItem[] {
  return [
    { href: href(null), label: "All clans", active: !only, count: total },
    ...clans.map((clan) => ({
      href: href(clan.tag),
      label: clan.name,
      active: only?.id === clan.id,
      count: clan.count,
      dot: clanAccent(clan.id).color,
    })),
  ];
}

export const profileHref = (mine: ReadonlySet<string>, p: RatedPlayer): string | null =>
  mine.has(p.clanId) ? `/${encodeURIComponent(p.clanTag)}/player/${encodeURIComponent(p.tag)}` : null;

/** One stored player as a board row; the page says what the rating and cells are. */
export function familyRow(
  p: RatedPlayer,
  {
    rank,
    tied,
    medal,
    oneClan,
    mine,
    ownIds,
    rating,
    cells,
  }: {
    rank: number;
    tied: boolean;
    medal: boolean;
    /** One clan is shown: its own place leads the podium, and is said under the name. */
    oneClan: { place: number; size: number } | null;
    mine: ReadonlySet<string>;
    ownIds: ReadonlySet<string>;
    rating: BoardRow["rating"];
    cells: BoardRow["cells"];
  },
): BoardRow {
  return {
    key: p.playerId,
    anchorId: rankAnchor(p.tag),
    rank,
    tied,
    medal,
    place: oneClan?.place,
    name: p.name,
    tag: p.tag,
    href: profileHref(mine, p),
    you: ownIds.has(p.playerId),
    clan: { id: p.clanId, name: p.clanName },
    thLevel: p.thLevel,
    note: oneClan ? `#${oneClan.place} of ${oneClan.size} in ${p.clanName}` : undefined,
    podiumNote: oneClan ? `#${rank} of ${p.familySize} in the family` : undefined,
    rating,
    cells,
  };
}

/** The Your rank bubble's lines, one per own village in the ranking. */
export function dockEntries(
  rows: readonly BoardRow[],
  line: (row: BoardRow) => string,
  rowHref: (row: BoardRow) => string,
): DockEntry[] {
  return rows
    .filter((row) => row.you)
    .map((row) => ({
      key: row.key,
      name: row.name,
      rank: row.rank,
      medal: row.medal,
      line: line(row),
      rating: row.rating.text,
      href: rowHref(row),
    }));
}
