"use client";

// The Player rating tabs: Overall, then one per section.
//
// OVERALL IS A TAB. It was the page the section tabs sat on, with no tab of
// its own, so on /rating nothing was lit and from a section the only way back
// was a "back" link in the header: two different controls for one place.
//
// A client component, and the lit tab comes from the route, not a prop: the
// layout's pathname goes stale on a soft navigation (as HomeLink says), and a
// prop each page has to remember to pass is a tab that can be lit wrong.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Castle, Gamepad2, HandHeart, Medal, Swords, Trophy, type LucideIcon } from "lucide-react";
import { RATING_SECTIONS, RATING_SHORT_LABELS, type RatingKind } from "@/lib/rating";

const ICONS: Record<RatingKind, LucideIcon> = {
  donations: HandHeart,
  war: Swords,
  cwl: Medal,
  games: Gamepad2,
  raids: Castle,
};

export const RATING_TABS: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/rating", label: "Overall", icon: Trophy },
  // Short names: six tabs have to fit a phone's width before they scroll.
  ...RATING_SECTIONS.map((section) => ({
    href: section.href,
    label: RATING_SHORT_LABELS[section.kind],
    icon: ICONS[section.kind],
  })),
];

/** The tab a path belongs to: Overall only for /rating itself, a section for anything under it. */
export function activeRatingTab(pathname: string): string | null {
  if (pathname === "/rating") return "/rating";
  const section = RATING_TABS.find((tab) => tab.href !== "/rating" && pathname.startsWith(tab.href));
  return section?.href ?? null;
}

export function RatingNav() {
  const active = activeRatingTab(usePathname() ?? "");
  return (
    <nav aria-label="Rating sections" className="cb-segment cb-scroll-x flex max-w-full gap-1 [&>*]:shrink-0">
      {RATING_TABS.map((tab) => {
        const Icon = tab.icon;
        const current = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            data-active={current || undefined}
            className="cb-choice min-h-10"
          >
            <Icon aria-hidden className="size-4" />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
