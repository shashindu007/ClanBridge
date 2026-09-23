// T12.10 — the handful of patterns every page repeats, defined once.
//
// The complaint that started this file was consistency: cards with three
// different corner radii, section headings built differently on every page,
// "nothing here" boxes in four shapes. Each of those is now one component with
// one set of rules, so two pages built from these cannot disagree.
//
//   Panel          a card or section surface
//   SectionHeader  an h2 with an optional icon, count and action
//   ListRow        one item with a single primary action
//   EmptyState     the honest "nothing here yet"
//
// THE TYPE RULE, kept here so nobody has to remember it: the display face
// (.cb-title) is for page titles (h1) and big numbers only. Section headings,
// row titles and buttons are in the body face — a page where every heading
// shouts has no headings.

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A card or a section. Always the same radius, the same frame, the same padding. */
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
    <Tag className={`cb-panel rounded-xl border ${padded ? "p-5" : ""} ${className}`} {...rest}>
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
        {count !== undefined && count > 0 && (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
            {count}
          </span>
        )}
      </h2>
      {action && (
        <Link href={action.href} className="text-primary shrink-0 text-sm font-medium hover:underline">
          {action.label}
        </Link>
      )}
    </div>
  );
}

/**
 * One item: icon, title, a meta line, and ONE action.
 *
 * One action because a row with three buttons is a row nobody can act on at a
 * glance. The action is a real link-button, so it is a separate tab stop with
 * its own name ("Answer", "Attack") rather than a whole row that silently
 * navigates somewhere.
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
        className="cb-emblem size-9 shrink-0 rounded-lg"
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
        <Button asChild size="sm" variant={action.primary ? "default" : "outline"} className="shrink-0">
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
    <div className="rounded-lg border border-dashed px-5 py-8 text-center">
      <Icon aria-hidden className="text-muted-foreground mx-auto size-6" />
      <p className="mt-2 text-sm font-medium">{title}</p>
      {body && <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
