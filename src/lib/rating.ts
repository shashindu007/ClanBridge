// Player rating — its sections, in one list.
//
// The nav buttons and the rules on /rating read this. `ready: false` marks a
// section whose page is not built yet.

export type RatingKind = "donations" | "war" | "cwl" | "games" | "raids";

export interface RatingSection {
  kind: RatingKind;
  label: string;
  href: string;
  /** False until this part of the rating is built; its page says so. */
  ready: boolean;
}

export const RATING_SECTIONS: readonly RatingSection[] = [
  { kind: "donations", label: "Season donations", href: "/rating/donations", ready: true },
  { kind: "war", label: "War rating", href: "/rating/war", ready: true },
  { kind: "cwl", label: "CWL rating", href: "/rating/cwl", ready: true },
  { kind: "games", label: "Clan Games rating", href: "/rating/games", ready: true },
  { kind: "raids", label: "Raids rating", href: "/rating/raids", ready: true },
];

/** Short names, for tables and summaries. */
export const RATING_SHORT_LABELS: Readonly<Record<RatingKind, string>> = {
  donations: "Donations",
  war: "War",
  cwl: "CWL",
  games: "Games",
  raids: "Raids",
};

/** Last month stays open until this day of the month. */
export const LAST_MONTH_OPEN_UNTIL = 10;

export const monthOf = (date: Date): string => date.toISOString().slice(0, 7);

/**
 * The months whose numbers can still change: this one, and last month until the
 * 10th. scripts/sync/ratings.ts reworks these, and every page calling a month
 * final asks here, so neither can disagree with the other.
 */
export function openMonths(now: Date): string[] {
  const open = [monthOf(now)];
  if (now.getUTCDate() <= LAST_MONTH_OPEN_UNTIL) {
    open.push(monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))));
  }
  return open;
}

/** "0.70%", with a real minus. */
export function ratingPercent(value: number): string {
  const text = `${Math.abs(value).toFixed(2)}%`;
  return value < 0 ? `−${text}` : text;
}

/** A section's marks can cancel to a rating of zero, so this looks at the marks. */
export function hasMarks(marks: Readonly<Record<RatingKind, number>>): boolean {
  return Object.values(marks).some((value) => value !== 0);
}

/** The id of a player's row on /rating, for linking straight to it. */
export function rankAnchor(tag: string): string {
  return `rank-${tag.replace(/^#/, "")}`;
}

/** Found by part of a name or tag, with or without the #. */
export function matchesPlayer(player: { name: string; tag: string }, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    player.name.toLowerCase().includes(needle) ||
    player.tag.toLowerCase().includes(needle.replace(/^#/, ""))
  );
}

