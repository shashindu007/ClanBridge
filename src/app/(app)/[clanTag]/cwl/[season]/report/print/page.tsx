// The monthly CWL report, as a sheet of paper — for leadership (leader,
// co-leader) and platform admins to save as a PDF and share.
//
// Printed through the browser (components/print-button.tsx): no PDF library and
// no second template — this page IS the document, drawn on `.cb-sheet` so it is
// white paper with dark ink in either theme, and `@media print` in globals.css
// takes the app's chrome off it.
//
// Everything on it comes from the same loader as the season's own pages
// (lib/cwl-season.ts), so the PDF cannot disagree with the screen.
//
// Anyone else gets a 404, not a "forbidden" page: the report's existence is
// not something a member needs explained.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { ClanBadge } from "@/components/game/clan-badge";
import { LeagueArt, StandingsTable } from "@/components/cwl-parts";
import { PrintButton } from "@/components/print-button";
import { formatDisplay } from "@/lib/display-time";
import { requireClanByTag } from "@/lib/clans";
import { canPrintCwlReport, loadSeasonView } from "@/lib/cwl-season";
import { seasonLabel } from "@/lib/roster-view";
import { DAY_TONE_CLASS, DAY_TONE_LABEL, dayTone, ordinal } from "@/lib/war-status";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { seasonByName } from "@/repositories/cwl";
import { membersOfRoster, rosterFor } from "@/repositories/rosters";
import { planVsReality } from "@/services/rosters";

export const dynamic = "force-dynamic";

