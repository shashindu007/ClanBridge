// T7.5 — Clan Games.
//
// R1 — PostgreSQL only. R3 — the month is resolved under a clan filter before
// its scores are read; see repositories/clan-games.ts for the chain.
//
// ─────────────────────────────────────────────────────────────────────────────
// EVERY NUMBER ON THIS PAGE IS A SUBTRACTION, AND THE PAGE SAYS SO
//
// The API publishes no Clan Games score. Each figure here is one snapshot of a
// player's "Games Champion" achievement minus another taken six days earlier —
// which means a member with no opening reading has no score, and cannot be
// given one later. There is nothing to subtract from.
//
// So this page has THREE groups, not two. Scored (including zero, which is a
// real answer), pending (the period is running and nothing can be said yet),
// and not measured (they joined mid-period, or the opening snapshot missed
// them). services/clan-games.ts argues it in full.
//
// The third group is rendered separately and never inside the ranking. A member
// who joined on the 25th sitting at the bottom of a leaderboard beside a member
// who did nothing, both showing 0, accuses the first of the second's behaviour —
// and bonus decisions get made off this page.
// ─────────────────────────────────────────────────────────────────────────────
//
// T9.10 — three weeks in four there is no period running. That is this page's
// normal state.

import Link from "next/link";
import { CalendarClock, Gamepad2, HelpCircle, Trophy } from "lucide-react";
import { DataFreshness } from "@/components/data-freshness";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { clanGamesWindow, isDuringClanGames } from "@/lib/coc-time";
import { requireClanByTag } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import {
  gamesBySeason,
  gamesForClan,
  scoresForGames,
  type ClanGamesRow,
} from "@/repositories/clan-games";
import { latestRun } from "@/repositories/sync-log";
import { freshness } from "@/services/freshness";
import { gamesTotals, isSettled, leaderboard } from "@/services/clan-games";

export const dynamic = "force-dynamic";

