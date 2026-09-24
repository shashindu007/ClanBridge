// The admin pages' own tab row: Overview, Accounts, Feedback, Audit log.
//
// Admin was four pages joined only by three link cards on the first one. Once a
// leader was on Accounts, the way to the audit log was the browser's Back
// button; the audit log's only link home was at the foot of a long table. Every
// clan page has had its tab row since T3B; this is the same idea for the
// pages that are about the platform rather than a clan.
//
// A server component with the current page passed in, rather than reading the
// path: each admin page already knows which one it is, and this way the row
// renders in the same pass as the page with no client code at all.

import Link from "next/link";
import { LayoutDashboard, MessageSquareHeart, ScrollText, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export type AdminPage = "overview" | "accounts" | "feedback" | "audit";

const PAGES: Array<{ id: AdminPage; href: string; label: string; icon: typeof UserCheck }> = [
  { id: "overview", href: "/admin", label: "Overview", icon: LayoutDashboard },
  { id: "accounts", href: "/admin/members", label: "Accounts", icon: UserCheck },
  { id: "feedback", href: "/admin/feedback", label: "Feedback", icon: MessageSquareHeart },
  { id: "audit", href: "/admin/audit", label: "Audit log", icon: ScrollText },
];

export function AdminNav({
  current,
  showFeedback,
}: {
  current: AdminPage;
  /** Feedback moderation is the platform admin's alone; a clan leader has no such page. */
  showFeedback: boolean;
}) {
  return (
    <nav aria-label="Admin pages" className="cb-scroll-x -mx-1 flex gap-1 px-1">
      {PAGES.filter((p) => showFeedback || p.id !== "feedback").map((page) => {
        const active = page.id === current;
        return (
          <Link
            key={page.id}
            href={page.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-control px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground font-medium"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <page.icon aria-hidden className="size-4" />
            {page.label}
          </Link>
        );
      })}
    </nav>
  );
}
