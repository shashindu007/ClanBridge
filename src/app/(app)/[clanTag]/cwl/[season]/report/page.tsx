// T4B.11, T4B.12, T4B.13 — plan versus reality, contribution, and bonus medals.
//
// R12 IN PRACTICE. cwl_roster_members is who the leader CHOSE; cwl_war_members
// is who the API says PLAYED. Both are kept, and this page is the difference:
//
//   selected and played
//   selected but never appeared      <- the conversation to have
//   appeared but was never selected  <- the one nobody expects
//
// The third group is why this is a three-way split rather than a checklist. A
// co-leader adds someone in game who was not on the roster, and without this
// they are invisible in every report while consuming a slot somebody else was
// promised.
//
// REDESIGNED: the season as a month name; "Picked versus played" as three
// explained cards with the two lists that matter side by side; contribution
// columns that say "War days", "Attacks 6 of 7" and "Avg destruction".
//
// BONUS MEDALS ARE NO LONGER AWARDED HERE. They are given in game; the medals
// tab shows how many there are and the evidence for them, and records nothing.
// The printable monthly report for leadership is ./print.

import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, CircleAlert, UserPlus, UserX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FactRow } from "@/components/kit";
import { CwlSeasonHeader } from "@/components/cwl-season-header";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireClanByTag } from "@/lib/clans";
import { canPrintCwlReport, loadSeasonView } from "@/lib/cwl-season";
import { isLeadership } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import { seasonByName } from "@/repositories/cwl";
import { membersOfRoster, rosterFor } from "@/repositories/rosters";
import { planVsReality } from "@/services/rosters";
import { CardScene } from "@/components/game/scene-backdrop";

export const dynamic = "force-dynamic";

export default async function CwlSeasonReportPage({
  params,
}: {
  params: Promise<{ clanTag: string; season: string }>;
}) {
  const { clanTag, season: rawSeason } = await params;
  const season = decodeURIComponent(rawSeason);
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const seasonRow = await seasonByName(supabase, clan.id, season);
  if (!seasonRow) notFound();

  // The season (wars, every day's roster and attacks) comes from the shared
  // loader; the leader's roster is the one extra read, and they run together.
  const [view, roster, canPrint] = await Promise.all([
    loadSeasonView(supabase, clan, seasonRow, { withPlayers: true }),
    rosterFor(supabase, clan.id, season),
    canPrintCwlReport(supabase, clan.role),
  ]);
  const selected = roster ? await membersOfRoster(supabase, roster.id) : [];
  const { wars, warData, contributions } = view;

  const comparison = planVsReality(selected, warData);
  const leadership = isLeadership(clan.role);

  const absent = comparison.filter((r) => r.outcome === "absent");
  const unplanned = comparison.filter((r) => r.outcome === "unplanned");
  const played = comparison.filter((r) => r.outcome === "played");

  const clanBase = `/${encodeURIComponent(clan.tag)}`;

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <CwlSeasonHeader
        clanName={clan.name}
        clanBase={clanBase}
        view={view}
        active="report"
        canPrint={canPrint}
        description={`Who you picked compared with who played, and what each player contributed over ${wars.length} war day${wars.length === 1 ? "" : "s"}.`}
      />

      {!roster && (
        <Alert variant="warning">
          <CircleAlert aria-hidden />
          <AlertTitle>No lineup was picked for this season</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              There is nothing to compare with, so everyone who played shows as &ldquo;not
              picked&rdquo;. Pick next season&apos;s lineup in the roster builder and this
              report shows who followed the plan.
            </p>
            {leadership && (
              <Button asChild size="sm" variant="outline">
                <Link href="/roster">Open CWL lineups</Link>
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {/* ── T4B.11 — plan versus reality ───────────────────────────────────── */}
      <section className="cb-panel isolate space-y-5 rounded-panel border p-5">
        <CardScene />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Picked versus played</h2>
          <p className="text-muted-foreground text-sm">
            Your lineup compared with the players the game actually put in the wars.
          </p>
        </div>

        {/* Three counts in a line. They were three cards of a big number each,
            and the lists below then printed the same three numbers again. */}
        <FactRow
          items={[
            {
              label: "picked and played",
              value: played.length,
              art: <CheckCircle2 aria-hidden className="text-success size-4" />,
              title: "The plan worked for these.",
            },
            {
              label: "picked, did not play",
              value: absent.length,
              art: <UserX aria-hidden className="text-destructive size-4" />,
              title: "Worth a conversation.",
            },
            {
              label: "played, not picked",
              value: unplanned.length,
              art: <UserPlus aria-hidden className="text-warning-ink size-4" />,
              title: "Each took a spot someone else was promised.",
            },
          ]}
        />

        {(absent.length > 0 || unplanned.length > 0) && (
          <div className="grid gap-6 md:grid-cols-2">
            <NameList
              title="Picked but did not play"
              empty="Everyone picked played."
              rows={absent.map((r) => ({ id: r.playerId, name: r.name, tag: r.tag, detail: null }))}
              clanBase={clanBase}
            />
            <NameList
              title="Played without being picked"
              empty="Nobody played who was not picked."
              rows={unplanned.map((r) => ({
                id: r.playerId,
                name: r.name,
                tag: r.tag,
                detail: `${r.warsPlayed} war day${r.warsPlayed === 1 ? "" : "s"}`,
              }))}
              clanBase={clanBase}
            />
          </div>
        )}

        {absent.length === 0 && unplanned.length === 0 && wars.length > 0 && roster && (
          <p className="text-sm">
            <CheckCircle2 aria-hidden className="text-success mr-1 inline size-4" />
            The plan held exactly: everyone picked played, and nobody else did.
          </p>
        )}
      </section>

      {/* ── T4B.12 — contribution ──────────────────────────────────────────── */}
      <section className="cb-panel isolate space-y-4 rounded-panel border p-5">
        <CardScene />
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">What each player contributed</h2>
          <p className="text-muted-foreground text-sm">
            <span className="text-foreground font-medium">Missed</span> counts war days a
            player was in and did not attack — not days they were left out of.
          </p>
        </div>
        {contributions.length === 0 ? (
          <p className="text-muted-foreground text-sm">No war data was captured for this season.</p>
        ) : (
          <div className="-mx-6 overflow-x-auto px-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-right">War days</TableHead>
                  <TableHead className="text-right">Attacks</TableHead>
                  <TableHead className="text-right">Missed</TableHead>
                  <TableHead className="text-right">Stars</TableHead>
                  <TableHead className="text-right">Avg destruction</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contributions.map((c) => (
                  <TableRow key={c.playerId}>
                    <TableCell className="font-medium">
                      <Link
                        className="underline-offset-2 hover:underline"
                        href={`${clanBase}/player/${encodeURIComponent(c.tag)}`}
                      >
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.warsPlayed}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.attacksUsed} of {c.warsPlayed}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {c.missed > 0 ? <span className="text-destructive font-medium">{c.missed}</span> : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.stars}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.averageDestruction.toFixed(1)}%</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

    </main>
  );
}

function NameList({
  title,
  empty,
  rows,
  clanBase,
}: {
  title: string;
  empty: string;
  rows: Array<{ id: string; name: string; tag: string; detail: string | null }>;
  clanBase: string;
}) {
  return (
    <div className="space-y-2">
      {/* The count is in the line of facts above; not repeated here. */}
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="divide-y rounded-control border">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <Link className="min-w-0 truncate underline-offset-2 hover:underline" href={`${clanBase}/player/${encodeURIComponent(r.tag)}`}>
                {r.name}
              </Link>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">{r.detail ?? r.tag}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
