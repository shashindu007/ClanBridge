// T6.9 — War contribution report.
// T6.10 — War plan versus reality.
//
// Compare war_lineup_members to the API roster, and war_targets to war_attacks
// (R12). Both comparisons need both sides to still exist, which is the entire
// reason migration 024 keeps the leader's lineup in its own table and forbids
// every sync job from touching it. A job that "reconciled" the two would leave
// this page with nothing to show and no way to know it.
//
// ─────────────────────────────────────────────────────────────────────────────
// THREE NUMBERS THAT ARE EASY TO REPORT WRONGLY, AND ALL THREE ARE ABOUT PEOPLE
//
// 1. "Attacks available" is summed PER WAR. A member in four wars of six has
//    eight available, not twelve — the multiplied version invents four missed
//    attacks in wars they were never rostered for.
//
// 2. "Ignored their target" is not the complement of "followed it". The gap is
//    "we cannot tell": no attack yet, or an attack whose defender the sync could
//    not place. Those are counted separately and shown separately, because a
//    report that says six people disobeyed when five simply had not attacked is
//    worse than no report at all.
//
// 3. A war with no linked lineup has no plan to compare against, and that is
//    stated rather than rendered as an empty comparison — which would read as
//    "nobody was picked".
// ─────────────────────────────────────────────────────────────────────────────
//
// R3 — every war here comes from warsForClan/warById under an explicit clan
// filter, and their children are read by ids already proven to belong.

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireClanByTag } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import { DISPLAY_ZONE } from "@/lib/display-time";
import {
  attacksForWar,
  lineupForWar,
  membersOfLineup,
  membersOfWar,
  targetsForWar,
  warById,
  warsForClan,
  type WarAttackRow,
  type WarMemberRow,
  type WarRow,
  type WarTargetRow,
} from "@/repositories/war";
import {
  isComparable,
  planVersusReality,
  targetCompliance,
  warContribution,
  warRecord,
} from "@/services/war";

export const dynamic = "force-dynamic";

/** How many wars the aggregate covers. Enough to be a pattern, few enough to be current. */
const RECENT_WARS = 10;

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DISPLAY_ZONE,
  });
}

