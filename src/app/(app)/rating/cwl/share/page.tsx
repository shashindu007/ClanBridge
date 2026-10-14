// The month's CWL results as one 1080×1350 image, for the family's Facebook
// page — the sheet itself is components/cwl-results-sheet.tsx.
//
// Leadership only, like the lineup export: it is what leaders post. The month
// and the data are CWL rating's own (lib/cwl-latest.ts), over the clans the
// viewer leads.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Medal } from "lucide-react";
import { CwlResultsSheet } from "@/components/cwl-results-sheet";
import { DownloadImageButton } from "@/components/download-image-button";
import { EmptyState, Panel } from "@/components/kit";
import { currentUserId } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { latestCwlMonth } from "@/lib/cwl-latest";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { isLeadership } from "@/lib/visibility";

export const dynamic = "force-dynamic";

function BackLink() {
  return (
    <Link
      href="/rating/cwl"
      className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
    >
      <ArrowLeft aria-hidden className="size-4" />
      Back to CWL rating
    </Link>
  );
}

export default async function CwlResultsImagePage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const leads = (await visibleClans(supabase, userId)).filter((c) => isLeadership(c.role));
  if (leads.length === 0) redirect("/rating/cwl");

  const latest = await latestCwlMonth(supabase, leads);
  if (!latest || latest.entries.length === 0) {
    return (
      <main className="mx-auto max-w-narrow space-y-4 p-4 sm:p-6">
        <BackLink />
        <Panel>
          <EmptyState
            icon={Medal}
            title="No CWL recorded yet"
            body="The results image appears with the first Clan War League week the sync captures."
          />
        </Panel>
      </main>
    );
  }

  const { month, entries } = latest;

  return (
    <main className="mx-auto max-w-page space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink />
        <DownloadImageButton targetId="cwl-results" fileName={`CWL results ${month}`} share />
      </div>
      <p className="text-muted-foreground text-xs">
        A 1080×1350 image of {seasonLabel(month)}: each clan&apos;s group and its top three players by CWL
        rating. On a phone, “Share” sends it straight to Facebook.
      </p>

      {/* Centred by this wrapper, not by the sheet's own margin: the export
          copies the sheet's computed styles, and an auto margin comes out as
          the gap it filled on screen. */}
      <div className="overflow-x-auto">
        <div className="mx-auto w-fit">
          <CwlResultsSheet id="cwl-results" month={month} entries={entries} />
        </div>
      </div>
    </main>
  );
}
