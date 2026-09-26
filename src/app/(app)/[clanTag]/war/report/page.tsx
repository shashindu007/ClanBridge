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
import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState, Panel } from "@/components/kit";
import { requireClanByTag } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import { DISPLAY_ZONE } from "@/lib/display-time";
import {
  lineupForWar,
  membersOfLineup,
  warById,
  warRostersFor,
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
      <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
        <ReportHeader clanName={clan.name} />
        <Panel>
          <EmptyState
            icon={ClipboardList}
            title="No wars to report on yet"
            body="This page compares who was picked against who played, and who was told to hit what against what they hit. Both need a finished war."
          />
        </Panel>
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

  // FOUR QUERIES, WHATEVER WAR_WINDOW IS.
  //
  // This looped the wars and issued three reads for each inside a Promise.all,
  // under a comment claiming it was "three waves regardless of N". That was true
  // of the LATENCY and false of the query count: membersOfWar() ends in its own
  // playerDetails() lookup, so N wars cost 4N statements — forty at the default
  // window — all arriving together to queue on a free-tier pooler. Overlapping
  // forty queries does not make them four.
  //
  // warRostersFor() filters each table by `war_id in (…)` once and resolves
  // every player across every war in one lookup. See its header in
  // repositories/war.ts; the player profile went the same way.
  const rosters = await warRostersFor(
    supabase,
    wars.map((war) => war.id),
  );

  // Wars with no rows are kept as empties rather than dropped: warContribution()
  // counts a war a member was absent from, so losing one would quietly improve
  // everybody's record.
  loaded.push(
    ...wars.map((war) => ({
      war,
      // warContribution() counts finished wars only; the live one is not a record yet.
      state: war.state,
      ...(rosters.get(war.id) ?? { members: [], attacks: [], targets: [] }),
    })),
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
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <ReportHeader clanName={clan.name} />

      {/* ── T6.10 ─────────────────────────────────────────────────────────── */}
      {focus && comparison && compliance && (
        <Panel className="space-y-4">
          {/* One war at a time, picked from a row that scrolls sideways rather
              than wrapping into a wall of date buttons. */}
          {wars.length > 1 && (
            <nav aria-label="Choose a war" className="cb-scroll-x -mx-5 flex gap-2 border-b px-5 pb-4">
              {wars.map((w) => (
                <Button
                  key={w.id}
                  asChild
                  size="xs"
                  variant={w.id === focus.war.id ? "default" : "outline"}
                >
                  <Link
                    href={`${base}/war/report?war=${encodeURIComponent(w.id)}`}
                    aria-current={w.id === focus.war.id ? "page" : undefined}
                  >
                    {when(w.startTime)}
                  </Link>
                </Button>
              ))}
            </nav>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
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

        </Panel>
      )}

      {/* ── T6.9 ──────────────────────────────────────────────────────────── */}
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
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
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="text-muted-foreground border-b text-left text-xs uppercase">
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
      </Panel>
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

  // Three SEQUENTIAL awaits before — one round trip each, for three reads that
  // never depended on one another. warRostersFor() takes a list of one and does
  // them together, so this is the same four-query shape the main list uses
  // rather than a second way of loading the same thing.
  const rosters = await warRostersFor(supabase, [war.id]);
  return {
    war,
    ...(rosters.get(war.id) ?? { members: [], attacks: [], targets: [] }),
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

/**
 * The page's title. It used to carry "war board · history · lineup" as dotted
 * links, which is the War tab row directly above it, word for word.
 */
function ReportHeader({ clanName }: { clanName: string }) {
  return (
    <PageHeader
      eyebrow={clanName}
      title="War report"
      description="Who was picked against who played, who was told to hit what against what they hit, and each member's record over recent wars."
    />
  );
}
