// CWL medals: what this week pays, and the evidence for the bonus medals.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS PAGE IS, AND WHAT IT STOPPED BEING
//
// It used to be a form: a leader picked who got a bonus medal and in what order,
// and the site recorded it in cwl_bonuses. But bonus medals are handed out IN
// GAME, by the leader, after the season — the site's list was a second record
// of a decision the game already holds, typed in by hand, and free to disagree
// with it. So the form is gone (the table and its functions stay, untouched).
//
// What is left is what the site can actually know:
//
//   - the league and the group position (standings, 048)
//   - the placement payout for that league and position (data/cwl-medals.ts)
//   - each player's share of it: 20% for the roster, +10% a star, full at 8
//   - how many bonus medals the leader may give, and what each is worth
//   - the participants ranked by stars — the evidence for the in-game choice
//
// Read-only for everyone. A season from before the group was captured has no
// known position, and one from before the league was stamped has no league:
// both can be chosen here as a PREVIEW (GET parameters, never saved).
// ─────────────────────────────────────────────────────────────────────────────

import Link from "next/link";
import { notFound } from "next/navigation";
import { Gift, Info, Medal, Star, Users } from "lucide-react";
import { SyncBadge } from "@/components/sync-badge";
import { EmptyState, Panel, SectionHeader, StatTile } from "@/components/kit";
import { CwlSeasonHeader } from "@/components/cwl-season-header";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CWL_LEAGUES, FULL_PAYOUT_STARS } from "@/data/cwl-medals";
import { requireClanByTag } from "@/lib/clans";
import { canPrintCwlReport, loadSeasonView } from "@/lib/cwl-season";
import { isLeader } from "@/lib/visibility";
import { ordinal } from "@/lib/war-status";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { seasonByName } from "@/repositories/cwl";
import { latestRun } from "@/repositories/sync-log";
import { medalPlan } from "@/services/cwl-medals";

export const dynamic = "force-dynamic";

