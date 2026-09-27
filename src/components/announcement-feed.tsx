// Home's announcements: the newest few from every clan, in one short list.
//
// Small on purpose. The notice board is each clan's Notices page; this is the
// "anything new?" glance that saves a member opening three of them. Each row
// names its clan with the clan's own colour dot, as the "Needs you" chips do,
// and opens that clan's board.
//
// The order and the cut are services/home.ts's announcementFeed().
//
// The body is plain text, rendered as a string child and clamped to two lines
// (T5.2: nothing here parses markup).

import Link from "next/link";
import { Megaphone, Pin } from "lucide-react";
import { EmptyState, Panel, SectionHeader } from "@/components/kit";
import { clanAccent } from "@/lib/clan-accent";
import { timeAgo, type FeedNotice } from "@/services/home";

export function AnnouncementFeed({
  notices,
  now,
  allHref,
  className,
}: {
  notices: FeedNotice[];
  now: Date;
  /** "All announcements" — only when there is one clan to send it to. */
  allHref?: string;
  className?: string;
}) {
  return (
    <Panel aria-labelledby="announcements-title" className={className}>
      <div className="space-y-4">
        <SectionHeader
          id="announcements-title"
          title="Announcements"
          icon={Megaphone}
          action={allHref ? { href: allHref, label: "See all" } : undefined}
        />
        {notices.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="Nothing posted yet"
            body="Notices from your leaders will show here."
          />
        ) : (
          <ul className="-mx-2 space-y-1">
            {notices.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/${encodeURIComponent(n.clanTag)}/notices`}
                  className="hover:bg-accent/60 focus-visible:ring-ring/50 block space-y-1 rounded-control px-2 py-2.5 outline-none focus-visible:ring-[3px]"
                >
                  <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden
                      className="size-1.5 shrink-0 rounded-full"
                      style={{ background: clanAccent(n.clanId).color }}
                    />
                    <span className="truncate font-medium">{n.clanName}</span>
                    <span aria-hidden>·</span>
                    <time dateTime={n.createdAt} className="shrink-0">
                      {timeAgo(n.createdAt, now)}
                    </time>
                    {n.pinned && (
                      <span className="text-info-ink ml-auto inline-flex shrink-0 items-center gap-0.5">
                        <Pin aria-hidden className="size-3" />
                        pinned
                      </span>
                    )}
                  </span>
                  <span className="block text-sm leading-snug font-medium">{n.title}</span>
                  <span className="text-muted-foreground line-clamp-2 block text-xs whitespace-pre-line">
                    {n.body}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
