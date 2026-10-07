// Player rating — its sections, in one list.
//
// The nav buttons and the [kind] route both read this, so a section cannot be
// linked without a page or have a page without a link. `ready: false` sections
// are placeholders until their part of the rating formula is built, phase by
// phase.

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
  { kind: "games", label: "Clan Games rating", href: "/rating/games", ready: false },
  { kind: "raids", label: "Raids rating", href: "/rating/raids", ready: false },
];

export function ratingSection(kind: string): RatingSection | undefined {
  return RATING_SECTIONS.find((s) => s.kind === kind);
}
