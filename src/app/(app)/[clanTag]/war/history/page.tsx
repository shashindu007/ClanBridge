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
// R4 — nothing is ever deleted, so this list only grows. That is the feature:
// the logbook it replaces was a physical notebook, and the reason the CWL half
// of this project exists at all is that data which disappears cannot be argued
// with later.

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataFreshness } from "@/components/data-freshness";
import { requireClanByTag } from "@/lib/clans";
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
    year: "numeric",
    timeZone: DISPLAY_ZONE,
  });
}

function resultBadge(war: WarRow) {
  if (war.result === "win") return <Badge>Win</Badge>;
  if (war.result === "lose") return <Badge variant="destructive">Loss</Badge>;
  if (war.result === "tie") return <Badge variant="secondary">Tie</Badge>;
  // A war still in preparation has no result, and scoring it as anything —
  // including a loss — would be a lie about a war that has not been fought.
  return <Badge variant="outline">{war.state ?? "not started"}</Badge>;
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

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">War history</h1>
          <DataFreshness freshness={runs} canAdmin={clan.role === "leader"} />
        </div>
        <p className="text-muted-foreground text-sm">
          {clan.name} ·{" "}
          <Link className="underline" href={`${base}/war`}>
            current war
          </Link>{" "}
          ·{" "}
          <Link className="underline" href={`${base}/war/report`}>
            contribution
          </Link>
        </p>
      </div>

      {wars.length === 0 ? (
        <section className="cb-panel space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">No wars recorded yet</h2>
          <p className="text-muted-foreground text-sm">
            {runs.level === "never"
              ? "The war sync has never run. Wars appear here from the first run after one is declared."
              : "The sync is running and has not seen a war yet. Every war from now on is kept permanently."}
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href={`${base}/war/lineup`}>Plan a lineup</Link>
          </Button>
        </section>
      ) : (
        <>
          <section className="rounded-lg border p-6">
            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {totals.wins}–{totals.losses}
                  {totals.ties > 0 && `–${totals.ties}`}
                </p>
                <p className="text-muted-foreground text-xs">
                  from {totals.warsPlayed} finished war{totals.warsPlayed === 1 ? "" : "s"}
                </p>
              </div>
              <div>
                <p className="text-lg font-medium tabular-nums">
                  {totals.stars} – {totals.starsAgainst}
                </p>
                <p className="text-muted-foreground text-xs">stars for and against</p>
              </div>
              {wars.length !== totals.warsPlayed && (
                <p className="text-muted-foreground text-xs">
                  {wars.length - totals.warsPlayed} war
                  {wars.length - totals.warsPlayed === 1 ? "" : "s"} still in progress, not
                  counted
                </p>
              )}
            </div>
          </section>

          <section className="rounded-lg border p-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground border-b text-left">
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
                  {wars.map((war) => (
                    <tr key={war.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        <Link
                          className="underline-offset-2 hover:underline"
                          href={`${base}/war?war=${encodeURIComponent(war.id)}`}
                        >
                          {when(war.startTime)}
                        </Link>
                      </td>
                      <td className="py-2 pr-3">
                        {war.opponentName ?? (
                          <span className="text-muted-foreground">unknown</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {war.teamSize ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {war.ourStars ?? 0} – {war.theirStars ?? 0}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {(war.ourDestruction ?? 0).toFixed(1)}% –{" "}
                        {(war.theirDestruction ?? 0).toFixed(1)}%
                      </td>
                      <td className="py-2">{resultBadge(war)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
