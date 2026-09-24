// T12.10 — the handful of patterns every page repeats, defined once.
//
// The complaint that started this file was consistency: cards with three
// different corner radii, section headings built differently on every page,
// "nothing here" boxes in four shapes. Each of those is now one component with
// one set of rules, so two pages built from these cannot disagree.
//
//   Panel          a section surface (tier 1)
//   Tile           a chunky card that art can stand on (tier 2)
//   SectionHeader  an h2 with an optional icon, count and action
//   FactRow        small facts inline — "48 members · level 17" — never a card each
//   Disclosure     a section that folds, with its count visible while folded
//   ListRow        one item with a single primary action
//   EmptyState     the honest "nothing here yet"
//
// THE TYPE RULE, kept here so nobody has to remember it: the display face
// (.cb-title) is for page titles (h1) and big numbers only. Section headings,
// row titles and buttons are in the body face — a page where every heading
// shouts has no headings.
//
// THE SIZE RULE, which is why FactRow exists: a card is for something you act
// on or read at length. A single number — members, level, online — is a fact,
// and a fact goes in a line. The clan page used to spend six framed tiles, a
// medallion each, on six numbers, and pushed the war off the first screen.

import Link from "next/link";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A section. Always the same radius, the same frame, the same padding. */
export function Panel({
  as: Tag = "section",
  padded = true,
  className = "",
  children,
  ...rest
}: {
  as?: "section" | "div" | "article" | "aside";
  padded?: boolean;
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn("cb-panel rounded-panel border", padded && "p-5", className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * The chunky card. Lighter than a panel, with a lip, and room for art to rise
 * out of its top edge — a clan badge on Home, a Town Hall on a base.
 *
 * WHEN IT IS A LINK, THE WHOLE TILE IS THE TARGET, WITHOUT NESTING. `href`
 * renders one real <a>, named by `label`, stretched over the tile. The content
 * sits under it; anything inside that is its own control (the gold "Attack"
 * button) must carry `relative z-10` to rise above the stretched link. That
 * keeps one link per tile for a screen reader and no <a> inside an <a>.
 */
export function Tile({
  as: Tag = "article",
  accent,
  art,
  ribbon,
  href,
  label,
  className,
  children,
}: {
  as?: "article" | "section" | "div" | "li";
  /** The 3px band along the top edge: a clan's colour, usually. */
  accent?: string;
  /** Rises out of the top-left corner. Keep it about 64px tall. */
  art?: React.ReactNode;
  /** Sits on the top-right edge. Use <Ribbon>. */
  ribbon?: React.ReactNode;
  /** Makes the whole tile one link. */
  href?: string;
  /** The link's accessible name. Required with href. */
  label?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "cb-tile rounded-tile border p-4 sm:p-5",
        art && "mt-7 pt-11 sm:pt-12",
        href && "cb-panel-interactive",
        className,
      )}
      style={accent ? ({ "--tile-accent": accent } as React.CSSProperties) : undefined}
    >
      {href && (
        <Link
          href={href}
          aria-label={label}
          className="focus-visible:ring-ring/50 absolute inset-0 z-[1] rounded-tile outline-none focus-visible:ring-[3px]"
        />
      )}
      {art && <div className="pointer-events-none absolute -top-7 left-4">{art}</div>}
      {ribbon && <div className="pointer-events-none absolute top-4 -right-1.5">{ribbon}</div>}
      {children}
    </Tag>
  );
}

/**
 * An h2 with, optionally, a muted icon, a count and one action on the right.
 *
 * The icon is a plain glyph, not a medallion: a disc behind every section
 * heading was one of the things that made pages feel busy.
 */
export function SectionHeader({
  id,
  title,
  count,
  icon: Icon,
  action,
}: {
  id?: string;
  title: string;
  count?: number;
  icon?: LucideIcon;
  action?: { href: string; label: string };
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 id={id} className="flex items-center gap-2 text-lg font-semibold">
        {Icon && <Icon aria-hidden className="text-muted-foreground size-4.5" />}
        {title}
        {count !== undefined && count > 0 && <CountPill count={count} />}
      </h2>
      {action && (
        <Link href={action.href} className="text-primary shrink-0 text-sm font-medium hover:underline">
          {action.label}
        </Link>
      )}
    </div>
  );
}

function CountPill({ count }: { count: number }) {
  return (
    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
      {count}
    </span>
  );
}

export interface Fact {
  /** What the number is, in words: "members", "level". Always shown. */
  label: string;
  value: React.ReactNode;
  icon?: LucideIcon;
  /** A picture instead of the icon: a league, a Town Hall. */
  art?: React.ReactNode;
  href?: string;
  /** More detail on hover, e.g. "48 in game, 45 on the last sync". */
  title?: string;
}

/**
 * Facts in a line: "👥 48 members   ⬆ 17 level   🏆 Master III league".
 *
 * A <dl>, so each value is announced with its label. The value comes first to
 * the eye (flex order) and the label stays in the DOM before it, where a
 * description list needs it.
 */
export function FactRow({
  items,
  className,
}: {
  items: Fact[];
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-wrap items-center gap-x-5 gap-y-2 text-sm", className)}>
      {items.map((fact) => {
        const Icon = fact.icon;
        const value = (
          <span className="font-semibold tabular-nums">{fact.value}</span>
        );
        return (
          <div key={fact.label} className="flex items-center gap-1.5" title={fact.title}>
            {fact.art ?? (Icon && <Icon aria-hidden className="text-muted-foreground size-4" />)}
            <dt className="text-muted-foreground order-2">{fact.label}</dt>
            <dd className="order-1">
              {fact.href ? (
                <Link href={fact.href} className="relative z-10 hover:underline">
                  {value}
                </Link>
              ) : (
                value
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/**
 * A section that folds. Its heading and count stay visible folded, so a long
 * table ("Their bases · 30") costs one line until someone wants it.
 *
 * A native <details>: no script, keyboard and screen reader behaviour for free,
 * and the browser's find-in-page opens it when a match is inside.
 */
export function Disclosure({
  title,
  count,
  icon: Icon,
  summary,
  defaultOpen = false,
  className,
  children,
}: {
  title: string;
  count?: number;
  icon?: LucideIcon;
  /** Extra on the summary line, right-aligned: a badge, a freshness note. */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className={cn("group cb-panel rounded-panel border", className)}>
      <summary className="hover:bg-accent/40 flex cursor-pointer list-none items-center gap-3 rounded-panel p-5 transition-colors group-open:rounded-b-none [&::-webkit-details-marker]:hidden">
        <h2 className="flex min-w-0 flex-1 items-center gap-2 text-lg font-semibold">
          {Icon && <Icon aria-hidden className="text-muted-foreground size-4.5 shrink-0" />}
          <span className="truncate">{title}</span>
          {count !== undefined && <CountPill count={count} />}
        </h2>
        {summary && <span className="text-muted-foreground shrink-0 text-sm">{summary}</span>}
        <ChevronDown
          aria-hidden
          className="text-muted-foreground size-5 shrink-0 transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t px-5 pt-4 pb-5">{children}</div>
    </details>
  );
}

/**
 * One item: icon, title, a meta line, and ONE action.
 *
 * One action because a row with three buttons is a row nobody can act on at a
 * glance. The action is a real link-button, so it is a separate tab stop with
 * its own name ("Answer", "Attack") rather than a whole row that silently
 * navigates somewhere. `primary` makes it the gold call to action — at most
 * one per view.
 */
export function ListRow({
  icon: Icon,
  tone,
  title,
  meta,
  context,
  action,
}: {
  icon: LucideIcon;
  /** A CSS colour for the icon disc. Status tokens only where the row IS a status. */
  tone?: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  /** A small leading label, e.g. the clan the row belongs to. */
  context?: React.ReactNode;
  action?: { href: string; label: string; primary?: boolean };
}) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
      <span
        className="cb-emblem size-9 shrink-0 rounded-control"
        style={tone ? ({ "--emblem": tone } as React.CSSProperties) : undefined}
      >
        <Icon aria-hidden className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1">
        {context && <p className="text-muted-foreground truncate text-xs font-medium">{context}</p>}
        <p className="text-sm leading-snug font-medium">{title}</p>
        {meta && <p className="text-muted-foreground text-xs">{meta}</p>}
      </div>
      {action && (
        <Button asChild size="sm" variant={action.primary ? "gold" : "outline"} className="shrink-0">
          <Link href={action.href}>{action.label}</Link>
        </Button>
      )}
    </li>
  );
}

/** "Nothing here yet", said the same way everywhere. */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-panel border border-dashed px-5 py-8 text-center">
      <Icon aria-hidden className="text-muted-foreground mx-auto size-6" />
      <p className="mt-2 text-sm font-medium">{title}</p>
      {body && <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
