// T4.4 — CWL season overview.
//
// R1 — reads PostgreSQL only. Nothing on this page talks to Supercell; the data
// arrives via scripts/sync/cwl.ts (T4.1).
//
// R10/T9.10 — there is no CWL for three weeks of every month, so the empty state
// is the NORMAL view, not an edge case. It says "not in CWL" rather than "no
// data", because those mean very different things to a leader wondering whether
// the sync is broken.
//
// A RUNNING SEASON LEADS. It used to be one row among the rest, marked only by
// "· running" in a date cell — during the one week a month when this page
// matters most, the way into it looked like the way into last March. Now it is
// a tile with its league's art, its record so far and the page's one gold
// button; the past seasons are a table under it, each opened by name.

import Link from "next/link";
import { Trophy } from "lucide-react";
import { DataFreshness } from "@/components/data-freshness";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/page-header";
import { EmptyState, FactRow, Panel, SectionHeader, Tile } from "@/components/kit";
import { GameArt } from "@/components/game/game-art";
import { Ribbon } from "@/components/game/ribbon";
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
import { artKeyForLeague } from "@/lib/game-art";
import { isLeader } from "@/lib/visibility";
import { cwlPhase, nextCwlWindow } from "@/lib/coc-time";
import { createClient } from "@/lib/supabase/server";
import { seasonsForClan, warsInSeason } from "@/repositories/cwl";
import { latestRun } from "@/repositories/sync-log";
import { seasonSpan, seasonTotals } from "@/services/cwl";
import { freshness } from "@/services/freshness";

export const dynamic = "force-dynamic";

function LeagueArt({ league, size }: { league: string | null; size: number }) {
  return (
    <GameArt
      art={artKeyForLeague(league)}
      size={size}
      alt=""
      fallback={<Trophy aria-hidden className="text-muted-foreground size-4 shrink-0" />}
    />
  );
}

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
  const base = `/${encodeURIComponent(clan.tag)}`;

  const seasons = await seasonsForClan(supabase, clan.id);
  const runs = freshness(await latestRun(supabase, "cwl", clan.id));

  // Season totals need each season's wars. There are at most a handful of
  // seasons and seven wars each, so this stays small; if it ever does not, it
  // becomes one grouped query rather than a cache.
  const rows = await Promise.all(
    seasons.map(async (season) => {
      const wars = await warsInSeason(supabase, season.id);
      // Both derived from the same read. The span costs nothing extra here —
      // the wars were already being loaded for the totals.
      return { season, totals: seasonTotals(wars), span: seasonSpan(wars) };
    }),
  );

  // T4.4. Only ever read by the empty state below — once there are rows, the
  // seasons themselves are the answer and an inferred date has nothing to add
  // (R12: the plan is compared to reality, never substituted for it).
  const now = new Date();
  const next = nextCwlWindow(now);
  const phase = cwlPhase(now);

  const running = rows.find((r) => r.span?.state === "running") ?? null;
  const past = rows.filter((r) => r !== running);

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      <PageHeader
        eyebrow={clan.name}
        title="Clan War League"
        description="Every season this clan has played, kept for good — the game deletes its own when a season ends."
        actions={<DataFreshness freshness={runs} canAdmin={isLeader(clan.role)} />}
      />

      {running && (
        <Tile
          as="section"
          accent="var(--ribbon-cwl)"
          ribbon={
            <Ribbon tone="cwl" icon={Trophy}>
              Running now
            </Ribbon>
          }
          className="space-y-4"
        >
          <div className="flex items-center gap-3">
            <LeagueArt league={running.season.league} size={48} />
            <div>
              <h2 className="cb-title text-2xl">{running.season.season}</h2>
              {running.season.league && (
                <p className="text-muted-foreground text-sm">{running.season.league}</p>
              )}
            </div>
          </div>
          <FactRow
            items={[
              {
                label: "won–lost–drawn so far",
                value: `${running.totals.wins}–${running.totals.losses}–${running.totals.ties}`,
              },
              {
                label: "stars for / against",
                value: `${running.totals.stars} / ${running.totals.starsAgainst}`,
              },
            ]}
          />
          <Button asChild variant="gold" size="cta">
            <Link href={`${base}/cwl/${running.season.season}`}>Open the war days</Link>
          </Button>
        </Tile>
      )}

      {rows.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Trophy}
            title="No CWL seasons recorded yet"
            body={
              <>
                CWL runs for about a week at the start of each month; for the rest of the
                month this page is empty, and that is normal.{" "}
                {/* T4.4 — the date the API never supplies. Worded as the usual
                    calendar rather than a promise: see cwlWindow() in
                    lib/coc-time.ts. */}
                {phase ? (
                  "A league is running right now, so this page should fill in within two hours of the sync job's next run."
                ) : (
                  <>
                    The next one usually opens for sign-up around{" "}
                    <LocalTime iso={next.signupOpens.toISOString()} style="date" />, with war
                    days from about <LocalTime iso={next.warsStart.toISOString()} style="date" />.
                  </>
                )}{" "}
                If a season has been and gone and this is still empty, the sync job is not
                running — worth fixing today, because the game cannot give that season back.
              </>
            }
          />
        </Panel>
      ) : past.length > 0 ? (
        <Panel padded={false} aria-labelledby="past-title">
          <div className="p-5 pb-2">
            <SectionHeader id="past-title" title="Past seasons" count={past.length} />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Season</TableHead>
                <TableHead>League</TableHead>
                <TableHead className="text-right">W–L–D</TableHead>
                <TableHead className="text-right">Stars</TableHead>
                <TableHead className="pr-5" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {past.map(({ season, totals, span }) => (
                <TableRow key={season.id}>
                  <TableCell className="pl-5">
                    <span className="font-medium">{season.season}</span>
                    {/* "2026-09" is a key, not a date a member recognises a
                        year later. */}
                    {span && (
                      <span className="text-muted-foreground block text-xs">
                        from <LocalTime iso={span.from} style="date" />
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 text-sm">
                      <LeagueArt league={season.league} size={24} />
                      {season.league ?? <span className="text-muted-foreground">—</span>}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {totals.wins}–{totals.losses}–{totals.ties}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {totals.stars}
                    <span className="text-muted-foreground"> / {totals.starsAgainst}</span>
                  </TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`${base}/cwl/${season.season}`}
                        aria-label={`Open ${season.season}`}
                      >
                        Open
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      ) : null}
    </main>
  );
}