export default async function WarReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ war?: string }>;
}) {
  const { clanTag } = await params;
  const { war: requestedWar } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const base = `/${encodeURIComponent(clan.tag)}`;

  const wars = await warsForClan(supabase, clan.id, RECENT_WARS);

  if (wars.length === 0) {
    return (
      <main className="mx-auto max-w-7xl space-y-6 p-8">
        <ReportHeader clanName={clan.name} base={base} />
        <section className="space-y-3 rounded-lg border p-6">
          <h2 className="font-medium">No wars to report on yet</h2>
          <p className="text-muted-foreground text-sm">
            This page compares who was picked against who played, and who was told
            to hit what against what they hit. Both need a finished war.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link href={`${base}/war/lineup`}>Plan a lineup</Link>
          </Button>
        </section>
      </main>
    );
  }

  // Everything for the aggregate, loaded once and reused for the per-war
  // section below rather than fetched twice.
  const loaded: Array<{
    war: WarRow;
    members: WarMemberRow[];
    attacks: WarAttackRow[];
    targets: WarTargetRow[];
  }> = [];

  // Every war's three reads in flight together, rather than a war at a time.
  // WAR_WINDOW wars at three sequential queries each was 3N round trips before
  // the first row could render; it is now three waves regardless of N.
  loaded.push(
    ...(await Promise.all(
      wars.map(async (war) => {
        const [members, attacks, targets] = await Promise.all([
          membersOfWar(supabase, war.id),
          attacksForWar(supabase, war.id),
          targetsForWar(supabase, war.id),
        ]);
        return { war, members, attacks, targets };
      }),
    )),
  );

  const contribution = warContribution(loaded);

  // ── T6.10, for one war ────────────────────────────────────────────────────
  const focus = requestedWar
    ? (loaded.find((l) => l.war.id === requestedWar) ??
      (await loadOne(supabase, clan.id, requestedWar)))
    : (loaded.find((l) => l.war.state === "warEnded") ?? loaded[0]!);

  const lineup = focus ? await lineupForWar(supabase, clan.id, focus.war.id) : null;
  const picked = lineup ? await membersOfLineup(supabase, lineup.id) : [];
  const comparison = focus ? planVersusReality(picked, focus.members) : null;
  const compliance = focus
    ? targetCompliance(warRecord(focus.members, focus.attacks, focus.targets))
    : null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <ReportHeader clanName={clan.name} base={base} />

      {/* ── T6.10 ─────────────────────────────────────────────────────────── */}
      {focus && comparison && compliance && (
        <section className="space-y-4 rounded-lg border p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-medium">
              Plan versus reality —{" "}
              <Link
                className="underline underline-offset-2"
                href={`${base}/war?war=${encodeURIComponent(focus.war.id)}`}
              >
                {focus.war.opponentName ?? "unknown"}, {when(focus.war.startTime)}
              </Link>
            </h2>
          </div>

          {/* Who was picked versus who played */}
          {!isComparable(lineup) ? (
            <p className="text-muted-foreground text-sm">
              No published lineup is linked to this war, so there is no plan to
              compare against. Link one from the{" "}
              <Link className="underline" href={`${base}/war/lineup`}>
                lineup page
              </Link>{" "}
              — the API can say who played and never who was meant to.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <Bucket
                title="Picked and played"
                names={comparison.playedAsPicked.map((m) => m.name)}
                tone="default"
              />
              {/* The bucket no amount of API data can produce alone: the API
                  cannot report an absence it never knew was expected. */}
              <Bucket
                title="Picked, did not play"
                names={comparison.pickedButAbsent.map((m) => m.name)}
                tone="destructive"
              />
              <Bucket
                title="Played, not picked"
                names={comparison.playedUnpicked.map((m) => m.name)}
                tone="secondary"
              />
            </div>
          )}

          {/* Told to hit versus hit */}
          <div className="border-t pt-4">
            <h3 className="mb-2 text-sm font-medium">Targets</h3>
            {compliance.judged === 0 && compliance.unknown === 0 ? (
              <p className="text-muted-foreground text-sm">
                No targets were assigned in this war
                {compliance.unassigned > 0 &&
                  ` — ${compliance.unassigned} member${
                    compliance.unassigned === 1 ? "" : "s"
                  } attacked without one`}
                .
              </p>
            ) : (
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
                <span>
                  <strong>{compliance.followed}</strong> hit their target
                </span>
                <span>
                  <strong>{compliance.ignored}</strong> hit something else
                </span>
                {/* Its own number, never folded into "ignored". */}
                {compliance.unknown > 0 && (
                  <span className="text-muted-foreground">
                    {compliance.unknown} not yet judgeable
                  </span>
                )}
                {compliance.unassigned > 0 && (
                  <span className="text-muted-foreground">
                    {compliance.unassigned} attacked unassigned
                  </span>
                )}
              </div>
            )}
          </div>

          {wars.length > 1 && (
            <nav className="flex flex-wrap gap-2 border-t pt-4">
              {wars.map((w) => (
                <Button
                  key={w.id}
                  asChild
                  size="xs"
                  variant={w.id === focus.war.id ? "default" : "outline"}
                >
                  <Link href={`${base}/war/report?war=${encodeURIComponent(w.id)}`}>
                    {when(w.startTime)}
                  </Link>
                </Button>
              ))}
            </nav>
          )}
        </section>
      )}

      {/* ── T6.9 ──────────────────────────────────────────────────────────── */}
      <section className="space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">
            Contribution{" "}
            <span className="text-muted-foreground font-normal">
              (last {wars.length} war{wars.length === 1 ? "" : "s"})
            </span>
          </h2>
        </div>

        {contribution.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nobody has been in a war yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-muted-foreground border-b text-left">
                <tr>
                  <th className="py-2 pr-3 font-medium">Member</th>
                  <th className="py-2 pr-3 text-right font-medium">Wars</th>
                  <th className="py-2 pr-3 text-right font-medium">Attacks</th>
                  <th className="py-2 pr-3 text-right font-medium">Missed</th>
                  <th className="py-2 pr-3 text-right font-medium">Stars</th>
                  <th className="py-2 font-medium">On plan</th>
                </tr>
              </thead>
              <tbody>
                {contribution.map((c) => (
                  <tr key={c.playerId} className="border-b last:border-0">
                    <td className="py-2 pr-3">
                      <Link
                        className="underline-offset-2 hover:underline"
                        href={`${base}/player/${encodeURIComponent(c.tag)}`}
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.warsPlayed}</td>
                    {/* The denominator is what makes the numerator mean
                        anything: 4 attacks from 7 wars is a different
                        conversation from 4 from 2. */}
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {c.attacksUsed} of {c.attacksAvailable}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {c.attacksMissed === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className={c.attacksMissed >= 3 ? "text-destructive" : undefined}>
                          {c.attacksMissed}
                          {c.warsMissedEntirely > 0 && (
                            <span className="text-muted-foreground text-xs">
                              {" "}
                              ({c.warsMissedEntirely} war
                              {c.warsMissedEntirely === 1 ? "" : "s"} skipped)
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{c.stars}</td>
                    <td className="py-2 tabular-nums">
                      {c.targetsJudged === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        `${c.targetsFollowed} of ${c.targetsJudged}`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          Sorted by fewest missed attacks, then most stars — the order this is read
          in when picking the next lineup. A missed attack costs the war; a
          two-star instead of a three-star usually does not.
        </p>
      </section>
    </main>
  );
}

/** One war's data, for a war outside the recent window that was linked to directly. */
async function loadOne(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clanId: string,
  warId: string,
) {
  const war = await warById(supabase, clanId, warId); // R3
  if (!war) return undefined;
  return {
    war,
    members: await membersOfWar(supabase, war.id),
    attacks: await attacksForWar(supabase, war.id),
    targets: await targetsForWar(supabase, war.id),
  };
}

function Bucket({
  title,
  names,
  tone,
}: {
  title: string;
  names: string[];
  tone: "default" | "destructive" | "secondary";
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge variant={names.length === 0 ? "outline" : tone}>{names.length}</Badge>
      </div>
      {names.length === 0 ? (
        <p className="text-muted-foreground text-xs">nobody</p>
      ) : (
        <ul className="text-muted-foreground space-y-1 text-xs">
          {names.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportHeader({ clanName, base }: { clanName: string; base: string }) {
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold tracking-tight">War report</h1>
      <p className="text-muted-foreground text-sm">
        {clanName} ·{" "}
        <Link className="underline" href={`${base}/war`}>
          war board
        </Link>{" "}
        ·{" "}
        <Link className="underline" href={`${base}/war/history`}>
          history
        </Link>{" "}
        ·{" "}
        <Link className="underline" href={`${base}/war/lineup`}>
          lineup
        </Link>
      </p>
    </div>
  );
}
