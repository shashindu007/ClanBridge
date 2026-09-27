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
// A RUNNING SEASON LEADS: a large tile with its league, the group position, the
// week as seven coloured days, the day being fought with its countdown, and what
// the week pays in medals. Past seasons follow as cards — each with the same
// coloured strip, so a month's story reads at a glance instead of as "3–4–0".
//
// Everything about a season is gathered by lib/cwl-season.ts, the same loader
// the season's own pages use, so the numbers here cannot disagree with them.

import Link from "next/link";
import { ChevronRight, Swords, Trophy } from "lucide-react";
import { SyncBadge } from "@/components/sync-badge";
import { LocalTime } from "@/components/local-time";
import { PageHeader } from "@/components/page-header";
import { Countdown } from "@/components/countdown";
import { EmptyState, Panel, SectionHeader, StatTile, Tile } from "@/components/kit";
import { DayStrip, LeagueArt, MedalHint, RankBadge } from "@/components/cwl-parts";
import { Ribbon } from "@/components/game/ribbon";
import { Button } from "@/components/ui/button";
import { requireClanByTag } from "@/lib/clans";
import { isLeader } from "@/lib/visibility";
import { cwlPhase, nextCwlWindow } from "@/lib/coc-time";
import { loadSeasonView } from "@/lib/cwl-season";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { seasonsForClan } from "@/repositories/cwl";
import { latestRun } from "@/repositories/sync-log";

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
  const base = `/${encodeURIComponent(clan.tag)}`;

  const [seasons, run] = await Promise.all([
    seasonsForClan(supabase, clan.id),
    latestRun(supabase, "cwl", clan.id),
  ]);

  // A handful of seasons, seven wars each, and one group per season: small.
  const views = await Promise.all(seasons.map((season) => loadSeasonView(supabase, clan, season)));

  // T4.4. Only ever read by the empty state below.
  const now = new Date();
  const next = nextCwlWindow(now);
  const phase = cwlPhase(now);

  const running = views.find((v) => v.running) ?? null;
  const past = views.filter((v) => v !== running);
  const hrefFor = (season: string) => `${base}/cwl/${encodeURIComponent(season)}`;

  const live = running?.wars.find((w) => w.state === "inWar") ?? null;
  const prep = running?.wars.find((w) => w.state === "preparation") ?? null;

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        eyebrow={clan.name}
        title="Clan War League"
        description="Every season this clan has played, kept for good — the game deletes its own when a season ends."
        actions={
          <SyncBadge run={run} clanTag={clan.tag} target="cwl" canAdmin={isLeader(clan.role)} />
        }
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
          className="space-y-5"
        >
          <div className="flex flex-wrap items-center gap-4">
            <LeagueArt league={running.league} size={64} />
            <div className="min-w-0 flex-1">
              <h2 className="cb-title text-2xl sm:text-3xl">{seasonLabel(running.season.season)}</h2>
              <p className="text-muted-foreground text-sm">{running.league ?? "League not recorded yet"}</p>
            </div>
            {running.us && (
              <RankBadge rank={running.us.rank} of={running.standings.length} final={false} />
            )}
          </div>

          <DayStrip wars={running.wars} hrefFor={(w) => `${hrefFor(running.season.season)}?day=${w.dayNumber ?? ""}`} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile
              label="Won – lost – drawn"
              value={`${running.totals.wins}–${running.totals.losses}–${running.totals.ties}`}
            />
            <StatTile
              label="Stars for / against"
              value={`${running.totals.stars} / ${running.totals.starsAgainst}`}
            />
            <StatTile
              label={live ? "Today's war ends in" : prep ? "Next battle day in" : "Status"}
              icon={Swords}
              value={
                live ? (
                  <Countdown iso={live.endTime} />
                ) : prep ? (
                  <Countdown iso={prep.startTime} />
                ) : (
                  "Between days"
                )
              }
              sub={
                live ? (
                  <>
                    Day {live.dayNumber} · {live.ourStars ?? 0} ★ vs {live.theirStars ?? 0} ★
                  </>
                ) : undefined
              }
            />
            <StatTile
              label="Group position"
              value={running.us ? `${running.us.rank} / ${running.standings.length}` : "—"}
              sub={running.us ? `${running.us.stars} stars incl. win bonus` : "group not captured yet"}
            />
          </div>

          {running.medals?.fullPayout && (
            <MedalHint perFull={running.medals.fullPayout} bonus={running.medals.bonusCount} />
          )}

          <Button asChild variant="gold" size="cta">
            <Link href={hrefFor(running.season.season)}>Open the war days</Link>
          </Button>
        </Tile>
      )}

      {views.length === 0 ? (
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
        <section aria-labelledby="past-title" className="space-y-3">
          <SectionHeader id="past-title" title="Past seasons" count={past.length} />
          <ul className="grid gap-4 md:grid-cols-2">
            {past.map((v) => {
              const record = `${v.totals.wins}–${v.totals.losses}–${v.totals.ties}`;
              const tone =
                v.totals.wins > v.totals.losses
                  ? "var(--success)"
                  : v.totals.wins < v.totals.losses
                    ? "var(--destructive)"
                    : undefined;
              return (
                <Tile
                  as="li"
                  key={v.season.id}
                  href={hrefFor(v.season.season)}
                  label={`Open ${seasonLabel(v.season.season)}`}
                  accent={tone ?? "var(--ribbon-cwl)"}
                  className="space-y-3"
                >
                  <div className="flex items-center gap-3">
                    <LeagueArt league={v.league} size={44} />
                    <div className="min-w-0 flex-1">
                      <p className="cb-title truncate text-xl">{seasonLabel(v.season.season)}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {v.league ?? "League not recorded"}
                        {v.span && (
                          <>
                            {" · from "}
                            <LocalTime iso={v.span.from} style="date" />
                          </>
                        )}
                      </p>
                    </div>
                    {v.us ? (
                      <span className="text-right">
                        <span className="cb-title block text-xl">#{v.us.rank}</span>
                        <span className="text-muted-foreground text-xs">of {v.standings.length}</span>
                      </span>
                    ) : (
                      <ChevronRight aria-hidden className="text-muted-foreground size-5" />
                    )}
                  </div>
                  <DayStrip wars={v.wars} size="sm" />
                  <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    <span>
                      <span className="font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>
                        {record}
                      </span>{" "}
                      <span className="text-muted-foreground">W–L–D</span>
                    </span>
                    <span>
                      <span className="font-semibold tabular-nums">{v.totals.stars}</span>
                      <span className="text-muted-foreground"> / {v.totals.starsAgainst} stars</span>
                    </span>
                  </p>
                </Tile>
              );
            })}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
