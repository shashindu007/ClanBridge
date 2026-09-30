// The five Player rating buttons. A server component: plain links, with the
// current section passed in rather than read from the router.

import Link from "next/link";
import { Castle, Gamepad2, HandHeart, Medal, Swords, type LucideIcon } from "lucide-react";
import { RATING_SECTIONS, type RatingKind } from "@/lib/rating";

const ICONS: Record<RatingKind, LucideIcon> = {
  donations: HandHeart,
  war: Swords,
  cwl: Medal,
  games: Gamepad2,
  raids: Castle,
};

export function RatingNav({ current }: { current?: RatingKind }) {
  return (
    <nav aria-label="Player rating" className="flex flex-wrap gap-2">
      {RATING_SECTIONS.map((section) => {
        const Icon = ICONS[section.kind];
        const active = section.kind === current;
        return (
          <Link
            key={section.kind}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "bg-primary text-primary-foreground flex items-center gap-2 rounded-control px-3.5 py-2 text-sm font-medium"
                : "hover:bg-accent flex items-center gap-2 rounded-control border px-3.5 py-2 text-sm font-medium"
            }
          >
            <Icon aria-hidden className="size-4" />
            {section.label}
            {!section.ready && (
              <span className="text-muted-foreground text-xs font-normal">soon</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
