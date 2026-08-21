// T7.3 — Raid Weekend. Participation, attacks used, capital loot, and history.
//
// R1 — PostgreSQL only. Everything arrives via scripts/sync/raids.ts.
// R3 — the season is resolved under a clan filter before its participants are
// read; see repositories/raids.ts's header for the chain.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHO HAS ATTACKS LEFT COMES FIRST, AND LOOT DOES NOT LEAD
//
// The same choice the war board makes. Loot ranks the people who already did
// well and needs no help from this page — it is in the game, on the clan capital
// screen, and nobody is going to be persuaded by it. What the game does NOT show
// is who still owes attacks with hours left on the weekend, and that is the one
// list a leader can act on.
//
// And it counts ATTACKS AGAINST WHAT EACH MEMBER WAS OFFERED, because a raid
// weekend does not hand everyone the same number. services/raids.ts has the
// argument in full; the short version is that "used 5" is not an answer without
// the 5-or-6 beside it, and this page never prints one without the other.
//
// A member whose limit is unknown is shown as unknown, never as complete. There
// are rows in the database from before migration 027 with no limit at all, and
// rendering those as "5 of 5" would invent a fact.
// ─────────────────────────────────────────────────────────────────────────────
//
// T9.10 — four days in seven there is no live weekend. That is this page's
// normal state and it says so, rather than rendering an empty table.

import Link from "next/link";
import { Coins, Medal, Swords, Target, Trophy } from "lucide-react";
import { DataFreshness } from "@/components/data-freshness";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireClanByTag } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import {
  participantsOfSeason,
  seasonById,
  seasonsForClan,
  type RaidSeasonRow,
} from "@/repositories/raids";
import { latestRun } from "@/repositories/sync-log";
import { freshness } from "@/services/freshness";
import { DISPLAY_ZONE } from "@/lib/display-time";
import {
  historyTotals,
  isOngoing,
  outstandingRaidAttacks,
  raidRecord,
  seasonTotals,
} from "@/services/raids";

export const dynamic = "force-dynamic";

/** Stored UTC, shown in clan-local time (T9.9). See lib/display-time.ts. */
function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DISPLAY_ZONE,
  });
}

/** Big numbers, readably. Capital loot runs to seven figures. */
function compact(n: number): string {
  return n.toLocaleString("en-GB");
}

function stateBadge(season: RaidSeasonRow) {
  if (isOngoing(season)) {
    return (
      <Badge variant="warning">
        <Swords aria-hidden />
        Raiding now
      </Badge>
    );
  }
  return <Badge variant="outline">Ended {when(season.endTime)}</Badge>;
}