/** 'YYYY-MM' as something a person reads. */
function monthName(season: string): string {
  const [year, month] = season.split("-");
  if (!year || !month) return season;
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function settledBadge(games: ClanGamesRow) {
  return isSettled(games) ? (
    <Badge variant="success">
      <Trophy aria-hidden />
      Final
    </Badge>
  ) : (
    // Unmissable, because a provisional leaderboard WILL be screenshotted.
    <Badge variant="warning">
      <CalendarClock aria-hidden />
      Still running
    </Badge>
  );
}

export default async function ClanGamesPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const { clanTag } = await params;
  const { season: requested } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const base = `/${encodeURIComponent(clan.tag)}`;

  const [months, run] = await Promise.all([
    gamesForClan(supabase, clan.id),
    latestRun(supabase, "clan-games", clan.id),
  ]);
  const fresh = freshness(run);

  // R3 — gamesBySeason filters by clan, so a season string from elsewhere
  // resolves to nothing and falls back to ours.
  const games = requested
    ? ((await gamesBySeason(supabase, clan.id, requested)) ?? months[0] ?? null)
    : (months[0] ?? null);

  const scores = games ? await scoresForGames(supabase, games.id) : [];
  const entries = games ? leaderboard(scores, games) : [];
  const totals = gamesTotals(entries);

  const ranked = entries.filter((e) => e.status !== "unmeasured");
  const unmeasured = entries.filter((e) => e.status === "unmeasured");

  const now = new Date();
  const running = isDuringClanGames(now);
  const nextWindow = clanGamesWindow(now);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Clan Games</h1>
          <DataFreshness freshness={fresh} />
        </div>
        <p className="text-muted-foreground text-sm">
          {clan.name} ·{" "}
          <Link className="underline underline-offset-2" href={base}>
            back to the clan
          </Link>
        </p>
      </div>

      {/* The period status, whether or not there is data. T9.10 — "no games on"
          is the state three weeks in four and has to look deliberate. */}
      <Alert variant={running ? "warning" : "info"}>
        {running ? <Gamepad2 aria-hidden /> : <CalendarClock aria-hidden />}
        <AlertTitle>
          {running
            ? "Clan Games are running now"
            : `Next Clan Games open ${when(nextWindow.start.toISOString())}`}
        </AlertTitle>
        <AlertDescription>
          <p>
            {running
              ? `Points are counted until ${when(nextWindow.end.toISOString())}. The table below fills in once the period closes — the score is a difference between two readings, and the second has not been taken yet.`
              : "Scores appear here the day after a period ends."}
          </p>
        </AlertDescription>
      </Alert>

      {!games ? (
        <section className="space-y-3 rounded-lg border border-dashed p-6">
          <h2 className="font-medium">No Clan Games recorded yet</h2>
          <p className="text-muted-foreground text-sm">
            {fresh.level === "never"
              ? "The Clan Games sync has never run. It goes out daily and does nothing outside the monthly period, so the first scores appear after the next games finish."
              : "The sync has run but no period has completed yet. The first month's scores appear the day after it closes."}
          </p>
          {/* Worth saying plainly: this is the one number in the whole project
              that cannot be backfilled, so a missed month is a missed month. */}
          <p className="text-muted-foreground text-sm">
            Clan Games scores are derived from two snapshots taken six days
            apart. A period the sync missed the start of cannot be recovered
            afterwards — there is no history in the game API to read back.
          </p>
        </section>
      ) : (
        <>
          {/* ── The month ──────────────────────────────────────────────────── */}
          <section className="bg-card space-y-4 rounded-lg border p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">{monthName(games.season)}</h2>
              {settledBadge(games)}
            </div>

            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Clan total
                </p>
                <p className="text-2xl font-semibold tabular-nums">
                  {totals.points.toLocaleString("en-GB")}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Best score
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {totals.best === null ? "—" : totals.best.toLocaleString("en-GB")}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Measured
                </p>
                <p className="text-lg font-semibold tabular-nums">{totals.scored}</p>
                {/* Never present a partial total as a complete one. */}
                {(totals.pending > 0 || totals.unmeasured > 0) && (
                  <p className="text-muted-foreground text-xs">
                    {totals.pending > 0 && `${totals.pending} pending`}
                    {totals.pending > 0 && totals.unmeasured > 0 && ", "}
                    {totals.unmeasured > 0 && `${totals.unmeasured} not measured`}
                  </p>
                )}
              </div>
            </div>

            {!isSettled(games) && (
              <p className="text-warning-ink text-sm">
                This month is not final. Nothing here is a score yet — the
                closing snapshot has not been taken.
              </p>
            )}
          </section>

          {/* ── The leaderboard ────────────────────────────────────────────── */}
          <section className="bg-card space-y-4 rounded-lg border p-6">
            <h2 className="font-medium">Scores</h2>

            {ranked.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nobody has a score for this month yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b text-left">
                    <tr>
                      <th className="py-2 pr-3 text-right font-medium">#</th>
                      <th className="py-2 pr-3 font-medium">Member</th>
                      <th className="py-2 text-right font-medium">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranked.map((e, index) => (
                      <tr key={e.playerId} className="border-b last:border-0">
                        <td className="text-muted-foreground py-2 pr-3 text-right tabular-nums">
                          {e.status === "scored" ? index + 1 : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <Link
                            className="underline-offset-2 hover:underline"
                            href={`${base}/player/${encodeURIComponent(e.tag)}`}
                          >
                            {e.name}
                          </Link>
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {e.status === "scored" ? (
                            (e.points ?? 0).toLocaleString("en-GB")
                          ) : (
                            <Badge variant="secondary">counting</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Separately, and deliberately not in the ranking ─────────────── */}
          {unmeasured.length > 0 && (
            <section className="bg-card space-y-3 rounded-lg border p-6">
              <h2 className="flex items-center gap-2 font-medium">
                <HelpCircle aria-hidden className="text-muted-foreground size-4" />
                Not measured this month
              </h2>
              <p className="text-muted-foreground text-sm">
                No opening reading was taken for these members, so their points
                cannot be worked out — the score is a difference, and there is
                nothing to subtract from. Usually it means they joined after the
                period started. <strong>It does not mean they scored nothing.</strong>
              </p>
              <ul className="flex flex-wrap gap-2">
                {unmeasured.map((e) => (
                  <li key={e.playerId}>
                    <Badge variant="outline" asChild>
                      <Link href={`${base}/player/${encodeURIComponent(e.tag)}`}>
                        {e.name}
                      </Link>
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* ── History ────────────────────────────────────────────────────────── */}
      {months.length > 1 && (
        <section className="bg-card space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">Past months</h2>
          <ul className="divide-y">
            {months.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link
                  className="min-w-0 flex-1 text-sm underline-offset-2 hover:underline"
                  href={`?season=${encodeURIComponent(m.season)}`}
                >
                  {monthName(m.season)}
                </Link>
                {!isSettled(m) && <Badge variant="warning">running</Badge>}
                {m.id === games?.id && <Badge variant="info">showing</Badge>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={`${base}/raids`}>Raid weekends</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`${base}/members`}>Members</Link>
        </Button>
      </div>
    </main>
  );
}