export default async function CwlMedalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string; season: string }>;
  searchParams: Promise<{ league?: string; rank?: string }>;
}) {
  const { clanTag, season: seasonName } = await params;
  const query = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const season = await seasonByName(supabase, clan.id, decodeURIComponent(seasonName));
  if (!season) notFound();

  const [view, run, canPrint] = await Promise.all([
    loadSeasonView(supabase, clan, season, { withPlayers: true }),
    latestRun(supabase, "cwl", clan.id),
    canPrintCwlReport(supabase, clan.role),
  ]);

  // Preview inputs — only honoured where the season itself does not know.
  const previewLeague = !view.league && query.league && CWL_LEAGUES.includes(query.league) ? query.league : null;
  const rankParam = Number(query.rank);
  const previewRank = !view.us && Number.isInteger(rankParam) && rankParam >= 1 && rankParam <= 8 ? rankParam : null;
  const previewing = previewLeague !== null || previewRank !== null;

  const plan =
    previewing
      ? medalPlan({
          league: view.league ?? previewLeague,
          position: view.us?.rank ?? previewRank,
          final: !view.running,
          warsWon: view.totals.wins,
          players: view.starsSoFar.map((c) => ({
            playerId: c.playerId,
            tag: c.tag,
            name: c.name,
            warsPlayed: c.warsPlayed,
            attacksUsed: c.attacksUsed,
            stars: c.stars,
          })),
        })
      : view.medals;

  const clanBase = `/${encodeURIComponent(clan.tag)}`;
  const here = `${clanBase}/cwl/${encodeURIComponent(season.season)}/medals`;
  const needsLeague = !view.league;
  const needsRank = !view.us;

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <CwlSeasonHeader
        clanName={clan.name}
        clanBase={clanBase}
        view={view}
        active="medals"
        canPrint={canPrint}
        description="What this week pays in league medals, and the evidence for the bonus medals."
        actions={<SyncBadge run={run} clanTag={clan.tag} target="cwl" canAdmin={isLeader(clan.role)} />}
      />

      <Alert variant="info">
        <Gift aria-hidden />
        <AlertTitle>Bonus medals are given in the game</AlertTitle>
        <AlertDescription>
          The clan leader hands out bonus medals inside Clash of Clans once the season ends. This
          page shows how many there are and who earned the most — it does not record who gets
          them.
        </AlertDescription>
      </Alert>

      {(needsLeague || needsRank) && (
        <Panel className="space-y-3">
          <p className="text-sm">
            {needsLeague && needsRank
              ? "This season's league and group position were not recorded."
              : needsLeague
                ? "This season's league was not recorded."
                : "This season's group position was not recorded."}{" "}
            <span className="text-muted-foreground">
              Choose them to preview the payout. Nothing here is saved.
            </span>
          </p>
          {/* A plain GET form: the choice lives in the URL and nowhere else. */}
          <form action={here} className="flex flex-wrap items-end gap-3">
            {needsLeague && (
              <label className="space-y-1">
                <span className="text-muted-foreground block text-xs">League</span>
                <select
                  name="league"
                  defaultValue={previewLeague ?? ""}
                  className="border-input bg-background h-10 sm:h-9 rounded-control border px-2 text-base sm:text-sm"
                >
                  <option value="">Choose…</option>
                  {CWL_LEAGUES.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {needsRank && (
              <label className="space-y-1">
                <span className="text-muted-foreground block text-xs">Final position</span>
                <select
                  name="rank"
                  defaultValue={previewRank ?? ""}
                  className="border-input bg-background h-10 sm:h-9 rounded-control border px-2 text-base sm:text-sm"
                >
                  <option value="">Choose…</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((r) => (
                    <option key={r} value={r}>
                      {ordinal(r)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <Button type="submit" size="sm" variant="outline">
              Preview
            </Button>
            {previewing && (
              <Link href={here} className="text-muted-foreground text-sm underline underline-offset-2">
                Clear
              </Link>
            )}
          </form>
        </Panel>
      )}

      {!plan ? (
        <Panel>
          <EmptyState
            icon={Medal}
            title="No league to price the medals against"
            body="Once the league is known — recorded by the sync while the season runs, or chosen above — the payout appears here."
          />
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label={plan.final ? "Final position" : "Position so far"}
              value={plan.position ? ordinal(plan.position) : "—"}
              sub={plan.league}
            />
            <StatTile
              label="Full payout each"
              icon={Medal}
              value={plan.fullPayout ?? "—"}
              sub={`at ${FULL_PAYOUT_STARS}+ stars`}
              tone="var(--trim)"
            />
            <StatTile
              label="Bonus medals to give"
              icon={Gift}
              value={plan.bonusCount}
              sub={`${plan.payout.bonusBase} + ${plan.warsWon} for wins`}
            />
            <StatTile
              label="Worth, per bonus"
              icon={Star}
              value={plan.bonusValue}
              sub="medals each"
            />
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Panel className="space-y-4" aria-labelledby="players-title">
              <SectionHeader id="players-title" icon={Users} title="Participants" count={plan.players.length} />
              <p className="text-muted-foreground text-sm">
                Ranked by stars — the evidence for the leader&apos;s in-game bonus choice. Each
                player earns 20% of the payout for being in the lineup, plus 10% for every star,
                and the full amount from {FULL_PAYOUT_STARS} stars.
                {!plan.final && " Stars so far; the numbers settle when the season ends."}
              </p>
              {plan.players.length === 0 ? (
                <p className="text-muted-foreground text-sm">No attacks recorded yet.</p>
              ) : (
                <div className="-mx-5 overflow-x-auto px-5">
                  <table className="cb-stack w-full sm:min-w-[32rem] text-sm">
                    <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                      <tr>
                        <th className="py-2 pr-3 font-medium">#</th>
                        <th className="py-2 pr-3 font-medium">Player</th>
                        <th className="py-2 pr-3 text-right font-medium">Stars</th>
                        <th className="py-2 pr-3 text-right font-medium">Attacks</th>
                        <th className="w-32 py-2 pr-3 font-medium">Share</th>
                        <th className="py-2 text-right font-medium">≈ Medals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.players.map((p, index) => (
                        <tr
                          key={p.playerId}
                          className={cn("border-b last:border-0", index < plan.bonusCount && "bg-gold/10")}
                        >
                          <td data-cell="corner" className="text-muted-foreground py-2.5 pr-3 tabular-nums">{index + 1}</td>
                          <td data-cell="title" className="py-2.5 pr-3">
                            <Link
                              href={`${clanBase}/player/${encodeURIComponent(p.tag)}`}
                              className="font-medium hover:underline"
                            >
                              {p.name}
                            </Link>
                          </td>
                          <td data-label="Stars" className="py-2.5 pr-3 text-right font-semibold tabular-nums">{p.stars}</td>
                          <td data-label="Attacks" className="text-muted-foreground py-2.5 pr-3 text-right tabular-nums">
                            {p.attacksUsed}/{p.warsPlayed}
                          </td>
                          <td data-label="Share" className="py-2.5 pr-3">
                            <span className="flex items-center gap-2">
                              <span
                                className="cb-gauge h-1.5 w-16"
                                style={{ "--gauge": p.share === 1 ? "var(--success)" : "var(--warning)" } as React.CSSProperties}
                              >
                                <span style={{ width: `${p.share * 100}%` }} />
                              </span>
                              <span className="text-xs tabular-nums">{Math.round(p.share * 100)}%</span>
                            </span>
                          </td>
                          <td data-label="≈ Medals" className="py-2.5 text-right font-semibold tabular-nums">
                            {plan.position ? p.medals : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-muted-foreground flex items-start gap-2 text-xs">
                <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                <span>
                  The top {plan.bonusCount} rows are shaded — as many as there are bonus medals — as
                  a starting point, not a decision. Roster players never placed on the war map also
                  receive 20%.
                </span>
              </p>
            </Panel>

            <Panel className="space-y-3" aria-labelledby="payout-title">
              <SectionHeader id="payout-title" icon={Medal} title={`${plan.league} payout`} />
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Position</th>
                    <th className="py-2 text-right font-medium">Medals each</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.payout.byPosition.map((medals, index) => {
                    const ours = plan.position === index + 1;
                    return (
                      <tr key={index} className={cn("border-b last:border-0", ours && "bg-primary/10 font-semibold")}>
                        <td className="py-2 pr-3">
                          {ordinal(index + 1)}
                          {ours && (
                            <span className="bg-primary text-primary-foreground ml-2 rounded-full px-1.5 py-0.5 text-[0.6875rem] sm:text-[0.625rem] font-bold uppercase">
                              You
                            </span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">{medals}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-muted-foreground text-xs">
                Plus {plan.payout.bonusBase} bonus medal{plan.payout.bonusBase === 1 ? "" : "s"} of{" "}
                {plan.bonusValue}, and one more for each war won. Figures from the game&apos;s
                published CWL rewards; if the in-game results screen differs, trust the game.
              </p>
            </Panel>
          </div>
        </>
      )}
    </main>
  );
}