export default async function RaidsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ weekend?: string }>;
}) {
  const { clanTag } = await params;
  const { weekend: requested } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const base = `/${encodeURIComponent(clan.tag)}`;

  const [seasons, run] = await Promise.all([
    seasonsForClan(supabase, clan.id),
    latestRun(supabase, "raids", clan.id),
  ]);
  const fresh = freshness(run);

  // R3 — seasonById filters by clan, so a weekend id from another clan resolves
  // to nothing and falls back to ours rather than to their data.
  const season = requested
    ? ((await seasonById(supabase, clan.id, requested)) ?? seasons[0] ?? null)
    : (seasons[0] ?? null);

  const participants = season ? await participantsOfSeason(supabase, season.id) : [];
  const record = raidRecord(participants);
  const outstanding = outstandingRaidAttacks(record);
  const totals = season ? seasonTotals(season, participants) : null;
  const history = historyTotals(seasons);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Raid weekends</h1>
          <DataFreshness freshness={fresh} />
        </div>
        <p className="text-muted-foreground text-sm">
          {clan.name} ·{" "}
          <Link className="underline underline-offset-2" href={base}>
            back to the clan
          </Link>
        </p>
      </div>

      {!season ? (
        // T9.10 — distinguishing "the job has never run" from "this clan has
        // never raided" matters: a leader can act on the first and cannot on
        // the second.
        <section className="space-y-3 rounded-lg border border-dashed p-6">
          <h2 className="font-medium">No raid weekends recorded</h2>
          <p className="text-muted-foreground text-sm">
            {fresh.level === "never"
              ? "The raid sync has never run. It goes out daily once the API key is configured."
              : "The sync has run but found no raid history — normal for a clan that has not opened its Clan Capital yet. Weekends appear here within a day of the first one finishing."}
          </p>
        </section>
      ) : (
        <>
          {/* ── The weekend ────────────────────────────────────────────────── */}
          <section className="cb-panel space-y-4 rounded-xl border p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-medium">
                Weekend of {when(season.startTime)}
              </h2>
              {stateBadge(season)}
            </div>

            <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Raid medals
                </p>
                <p className="text-2xl font-semibold tabular-nums">
                  {compact(season.offensiveReward ?? 0)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {compact(season.defensiveReward ?? 0)} defensive
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Capital loot
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {compact(season.totalLoot ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Districts cleared
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {season.raidsCompleted ?? "—"}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs tracking-wide uppercase">
                  Attacks
                </p>
                <p className="text-lg font-semibold tabular-nums">
                  {totals!.attacksUsed}
                  {totals!.attacksOffered > 0 && (
                    <span className="text-muted-foreground font-normal">
                      {" "}
                      of {totals!.attacksOffered}
                    </span>
                  )}
                </p>
                {/* The honest footnote. A denominator that silently drops rows
                    reads as complete and is not. */}
                {totals!.unknownLimits > 0 && (
                  <p className="text-muted-foreground text-xs">
                    {totals!.unknownLimits} with no known limit, not counted
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ── The chase list, first ──────────────────────────────────────── */}
          {outstanding.length > 0 && (
            <section className="cb-panel space-y-3 rounded-xl border p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 font-medium">
                  <Target aria-hidden className="text-muted-foreground size-4" />
                  Still have attacks
                </h2>
                <Badge variant={isOngoing(season) ? "warning" : "secondary"}>
                  {outstanding.reduce((t, r) => t + (r.owed ?? 0), 0)} unused
                </Badge>
              </div>
              {!isOngoing(season) && (
                <p className="text-muted-foreground text-sm">
                  This weekend is over — nothing to chase, but worth remembering
                  when the next lineup is picked.
                </p>
              )}
              <ul className="divide-y">
                {outstanding.map((r) => (
                  <li key={r.playerId} className="flex items-center gap-4 py-2">
                    <Link
                      className="min-w-0 flex-1 underline-offset-2 hover:underline"
                      href={`${base}/player/${encodeURIComponent(r.tag)}`}
                    >
                      {r.name}
                    </Link>
                    <span className="text-sm tabular-nums">
                      {r.attacksUsed ?? 0} of {r.offered}
                    </span>
                    <Badge variant={r.satOut ? "destructive" : "warning"}>
                      {r.satOut ? "none used" : `${r.owed} left`}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── Everyone ───────────────────────────────────────────────────── */}
          <section className="cb-panel space-y-4 rounded-xl border p-6">
            <h2 className="font-medium">Who raided</h2>

            {record.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nobody raided this weekend. The season was still recorded — the
                medals and loot are on it — but no member took an attack.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b text-left">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Member</th>
                      <th className="py-2 pr-3 text-right font-medium">Attacks</th>
                      <th className="py-2 pr-3 text-right font-medium">Unused</th>
                      <th className="py-2 text-right font-medium">Loot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {record.map((r) => (
                      <tr key={r.playerId} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <Link
                            className="underline-offset-2 hover:underline"
                            href={`${base}/player/${encodeURIComponent(r.tag)}`}
                          >
                            {r.name}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.attacksUsed ?? 0}
                          {/* Never a bare number. See the header. */}
                          <span className="text-muted-foreground">
                            {r.offered === null ? " of ?" : ` of ${r.offered}`}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">
                          {r.owed === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : r.owed > 0 ? (
                            <span className="text-warning-ink font-medium">{r.owed}</span>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td className="py-2 text-right tabular-nums">
                          {compact(r.loot ?? 0)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {/* ── History ────────────────────────────────────────────────────────── */}
      {seasons.length > 0 && (
        <section className="cb-panel space-y-4 rounded-xl border p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 font-medium">
              <Trophy aria-hidden className="text-muted-foreground size-4" />
              History
            </h2>
            <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1">
                <Medal aria-hidden className="size-3" />
                {compact(history.offensiveReward)} medals
              </span>
              <span className="inline-flex items-center gap-1">
                <Coins aria-hidden className="size-3" />
                {compact(history.totalLoot)} loot
              </span>
              <span>{history.weekends} weekend(s)</span>
            </div>
          </div>

          {/* The API keeps only the last ten weekends, and this list is
              therefore the only copy once they roll off — R4's whole point. */}
          <ul className="divide-y">
            {seasons.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                <Link
                  className="min-w-0 flex-1 text-sm underline-offset-2 hover:underline"
                  href={`?weekend=${encodeURIComponent(s.id)}`}
                >
                  {when(s.startTime)}
                </Link>
                {isOngoing(s) && (
                  <Badge variant="warning">
                    <Swords aria-hidden />
                    live
                  </Badge>
                )}
                {s.id === season?.id && <Badge variant="info">showing</Badge>}
                <span className="text-muted-foreground text-sm tabular-nums">
                  {compact(s.offensiveReward ?? 0)} medals
                </span>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {compact(s.totalLoot ?? 0)} loot
                </span>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground text-xs">
            The game keeps only the most recent weekends. Anything older than
            that survives here and nowhere else.
          </p>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={`${base}/games`}>Clan Games</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={`${base}/members`}>Members</Link>
        </Button>
      </div>
    </main>
  );
}
