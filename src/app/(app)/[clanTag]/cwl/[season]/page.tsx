// T4.5 — CWL day detail.
//
// Roster, every attack, and a clear list of who has NOT attacked. That last list
// is the reason this page exists: it is the one a leader acts on, and it is the
// thing the WhatsApp-and-logbook workflow could never produce reliably. It comes
// BEFORE the full roster on the page for the same reason.
//
// The missed list is DERIVED, never stored (002_cwl.sql:76-78) — roster minus
// attacks, computed in services/cwl.ts. A stored miss is indistinguishable from
// a genuine zero-star attack, and CWL rows cannot be repaired later because the
// source data is deleted when the season ends.
//
// REDESIGNED: the season as a month name, a summary row of labelled numbers, day
// tabs that show each day's result under the day, and a table whose columns say
// "Result" and "Base attacked" with stars drawn as stars — instead of "#", "TH"
// and "Defender" over bare numbers, and a missed attack shown only as a faded row.
//
// R1 — PostgreSQL only. R3 — the season is resolved under an explicit clan
// filter, so every war and attack below it is known to belong here.

import Link from "next/link";
import { notFound } from "next/navigation";
import { DataFreshness } from "@/components/data-freshness";
import { LocalTime } from "@/components/local-time";
import { TownHall } from "@/components/lineup-parts";
import { PageHeader } from "@/components/page-header";
import { Stars, Stat } from "@/components/stars";
import { Badge } from "@/components/ui/badge";
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
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { attacksForWar, rosterForWar, seasonByName, warsInSeason } from "@/repositories/cwl";
import { latestRun } from "@/repositories/sync-log";
import { seasonSpan, seasonTotals, warRecord } from "@/services/cwl";
import { freshness } from "@/services/freshness";

export const dynamic = "force-dynamic";

function resultBadge(result: string | null, state: string | null) {
  if (result === "win") return <Badge variant="success">Won</Badge>;
  if (result === "lose") return <Badge variant="destructive">Lost</Badge>;
  if (result === "tie") return <Badge variant="secondary">Tie</Badge>;
  if (state === "inWar") return <Badge variant="warning">Battle day</Badge>;
  if (state === "preparation") return <Badge variant="info">Preparation</Badge>;
  return <Badge variant="outline">Not started</Badge>;
}

/** The one word under a day tab, so the tabs double as a results strip. */
function dayOutcome(result: string | null, state: string | null): string {
  if (result === "win") return "Won";
  if (result === "lose") return "Lost";
  if (result === "tie") return "Tie";
  if (state === "inWar") return "Battle day";
  if (state === "preparation") return "Preparation";
  return "Not started";
}

