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
// R1 — PostgreSQL only. R3 — the season is resolved under an explicit clan
// filter, so every war and attack below it is known to belong here.

import Link from "next/link";
import { notFound } from "next/navigation";
import { DataFreshness } from "@/components/data-freshness";
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
import { createClient } from "@/lib/supabase/server";
import { attacksForWar, rosterForWar, seasonByName, warsInSeason } from "@/repositories/cwl";
import { latestRun } from "@/repositories/sync-log";
import { seasonTotals, warRecord } from "@/services/cwl";
import { freshness } from "@/services/freshness";

export const dynamic = "force-dynamic";

function resultBadge(result: string | null, state: string | null) {
  if (result === "win") return <Badge>Win</Badge>;
  if (result === "lose") return <Badge variant="destructive">Loss</Badge>;
  if (result === "tie") return <Badge variant="secondary">Tie</Badge>;
  return <Badge variant="outline">{state ?? "not started"}</Badge>;
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

  const roster = selected ? await rosterForWar(supabase, selected.id) : [];
  const attacks = selected ? await attacksForWar(supabase, selected.id) : [];
  const record = warRecord(roster, attacks);
  const missed = record.filter((m) => m.missed);

  const base = `/${encodeURIComponent(clan.tag)}/cwl/${encodeURIComponent(season.season)}`;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">CWL {season.season}</h1>
          <DataFreshness freshness={runs} />
        </div>
        <p className="text-muted-foreground text-sm">
          {clan.name} — {totals.wins}W {totals.losses}L {totals.ties}T, {totals.stars} stars
          for and {totals.starsAgainst} against.{" "}
          <Link className="underline" href={`/${encodeURIComponent(clan.tag)}/cwl`}>
            All seasons
          </Link>
        </p>
      </div>

      {wars.length === 0 ? (
        <section className="space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">No war days recorded for this season</h2>
          <p className="text-muted-foreground text-sm">
            The season row exists but no wars were captured. If CWL has already run,
            the sync job was not working during that week.
          </p>
        </section>
      ) : (
        <>
          <nav className="flex flex-wrap gap-2">
            {wars.map((war) => (
              <Button
                key={war.id}
                asChild
                size="sm"
                variant={selected?.id === war.id ? "default" : "outline"}
              >
                <Link href={`${base}?day=${war.dayNumber ?? ""}`}>
                  Day {war.dayNumber ?? "?"}
                </Link>
              </Button>
            ))}
          </nav>

          {selected && (
            <section className="space-y-3 rounded-lg border p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">
                  Day {selected.dayNumber ?? "?"} versus{" "}
                  {selected.opponentName ?? selected.opponentTag ?? "unknown"}
                </h2>
                {resultBadge(selected.result, selected.state)}
              </div>
              <p className="text-muted-foreground text-sm tabular-nums">
                {selected.ourStars ?? 0} — {selected.theirStars ?? 0} stars ·{" "}
                {(selected.ourDestruction ?? 0).toFixed(1)}% —{" "}
                {(selected.theirDestruction ?? 0).toFixed(1)}%
              </p>
            </section>
          )}

          <section className="space-y-4 rounded-lg border p-6">
            <h2 className="font-medium">
              Did not attack{" "}
              <span className="text-muted-foreground font-normal">
                ({missed.length} of {roster.length})
              </span>
            </h2>
            {roster.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No roster was captured for this day.
              </p>
            ) : missed.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Everyone on the roster used their attack.
              </p>
            ) : (
              <ul className="divide-y">
                {missed.map((m) => (
                  <li key={m.playerId} className="flex items-center gap-4 py-3">
                    <span className="text-muted-foreground w-8 text-sm tabular-nums">
                      {m.mapPosition ?? "—"}
                    </span>
                    <span className="flex-1">{m.name}</span>
                    <span className="text-muted-foreground font-mono text-xs">{m.tag}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {roster.length > 0 && (
            <section className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Member</TableHead>
                    <TableHead className="text-right">TH</TableHead>
                    <TableHead className="text-right">Stars</TableHead>
                    <TableHead className="text-right">Destruction</TableHead>
                    <TableHead className="text-right">Defender</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {record.map((m) => (
                    <TableRow key={m.playerId} className={m.missed ? "opacity-60" : ""}>
                      <TableCell className="tabular-nums">{m.mapPosition ?? "—"}</TableCell>
                      <TableCell>
                        <Link
                          className="underline-offset-2 hover:underline"
                          href={`/${encodeURIComponent(clan.tag)}/player/${encodeURIComponent(m.tag)}`}
                        >
                          {m.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.thLevel ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.missed ? "—" : m.stars}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.missed ? "—" : `${m.destruction.toFixed(1)}%`}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right tabular-nums">
                        {m.attacks[0]?.defenderPosition ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          )}
        </>
      )}
    </main>
  );
}
