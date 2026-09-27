// The CWL group table: all eight clans, ranked the way the game ranks them.
//
// Derived from cwl_group_wars (048) by services/cwl-standings.ts, never stored.
// Seasons that ran before 048 have no group data — the API deleted it when they
// ended — and the page says exactly that rather than showing a one-row table.

import { notFound } from "next/navigation";
import { Info, ListOrdered } from "lucide-react";
import { SyncBadge } from "@/components/sync-badge";
import { EmptyState, Panel } from "@/components/kit";
import { StandingsTable } from "@/components/cwl-parts";
import { CwlSeasonHeader } from "@/components/cwl-season-header";
import { requireClanByTag } from "@/lib/clans";
import { canPrintCwlReport, loadSeasonView } from "@/lib/cwl-season";
import { isLeader } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import { seasonByName } from "@/repositories/cwl";
import { latestRun } from "@/repositories/sync-log";

export const dynamic = "force-dynamic";

export default async function CwlStandingsPage({
  params,
}: {
  params: Promise<{ clanTag: string; season: string }>;
}) {
  const { clanTag, season: seasonName } = await params;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const season = await seasonByName(supabase, clan.id, decodeURIComponent(seasonName));
  if (!season) notFound();

  const [view, run, canPrint] = await Promise.all([
    loadSeasonView(supabase, clan, season),
    latestRun(supabase, "cwl", clan.id),
    canPrintCwlReport(supabase, clan.role),
  ]);
  const clanBase = `/${encodeURIComponent(clan.tag)}`;
  const captured = view.us !== null;

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <CwlSeasonHeader
        clanName={clan.name}
        clanBase={clanBase}
        view={view}
        active="standings"
        canPrint={canPrint}
        description="Where this clan stands in its group of eight."
        actions={<SyncBadge run={run} clanTag={clan.tag} target="cwl" canAdmin={isLeader(clan.role)} />}
      />

      {!captured ? (
        <Panel>
          <EmptyState
            icon={ListOrdered}
            title="The group table was not captured for this season"
            body="The whole group is recorded only since the sync began capturing it. The game deletes a group when its season ends, so earlier seasons cannot be filled in — their day-by-day results are still complete."
          />
        </Panel>
      ) : (
        <Panel className="space-y-4">
          <StandingsTable standings={view.standings} />
          <p className="text-muted-foreground flex items-start gap-2 text-xs">
            <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Ranked on stars, with 10 bonus stars for every war won; total destruction breaks a
              tie. {view.running ? "A day still being fought counts its stars as they stand, and its win bonus once it ends." : ""}
            </span>
          </p>
        </Panel>
      )}
    </main>
  );
}
