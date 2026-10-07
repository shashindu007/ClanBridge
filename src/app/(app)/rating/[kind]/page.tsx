// Clan Games and Raids rating — placeholders until each part of the rating
// formula is built, phase by phase. Season donations, War rating and CWL rating
// have their own routes (../donations, ../war, ../cwl), which take precedence
// over this one.

import { notFound } from "next/navigation";
import { Hourglass } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState, Panel } from "@/components/kit";
import { RatingNav } from "@/components/rating-nav";
import { ratingSection } from "@/lib/rating";

export default async function RatingSectionPage({
  params,
}: {
  params: Promise<{ kind: string }>;
}) {
  const { kind } = await params;
  const section = ratingSection(kind);
  if (!section || section.ready) notFound();

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader title={section.label} back={{ href: "/rating", label: "Player rating" }} />
      <RatingNav current={section.kind} />
      <Panel>
        <EmptyState
          icon={Hourglass}
          title="Coming in a later phase"
          body={`The ${section.label.toLowerCase()} is part of the player rating formula still to be built. Until then, the ranking uses donations.`}
        />
      </Panel>
    </main>
  );
}
