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
import { CalendarClock, Crown, Gamepad2, HelpCircle, Trophy, Users } from "lucide-react";
import { DataFreshness } from "@/components/data-freshness";
import { PageHeader } from "@/components/page-header";
import { EmptyState, FactRow, Panel } from "@/components/kit";
import { Ribbon } from "@/components/game/ribbon";
import { Badge } from "@/components/ui/badge";
import { clanGamesWindow, isDuringClanGames } from "@/lib/coc-time";
import { requireClanByTag } from "@/lib/clans";
import { isLeader } from "@/lib/visibility";
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
import { DISPLAY_ZONE } from "@/lib/display-time";

export const dynamic = "force-dynamic";

/** 'YYYY-MM' as something a person reads. */
/**
 * The season's month. Stays UTC deliberately: the date is CONSTRUCTED at
 * midnight UTC on the first of the month purely to carry a 'YYYY-MM' key, and
 * re-zoning it would roll it backwards into the previous month — labelling
 * August's Clan Games "July 2026".
 */
function monthName(season: string): string {
  const [year, month] = season.split("-");
  if (!year || !month) return season;
  return new Date(Date.UTC(Number(year), Number(month) - 1, 1)).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A real instant — when the Clan Games window opens and closes — so it shows in
 * clan-local time (T9.9). This one matters more than most: the window opens at
 * 08:00 UTC, which is 13:30 in Sri Lanka, and a member told "opens 08:00" waits
 * half a day for something that already started.
 */
function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: DISPLAY_ZONE,
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
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      {/* The period's state is a RIBBON under the title, where it was an Alert
          on every visit — amber, the reserved "look at this" hue, for the
          ordinary fact that the games are on. "back to the clan" (the Overview
          tab) and the Raids/Members buttons at the foot were tabs repeated. */}
      <PageHeader
        eyebrow={clan.name}
        title="Clan Games"
        ribbons={
          running ? (
            <Ribbon tone="prep" icon={Gamepad2}>
              On now · until {when(nextWindow.end.toISOString())}
            </Ribbon>
          ) : (
            <Ribbon tone="neutral" icon={CalendarClock}>
              Next · {when(nextWindow.start.toISOString())}
            </Ribbon>
          )
        }
        description={
          running
            ? "Scores fill in once the period closes — each is the difference between two readings, and the second has not been taken yet."
            : "Scores appear here the day after a period ends."
        }
        actions={<DataFreshness freshness={fresh} canAdmin={isLeader(clan.role)} />}
      />

      {!games ? (
        <Panel>
          <EmptyState
            icon={Gamepad2}
            title="No Clan Games recorded yet"
            body={
              <>
                {fresh.level === "never"
                  ? "The Clan Games sync has never run. It goes out daily and does nothing outside the monthly period, so the first scores appear after the next games finish."
                  : "The sync has run but no period has completed yet. The first month's scores appear the day after it closes."}{" "}
                {/* The one number in the project that cannot be backfilled. */}
                Scores come from two snapshots six days apart, so a period the sync
                missed the start of cannot be recovered afterwards.
              </>
            }
          />
        </Panel>
      ) : (
        <>
          {/* ── The month ──────────────────────────────────────────────────── */}
          <section data-scene="banner" className="cb-panel space-y-4 rounded-panel border p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">{monthName(games.season)}</h2>
              {settledBadge(games)}
            </div>

            <FactRow
              items={[
                { label: "clan points", value: totals.points.toLocaleString("en-GB"), icon: Trophy },
                {
                  label: "best score",
                  value: totals.best === null ? "—" : totals.best.toLocaleString("en-GB"),
                  icon: Crown,
                },
                {
                  label: "members measured",
                  value: totals.scored,
                  icon: Users,
                },
              ]}
            />
            {/* Never present a partial total as a complete one. */}
            {(totals.pending > 0 || totals.unmeasured > 0) && (
              <p className="text-muted-foreground text-xs">
                {totals.pending > 0 && `${totals.pending} pending`}
                {totals.pending > 0 && totals.unmeasured > 0 && ", "}
                {totals.unmeasured > 0 && `${totals.unmeasured} not measured`} — not in the total.
              </p>
            )}

            {!isSettled(games) && (
              <p className="text-warning-ink text-sm">
                This month is not final. Nothing here is a score yet — the
                closing snapshot has not been taken.
              </p>
            )}
          </section>

          {/* ── The leaderboard ────────────────────────────────────────────── */}
          <section className="cb-panel space-y-4 rounded-panel border p-5">
            <h2 className="text-lg font-semibold">Scores</h2>

            {ranked.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nobody has a score for this month yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b text-left text-xs uppercase">
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
            <section className="cb-panel space-y-3 rounded-panel border p-5">
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
        <section className="cb-panel space-y-3 rounded-panel border p-5">
          <h2 className="text-lg font-semibold">Past months</h2>
          <ul className="divide-y">
            {months.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link
                  className="min-w-0 flex-1 text-sm underline-offset-2 hover:underline"
                  href={`?season=${encodeURIComponent(m.season)}`}
                  aria-current={m.id === games?.id ? "page" : undefined}
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

    </main>
  );
}
