// T4.4 — CWL season overview.
//
// R1 — reads PostgreSQL only. Nothing on this page talks to Supercell; the data
// arrives via scripts/sync/cwl.ts (T4.1).
//
// R10/T9.10 — there is no CWL for three weeks of every month, so the empty state
// is the NORMAL view, not an edge case. It says "not in CWL" rather than "no
// data", because those mean very different things to a leader wondering whether
// the sync is broken.

import Link from "next/link";
import { DataFreshness } from "@/components/data-freshness";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireClanByTag } from "@/lib/clans";
import { isLeader } from "@/lib/visibility";
import { cwlPhase, nextCwlWindow } from "@/lib/coc-time";
import { createClient } from "@/lib/supabase/server";
import { seasonsForClan, warsInSeason } from "@/repositories/cwl";
import { latestRun } from "@/repositories/sync-log";
import { seasonSpan, seasonTotals } from "@/services/cwl";
import { freshness } from "@/services/freshness";

export const dynamic = "force-dynamic";

export default async function CwlSeasonListPage({
  params,
}: {
  params: Promise<{ clanTag: string }>;
}) {
  const { clanTag } = await params;
  const supabase = await createClient();

  // Resolves the segment AND proves the caller may see this clan. A tag they do
  // not belong to is a 404 here, before any query runs (R3, T3.7).
  const clan = await requireClanByTag(supabase, clanTag);

  const seasons = await seasonsForClan(supabase, clan.id);
  const runs = freshness(await latestRun(supabase, "cwl", clan.id));

  // Season totals need each season's wars. There are at most a handful of
  // seasons and seven wars each, so this stays small; if it ever does not, it
  // becomes one grouped query rather than a cache.
  const rows = await Promise.all(
    seasons.map(async (season) => {
      const wars = await warsInSeason(supabase, season.id);
      // Both derived from the same read. The span costs nothing extra here —
      // the wars were already being loaded for the totals, and their start and
      // end times had simply never been selected (T12.2).
      return { season, totals: seasonTotals(wars), span: seasonSpan(wars) };
    }),
  );

  // T4.4. Only ever read by the empty state below — once there are rows, the
  // seasons themselves are the answer and an inferred date has nothing to add
  // (R12: the plan is compared to reality, never substituted for it).
  const now = new Date();
  const next = nextCwlWindow(now);
  const phase = cwlPhase(now);

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="cb-title text-3xl">Clan War League</h1>
          <DataFreshness freshness={runs} canAdmin={isLeader(clan.role)} />
        </div>
        <p className="text-muted-foreground text-sm">
          {clan.name} — every season captured, oldest kept forever.
        </p>
      </div>

      {rows.length === 0 ? (
        <section className="cb-panel space-y-3 rounded-panel border p-5">
          <h2 className="font-medium">No CWL seasons recorded yet</h2>
          <p className="text-muted-foreground text-sm">
            CWL runs for about a week at the start of each month. For the rest of
            the month there is nothing to show, and that is normal — this page
            fills in on its own once the season starts and the sync job runs.
          </p>
          {/* T4.4 — the date the API never supplies.
              An empty page that says WHEN it will stop being empty answers the
              question the reader actually arrived with. Worded as the usual
              calendar rather than a promise: see cwlWindow() in lib/coc-time.ts
              on why the guess is safe here and why it is never written down. */}
          <p className="text-muted-foreground text-sm">
            {phase
              ? "A league is running right now, so this page should fill in within two hours of the sync job's next run."
              : null}
            {!phase && (
              <>
                The next one usually opens for signup around{" "}
                <LocalTime iso={next.signupOpens.toISOString()} style="date" />,
                with war days from about{" "}
                <LocalTime iso={next.warsStart.toISOString()} style="date" />. The
                game does not publish these dates, so they are the usual calendar
                rather than a promise.
              </>
            )}
          </p>
          <p className="text-muted-foreground text-sm">
            If a CWL season has been and gone and this is still empty, the sync
            job is not running. That is worth fixing today: Supercell deletes CWL
            data when the season ends and it cannot be recovered afterwards.
          </p>
        </section>
      ) : (
        <section className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Season</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="text-right">W</TableHead>
                <TableHead className="text-right">L</TableHead>
                <TableHead className="text-right">T</TableHead>
                <TableHead className="text-right">Stars</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ season, totals, span }) => (
                <TableRow key={season.id}>
                  <TableCell className="font-medium">{season.season}</TableCell>
                  {/* A preserved season is worth little if nobody can tell when
                      it happened. "2026-09" is a key, not a date a member
                      recognises a year later. */}
                  <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                    {span ? (
                      <>
                        <LocalTime iso={span.from} style="date" />
                        {span.state === "running" && (
                          <span className="text-warning-ink"> · running</span>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-right">{totals.wins}</TableCell>
                  <TableCell className="text-right">{totals.losses}</TableCell>
                  <TableCell className="text-right">{totals.ties}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {totals.stars}
                    <span className="text-muted-foreground"> / {totals.starsAgainst}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`/${encodeURIComponent(clan.tag)}/cwl/${season.season}`}
                      >
                        Days
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}
    </main>
  );
}
