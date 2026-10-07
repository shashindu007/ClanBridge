// One header for every redesigned page: a title, one sentence saying what the
// page is FOR, and a slot on the right for status or the page's main action.
//
// The pages it replaces opened with a title and a line of dotted text links —
// "Dark Hell · war board · history · contribution" — which duplicated the clan
// rail (lib/clan-nav.ts already lists War → Board, Lineup, History, Report) while
// saying nothing about the page itself. A first-time visitor learns more from
// "Plan who plays in the next war" than from four links to elsewhere.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PageHeader({
  title,
  description,
  eyebrow,
  back,
  actions,
  art,
  ribbons,
}: {
  title: React.ReactNode;
  /** What this page is for, in one sentence. */
  description?: React.ReactNode;
  /** Small context line above the title, e.g. the clan name. */
  eyebrow?: React.ReactNode;
  /** A single "back" link for pages reached from a list. */
  back?: { href: string; label: string };
  /** Right-hand slot: freshness, status, or the page's primary button. */
  actions?: React.ReactNode;
  /** A picture beside the title: the clan's badge, a Town Hall. */
  art?: React.ReactNode;
  /** Game state under the title, as <Ribbon>s. */
  ribbons?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {back && (
        <Button asChild variant="ghost" size="xs" className="-ml-2">
          <Link href={back.href}>
            <ArrowLeft aria-hidden className="size-4" />
            {back.label}
          </Link>
        </Button>
      )}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          {art && <div className="shrink-0">{art}</div>}
          <div className="min-w-0 space-y-1">
            {eyebrow && <p className="text-muted-foreground text-sm">{eyebrow}</p>}
            {/* T12.8 — the display face. This one line is what makes every
                redesigned page's title match the game look, since they all
                come through here. */}
            <h1 className="cb-title text-2xl sm:text-3xl">{title}</h1>
            {ribbons && <div className="flex flex-wrap items-center gap-2 pt-1">{ribbons}</div>}
            {description && <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