export default async function CwlReportPrintPage({
  params,
}: {
  params: Promise<{ clanTag: string; season: string }>;
}) {
  const { clanTag, season: rawSeason } = await params;
  const seasonName = decodeURIComponent(rawSeason);
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  if (!(await canPrintCwlReport(supabase, clan.role))) notFound();
  const season = await seasonByName(supabase, clan.id, seasonName);
  if (!season) notFound();

  const [view, roster] = await Promise.all([
    loadSeasonView(supabase, clan, season, { withPlayers: true }),
    rosterFor(supabase, clan.id, seasonName),
  ]);
  const selected = roster ? await membersOfRoster(supabase, roster.id) : [];
  const comparison = planVsReality(selected, view.warData);
  const absent = comparison.filter((r) => r.outcome === "absent");
  const unplanned = comparison.filter((r) => r.outcome === "unplanned");

  const { wars, totals, contributions, medals, us, standings } = view;
  const attacksUsed = contributions.reduce((t, c) => t + c.attacksUsed, 0);
  const attacksOwed = contributions.reduce((t, c) => t + c.warsPlayed, 0);
  const threeStars = view.warData.reduce(
    (t, w, i) => t + (wars[i]?.state === "warEnded" ? w.attacks.filter((a) => a.stars === 3).length : 0),
    0,
  );

  const clanBase = `/${encodeURIComponent(clan.tag)}`;
  const back = `${clanBase}/cwl/${encodeURIComponent(season.season)}/report`;
  const title = `CWL report · ${seasonLabel(season.season)}`;

  return (
    <main className="mx-auto max-w-[210mm] space-y-4 p-4 sm:p-6 print:max-w-none print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={back} className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline">
          <ArrowLeft aria-hidden className="size-4" />
          Back to the report
        </Link>
        <PrintButton />
      </div>
      <p className="text-muted-foreground text-xs print:hidden">
        In the print dialog choose “Save as PDF”. Turn on “Background graphics” to keep the colours.
      </p>

      <article className="cb-sheet space-y-6 rounded-panel border p-8 shadow-lg print:rounded-none print:border-0 print:p-0 print:shadow-none">
        {/* ── Masthead ──────────────────────────────────────────────────── */}
        <header className="flex items-center gap-4 border-b-4 pb-4" style={{ borderColor: "var(--ribbon-cwl)" }}>
          <ClanBadge src={clan.badgeUrl} name={clan.name} size="lg" tone="var(--primary)" />
          <div className="min-w-0 flex-1">
            <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">{clan.name} · {clan.tag}</p>
            <h1 className="cb-title text-3xl leading-tight">{title}</h1>
            <p className="text-muted-foreground text-sm">
              {view.league ?? "League not recorded"}
              {view.running ? " · season still running" : ""} · prepared {formatDisplay(new Date().toISOString(), "date")}
            </p>
          </div>
          <LeagueArt league={view.league} size={64} />
        </header>

        {/* ── Headline numbers ──────────────────────────────────────────── */}
        <section className="grid grid-cols-3 gap-3 sm:grid-cols-6">
          {[
            { label: "Position", value: us ? `${ordinal(us.rank)} / ${standings.length}` : "—" },
            { label: "Won–lost–drawn", value: `${totals.wins}–${totals.losses}–${totals.ties}` },
            { label: "Stars for", value: totals.stars },
            { label: "Stars against", value: totals.starsAgainst },
            { label: "Attacks used", value: attacksOwed ? `${attacksUsed}/${attacksOwed}` : "—" },
            { label: "Three-star hits", value: threeStars },
          ].map((s) => (
            <div key={s.label} className="bg-muted rounded-control p-3 text-center">
              <p className="cb-title text-xl tabular-nums">{s.value}</p>
              <p className="text-muted-foreground text-[0.6875rem] font-medium uppercase">{s.label}</p>
            </div>
          ))}
        </section>

        {/* ── Day by day ────────────────────────────────────────────────── */}
        <section className="print-avoid-break space-y-2">
          <h2 className="text-lg font-bold">Day by day</h2>
          <table className="w-full border text-sm">
            <thead className="bg-muted text-left text-xs uppercase">
              <tr>
                <th className="px-2 py-1.5">Day</th>
                <th className="px-2 py-1.5">Date</th>
                <th className="px-2 py-1.5">Opponent</th>
                <th className="px-2 py-1.5">Result</th>
                <th className="px-2 py-1.5 text-right">Stars</th>
                <th className="px-2 py-1.5 text-right">Destruction</th>
              </tr>
            </thead>
            <tbody>
              {wars.map((w) => {
                const tone = dayTone(w.result, w.state);
                return (
                  <tr key={w.id} className="border-t">
                    <td className="px-2 py-1.5 font-semibold">{w.dayNumber ?? "?"}</td>
                    <td className="px-2 py-1.5">{w.startTime ? formatDisplay(w.startTime, "date") : "—"}</td>
                    <td className="px-2 py-1.5">{w.opponentName ?? w.opponentTag ?? "—"}</td>
                    <td className="px-2 py-1.5">
                      <span className={cn("rounded-chip px-2 py-0.5 text-xs font-bold", DAY_TONE_CLASS[tone].solid)}>
                        {DAY_TONE_LABEL[tone]}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {w.ourStars ?? 0} – {w.theirStars ?? 0}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {(w.ourDestruction ?? 0).toFixed(1)}% – {(w.theirDestruction ?? 0).toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* ── Group standings ───────────────────────────────────────────── */}
        {us && (
          <section className="print-avoid-break space-y-2 px-5">
            <h2 className="-mx-5 text-lg font-bold">Group standings</h2>
            <StandingsTable standings={standings} compact />
          </section>
        )}

        {/* ── Medals ────────────────────────────────────────────────────── */}
        {medals && (
          <section className="print-avoid-break space-y-2">
            <h2 className="text-lg font-bold">Medals</h2>
            <p className="text-sm">
              {medals.league}
              {medals.position ? `, ${ordinal(medals.position)} place: ` : ": "}
              {medals.fullPayout ? (
                <>
                  <strong>{medals.fullPayout}</strong> league medals for each player with 8+ stars
                  (20% + 10% a star below that).{" "}
                </>
              ) : (
                "position not recorded, so the payout is unknown. "
              )}
              <strong>{medals.bonusCount}</strong> bonus medal{medals.bonusCount === 1 ? "" : "s"} of{" "}
              {medals.bonusValue} to be given by the leader in game.
            </p>
          </section>
        )}

        {/* ── Players ───────────────────────────────────────────────────── */}
        <section className="space-y-2">
          <h2 className="text-lg font-bold">What each player contributed</h2>
          {contributions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No finished war days recorded.</p>
          ) : (
            <table className="w-full border text-sm">
              <thead className="bg-muted text-left text-xs uppercase">
                <tr>
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Player</th>
                  <th className="px-2 py-1.5 text-right">Days</th>
                  <th className="px-2 py-1.5 text-right">Attacks</th>
                  <th className="px-2 py-1.5 text-right">Missed</th>
                  <th className="px-2 py-1.5 text-right">Stars</th>
                  <th className="px-2 py-1.5 text-right">Avg destr.</th>
                  <th className="px-2 py-1.5 text-right">≈ Medals</th>
                </tr>
              </thead>
              <tbody>
                {contributions.map((c, index) => {
                  const m = medals?.players.find((p) => p.playerId === c.playerId);
                  return (
                    <tr key={c.playerId} className="print-avoid-break border-t">
                      <td className="text-muted-foreground px-2 py-1 tabular-nums">{index + 1}</td>
                      <td className="px-2 py-1 font-medium">{c.name}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{c.warsPlayed}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{c.attacksUsed}</td>
                      <td className={cn("px-2 py-1 text-right tabular-nums", c.missed > 0 && "text-destructive font-bold")}>
                        {c.missed || "—"}
                      </td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums">{c.stars}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{c.averageDestruction.toFixed(1)}%</td>
                      <td className="px-2 py-1 text-right tabular-nums">{m && medals?.position ? m.medals : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* ── Plan versus reality ───────────────────────────────────────── */}
        <section className="print-avoid-break space-y-2">
          <h2 className="text-lg font-bold">Picked versus played</h2>
          {!roster ? (
            <p className="text-muted-foreground text-sm">No lineup was picked on the site for this season.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-semibold">Picked but did not play ({absent.length})</p>
                <p className="text-muted-foreground text-sm">{absent.map((r) => r.name).join(", ") || "Nobody."}</p>
              </div>
              <div>
                <p className="text-sm font-semibold">Played without being picked ({unplanned.length})</p>
                <p className="text-muted-foreground text-sm">{unplanned.map((r) => r.name).join(", ") || "Nobody."}</p>
              </div>
            </div>
          )}
        </section>

        <footer className="text-muted-foreground border-t pt-3 text-[0.6875rem]">
          Generated by ClanBridge from war data captured during the season. Medal figures are
          estimates from the game&apos;s published CWL rewards; bonus medals are given in game.
        </footer>
      </article>
    </main>
  );
}