export default async function CwlDayDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string; season: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { clanTag, season: seasonName } = await params;
  const { day } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const season = await seasonByName(supabase, clan.id, decodeURIComponent(seasonName));
  if (!season) notFound();

  const wars = await warsInSeason(supabase, season.id);
  const runs = freshness(await latestRun(supabase, "cwl", clan.id));
  const totals = seasonTotals(wars);

  // Default to the last day that has data — almost always what is wanted while
  // CWL is running.
  const selected =
    wars.find((w) => String(w.dayNumber) === day) ?? wars[wars.length - 1] ?? null;

  // When the season ran. Derived from the days rather than stored — see
  // seasonSpan() for why a stored pair would be a second source that can
  // disagree with the days it summarises.
  const span = seasonSpan(wars);

  const roster = selected ? await rosterForWar(supabase, selected.id) : [];
  const attacks = selected ? await attacksForWar(supabase, selected.id) : [];
  const record = warRecord(roster, attacks);
  const missed = record.filter((m) => m.missed);

  const clanBase = `/${encodeURIComponent(clan.tag)}`;
  const base = `${clanBase}/cwl/${encodeURIComponent(season.season)}`;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <PageHeader
        back={{ href: `${clanBase}/cwl`, label: "All CWL seasons" }}
        eyebrow={clan.name}
        title={`CWL · ${seasonLabel(season.season)}`}
        description="Each war day's result, and who did not use their attack."
        actions={
          <>
            <DataFreshness freshness={runs} canAdmin={isLeader(clan.role)} />
            <Button asChild variant="outline" size="sm">
              <Link href={`${base}/report`}>Season report</Link>
            </Button>
          </>
        }
      />

      {/* WHEN THIS SEASON ACTUALLY RAN.
          cwl_seasons stores only 'YYYY-MM' and the league, so the season has no
          start or end of its own — but every war day carries both, synced since
          the first CWL run and never once read. The span is the first day's
          battle start to the last day's end, which is the season as a member
          experienced it.

          LocalTime, not a server-formatted string: these are the same kind of
          value the war board treats as a deadline, and being five and a half
          hours out is how somebody concludes they still have a day left. */}
      {span && (
        <p className="text-muted-foreground text-sm">
          {span.state === "running" ? "Running since " : "Ran from "}
          <LocalTime iso={span.from} style="date" />
          {span.to && (
            <>
              {span.state === "running" ? ", latest day ends " : " to "}
              <LocalTime iso={span.to} style={span.state === "running" ? "weekday" : "date"} />
            </>
          )}
          .
        </p>
      )}

      <section className="cb-panel grid gap-4 rounded-lg border p-6 sm:grid-cols-3">
        <Stat
          label="Wins – losses – ties"
          value={`${totals.wins} – ${totals.losses} – ${totals.ties}`}
          hint={`${wars.length} war day${wars.length === 1 ? "" : "s"} recorded`}
        />
        <Stat label="Stars" value={`${totals.stars} – ${totals.starsAgainst}`} hint="ours – theirs, all days" />
        <Stat
          label="League"
          value={<span className="text-lg">{season.league ?? "Unknown"}</span>}
        />
      </section>

      {wars.length === 0 ? (
        <section className="cb-panel space-y-2 rounded-lg border p-6">
          <h2 className="font-medium">No war days recorded for this season</h2>
          <p className="text-muted-foreground text-sm">
            The season exists but no wars were captured. If CWL has already run, the sync
            was not working that week.
          </p>
        </section>
      ) : (
        <>
          <nav aria-label="War days" className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {wars.map((war) => {
              const active = selected?.id === war.id;
              return (
                <Link
                  key={war.id}
                  href={`${base}?day=${war.dayNumber ?? ""}`}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2 text-center transition-colors ${
                    active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-accent"
                  }`}
                >
                  <span className="text-sm font-medium">Day {war.dayNumber ?? "?"}</span>
                  <span className={`text-xs ${active ? "" : "text-muted-foreground"}`}>
                    {dayOutcome(war.result, war.state)}
                  </span>
                  {/* Which day of the month this was. Seven tabs reading
                      "Day 1 / Won" say nothing about when any of it happened,
                      and a member opening a preserved season a year later has
                      no other way to place it. */}
                  {war.startTime && (
                    <span className={`text-[0.6875rem] ${active ? "opacity-80" : "text-muted-foreground"}`}>
                      <LocalTime iso={war.startTime} style="date" />
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {selected && (
            <section className="cb-panel space-y-4 rounded-lg border p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="cb-title text-xl">
                  Day {selected.dayNumber ?? "?"}{" "}
                  <span className="text-muted-foreground font-normal">vs</span>{" "}
                  {selected.opponentName ?? selected.opponentTag ?? "unknown opponent"}
                </h2>
                {resultBadge(selected.result, selected.state)}
              </div>
              {/* The same three-way wording the war board uses for a regular
                  war, so the two pages describe a war day the same way:
                  preparation -> when battle day starts; live -> when it ends;
                  over -> when it ended. */}
              {(selected.startTime || selected.endTime) && (
                <p className="text-muted-foreground text-sm">
                  {selected.state === "preparation" ? (
                    <>
                      Battle day starts <LocalTime iso={selected.startTime} style="weekday" />
                    </>
                  ) : selected.state === "inWar" ? (
                    <>
                      Battle day ends <LocalTime iso={selected.endTime} style="weekday" />
                    </>
                  ) : (
                    <>
                      Ran <LocalTime iso={selected.startTime} style="datetime" /> to{" "}
                      <LocalTime iso={selected.endTime} style="datetime" />
                    </>
                  )}
                </p>
              )}
              <div className="grid gap-4 sm:grid-cols-3">
                <Stat label="Stars" value={`${selected.ourStars ?? 0} – ${selected.theirStars ?? 0}`} hint="us – them" />
                <Stat
                  label="Destruction"
                  value={`${(selected.ourDestruction ?? 0).toFixed(1)}%`}
                  hint={`them ${(selected.theirDestruction ?? 0).toFixed(1)}%`}
                />
                <Stat
                  label="Attacks used"
                  value={`${roster.length - missed.length} of ${roster.length}`}
                  hint="one attack each in CWL"
                />
              </div>
            </section>
          )}

          <section className="cb-panel space-y-4 rounded-lg border p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="cb-title text-xl">Did not attack</h2>
              {roster.length > 0 && (
                <Badge variant={missed.length === 0 ? "success" : "warning"}>
                  {missed.length === 0 ? "Everyone attacked" : `${missed.length} of ${roster.length} missed`}
                </Badge>
              )}
            </div>
            {roster.length === 0 ? (
              <p className="text-muted-foreground text-sm">No roster was captured for this day.</p>
            ) : missed.length === 0 ? (
              <p className="text-muted-foreground text-sm">Everyone in the lineup used their attack.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {missed.map((m) => (
                  <li key={m.playerId} className="flex items-center gap-3 px-3 py-2">
                    <span className="text-muted-foreground w-8 text-xs tabular-nums">#{m.mapPosition ?? "?"}</span>
                    <Link
                      className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-2 hover:underline"
                      href={`${clanBase}/player/${encodeURIComponent(m.tag)}`}
                    >
                      {m.name}
                    </Link>
                    <TownHall level={m.thLevel} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          {roster.length > 0 && (
            <section className="cb-panel space-y-3 rounded-lg border p-6">
              <h2 className="cb-title text-xl">Every attack this day</h2>
              <div className="-mx-6 overflow-x-auto px-6">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-16">Position</TableHead>
                      <TableHead>Member</TableHead>
                      <TableHead>Result</TableHead>
                      <TableHead className="text-right">Destruction</TableHead>
                      <TableHead className="text-right">Base attacked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {record.map((m) => (
                      <TableRow key={m.playerId}>
                        <TableCell className="text-muted-foreground tabular-nums">#{m.mapPosition ?? "?"}</TableCell>
                        <TableCell>
                          <Link
                            className="font-medium underline-offset-2 hover:underline"
                            href={`${clanBase}/player/${encodeURIComponent(m.tag)}`}
                          >
                            {m.name}
                          </Link>
                          <span className="mt-1 block">
                            <TownHall level={m.thLevel} />
                          </span>
                        </TableCell>
                        <TableCell>
                          {m.missed ? <Badge variant="warning">Did not attack</Badge> : <Stars stars={m.stars} />}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.missed ? "—" : `${m.destruction.toFixed(1)}%`}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-right tabular-nums">
                          {m.attacks[0]?.defenderPosition ? `#${m.attacks[0].defenderPosition}` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
