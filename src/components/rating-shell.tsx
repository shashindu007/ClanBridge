// Every Player rating page's frame: the same header, the same tabs, the same
// width, and room at the bottom for the Your rank bubble.
//
// Each page had its own Shell, with a "back to Player rating" link on five of
// them and none on the sixth. The Overall tab is that way back now, so it is
// the same control on every page.

import { PageHeader } from "@/components/page-header";
import { RatingNav } from "@/components/rating-nav";
import { cn } from "@/lib/utils";

export function RatingShell({
  title,
  description,
  actions,
  dock,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** The Your rank bubble, pinned to the bottom of the screen. */
  dock?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    // The padding keeps the last rows clear of the bubble when scrolled to the end.
    <main className={cn("mx-auto max-w-page space-y-6 p-4 sm:p-6", dock && "pb-40 sm:pb-40")}>
      {/* The eyebrow says which page a section belongs to; Overall is that page. */}
      <PageHeader
        eyebrow={title === "Player rating" ? undefined : "Player rating"}
        title={title}
        description={description}
        actions={actions}
      />
      <RatingNav />
      {children}
      {dock}
    </main>
  );
}
