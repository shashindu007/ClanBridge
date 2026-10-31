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

