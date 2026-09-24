// T6.6 — War history.
//
// Every query filters by clan (R3). warsForClan takes the clan id and reaches
// nothing outside it, and RLS denies the rest as the net rather than the
// mechanism.
//
// Each row links back to the board with ?war=<id>, which is the whole reason the
// board takes that parameter. Without it T6.5 — the plan beside the outcome —
// would only ever work for the war currently running, and the comparison is most
// useful after the war, when someone is asking why base 7 was left standing.
//
// GROUPED BY MONTH, and folded after the latest two. A hundred rows in one table
// was a page nobody reached the end of; a month is how a clan remembers its wars
// ("we lost three in August"). The record sits in a line of facts under the
// title rather than in a panel of its own, and the dotted links that repeated
// the War tabs above ("current war · contribution") are gone.
//
// R4 — nothing is ever deleted, so this list only grows. That is the feature:
// the logbook it replaces was a physical notebook, and the reason the CWL half
// of this project exists at all is that data which disappears cannot be argued
// with later.

import Link from "next/link";
import { Star, Swords, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataFreshness } from "@/components/data-freshness";
import { PageHeader } from "@/components/page-header";
import { Disclosure, EmptyState, FactRow, Panel } from "@/components/kit";
import { ClanBadge } from "@/components/game/clan-badge";
import { requireClanByTag } from "@/lib/clans";
import { isLeader } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import { latestRun } from "@/repositories/sync-log";
import { warsForClan, type WarRow } from "@/repositories/war";
import { freshness } from "@/services/freshness";
import { warTotals } from "@/services/war";
import { DISPLAY_ZONE } from "@/lib/display-time";

export const dynamic = "force-dynamic";

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: DISPLAY_ZONE,
  });
}

function monthOf(iso: string | null): string {
  if (!iso) return "Undated";
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: DISPLAY_ZONE,
  });
}

function resultBadge(war: WarRow) {
  if (war.result === "win") return <Badge variant="success">Won</Badge>;
  if (war.result === "lose") return <Badge variant="destructive">Lost</Badge>;
  if (war.result === "tie") return <Badge variant="secondary">Draw</Badge>;
  // A war still in preparation has no result, and scoring it as anything —
  // including a loss — would be a lie about a war that has not been fought.
  const state =
    war.state === "inWar" ? "Battle day" : war.state === "preparation" ? "Preparation" : "Not started";
  return <Badge variant="outline">{state}</Badge>;
}

/** Newest month first, each month's wars newest first — the order warsForClan returns. */
function byMonth(wars: WarRow[]): Array<{ month: string; wars: WarRow[] }> {
  const groups: Array<{ month: string; wars: WarRow[] }> = [];
  for (const war of wars) {
    const month = monthOf(war.startTime);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.wars.push(war);
    else groups.push({ month, wars: [war] });
  }
  return groups;
}

export default async function WarHistoryPage({
  params,
}: {
  params: Promise<{ clanTag: string }>;
}) {
  const { clanTag } = await params;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const base = `/${encodeURIComponent(clan.tag)}`;

  const wars = await warsForClan(supabase, clan.id, 100);
  const runs = freshness(await latestRun(supabase, "war", clan.id));
  const totals = warTotals(wars);
  const running = wars.length - totals.warsPlayed;

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        eyebrow={clan.name}
        title="War history"
        description="Every war this clan has fought since the sync started, kept for good. Open one to see its plan beside its result."
        actions={<DataFreshness freshness={runs} canAdmin={isLeader(clan.role)} />}
      />

      {wars.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Swords}
            title="No wars recorded yet"
            body={
              runs.level === "never"
                ? "The war sync has never run. Wars appear here from the first run after one is declared."
                : "The sync is running and has not seen a war yet. Every war from now on is kept permanently."
            }
            action={
              <Button asChild variant="outline">
                <Link href={`${base}/war/lineup`}>Plan a lineup</Link>
              </Button>
            }
          />
        </Panel>
      ) : (
        <>
          <FactRow
            items={[
              {
                label: totals.ties > 0 ? "won–lost–drawn" : "won–lost",
                value: `${totals.wins}–${totals.losses}${totals.ties > 0 ? `–${totals.ties}` : ""}`,
                icon: Trophy,
                title: `From ${totals.warsPlayed} finished war${totals.warsPlayed === 1 ? "" : "s"}`,
              },
              { label: "stars for – against", value: `${totals.stars} – ${totals.starsAgainst}`, icon: Star },
              ...(running > 0
                ? [
                    {
                      label: running === 1 ? "war still running, not counted" : "wars still running, not counted",
                      value: running,
                      icon: Swords,
                    },
                  ]
                : []),
            ]}
          />

          {byMonth(wars).map(({ month, wars: inMonth }, i) => {
            const won = inMonth.filter((w) => w.result === "win").length;
            const lost = inMonth.filter((w) => w.result === "lose").length;
            return (
              <Disclosure
                key={month}
                title={month}
                count={inMonth.length}
                defaultOpen={i < 2}
                summary={`${won} won · ${lost} lost`}
              >
                <div className="-mx-5 overflow-x-auto px-5">
                  <table className="w-full min-w-[36rem] text-sm">
                    <thead className="text-muted-foreground border-b text-left text-xs uppercase">
                      <tr>
                        <th className="py-2 pr-3 font-medium">Started</th>
                        <th className="py-2 pr-3 font-medium">Opponent</th>
                        <th className="py-2 pr-3 text-right font-medium">Size</th>
                        <th className="py-2 pr-3 text-right font-medium">Stars</th>
                        <th className="py-2 pr-3 text-right font-medium">Destruction</th>
                        <th className="py-2 font-medium">Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inMonth.map((war) => (
                        <tr key={war.id} className="border-b last:border-0">
                          <td className="py-2.5 pr-3">
                            <Link
                              className="text-primary font-medium underline-offset-2 hover:underline"
                              href={`${base}/war?war=${encodeURIComponent(war.id)}`}
                            >
                              {when(war.startTime)}
                            </Link>
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="flex items-center gap-2">
                              <ClanBadge
                                src={war.opponentBadgeUrl}
                                name={war.opponentName ?? "?"}
                                size="sm"
                                tone="var(--foe)"
                              />
                              {war.opponentName ?? <span className="text-muted-foreground">unknown</span>}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{war.teamSize ?? "—"}</td>
                          <td className="py-2.5 pr-3 text-right font-medium tabular-nums">
                            {war.ourStars ?? 0} – {war.theirStars ?? 0}
                          </td>
                          <td className="text-muted-foreground py-2.5 pr-3 text-right tabular-nums">
                            {(war.ourDestruction ?? 0).toFixed(1)}% – {(war.theirDestruction ?? 0).toFixed(1)}%
                          </td>
                          <td className="py-2.5">{resultBadge(war)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Disclosure>
            );
          })}
        </>
      )}
    </main>
  );
}
