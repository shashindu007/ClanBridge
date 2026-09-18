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
        <div className="min-w-0 space-y-1">
          {eyebrow && <p className="text-muted-foreground text-sm">{eyebrow}</p>}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-muted-foreground max-w-2xl text-sm">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
