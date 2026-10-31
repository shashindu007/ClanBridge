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
import { Castle, Coins, Landmark, Medal, ShieldHalf, Swords, Target, Trophy } from "lucide-react";
import { SyncBadge } from "@/components/sync-badge";
import { Badge } from "@/components/ui/badge";
import { requireClanByTag } from "@/lib/clans";
import { isLeader } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import {
  participantsOfSeason,
  raidDefencesOfSeason,
  seasonById,
  seasonsForClan,
  type RaidSeasonRow,
} from "@/repositories/raids";
import { clanProfile, type ClanProfile } from "@/repositories/profiles";
import { latestRun } from "@/repositories/sync-log";
import { freshness } from "@/services/freshness";
import { DISPLAY_ZONE } from "@/lib/display-time";
import {
  defenceSummary,
  historyTotals,
  isOngoing,
  outstandingRaidAttacks,
  raidRecord,
  seasonTotals,
  type DefenceSummary,
} from "@/services/raids";
import { PageHeader } from "@/components/page-header";
import { Disclosure, EmptyState, FactRow, Panel } from "@/components/kit";

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
/** A dash for a number the API never sent. 0 would claim a figure nobody read. */
function compactOrDash(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : compact(n);
}

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

  const [seasons, run, profile] = await Promise.all([
    seasonsForClan(supabase, clan.id),
    latestRun(supabase, "raids", clan.id),
    // 065 — our own capital's hall and districts, from the clan sync.
    clanProfile(supabase, clan.id),
  ]);
  const fresh = freshness(run);

  // R3 — seasonById filters by clan, so a weekend id from another clan resolves
  // to nothing and falls back to ours rather than to their data.
  const season = requested
    ? ((await seasonById(supabase, clan.id, requested)) ?? seasons[0] ?? null)
    : (seasons[0] ?? null);

  // The season was resolved under the clan filter above, so its children may
  // be read by its id (R3, as repositories/raids.ts's header sets out).
  const [participants, defenceRows] = season
    ? await Promise.all([
        participantsOfSeason(supabase, season.id),
        raidDefencesOfSeason(supabase, season.id),
      ])
    : [[], []];
  const defence = defenceSummary(defenceRows);
  const record = raidRecord(participants);
  const outstanding = outstandingRaidAttacks(record);
  const totals = season ? seasonTotals(season, participants) : null;
  const history = historyTotals(seasons);

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      {/* "back to the clan" used to sit here as a link — it is the Overview tab
          one row up — and "Clan Games" and "Members" buttons closed the page,
          which are two more tabs. Gone; the tabs are the navigation. */}
      <PageHeader
        eyebrow={clan.name}
        title="Raid weekends"
        description="Clan Capital raids: medals, loot, and who still has attacks while a weekend is live."
        actions={
          <SyncBadge run={run} clanTag={clan.tag} target="raids" canAdmin={isLeader(clan.role)} />
        }
      />

      {!season ? (
        // T9.10 — distinguishing "the job has never run" from "this clan has
        // never raided" matters: a leader can act on the first and cannot on
        // the second.
        <Panel>
          <EmptyState
            icon={Castle}
            title="No raid weekends recorded"
            body={
              fresh.level === "never"
                ? "The raid sync has never run. It goes out daily once the API key is configured."
                : "The sync has run but found no raid history — normal for a clan that has not opened its Clan Capital yet. Weekends appear here within a day of the first one finishing."
            }
          />
        </Panel>
      ) : (
        <>
          {/* ── The weekend ────────────────────────────────────────────────── */}
          <section data-scene="banner" className="cb-panel space-y-4 rounded-panel border p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">
                Weekend of {when(season.startTime)}
              </h2>
              {stateBadge(season)}
            </div>

            {/* The weekend in a line of facts — the kit's FactRow, where this
                page had a third home-made style of stat row. */}
            <FactRow
              items={[
                {
                  label: "raid medals",
                  value: compactOrDash(season.offensiveReward),
                  icon: Medal,
                },
                { label: "defence medals", value: compactOrDash(season.defensiveReward), icon: ShieldHalf },
                { label: "capital loot", value: compactOrDash(season.totalLoot), icon: Coins },
                { label: "raids completed", value: season.raidsCompleted ?? "—", icon: Swords },
                { label: "districts destroyed", value: season.enemyDistrictsDestroyed ?? "—", icon: Castle },
                {
                  label: totals!.attacksOffered > 0 ? `of ${totals!.attacksOffered} attacks used` : "attacks used",
                  value: totals!.attacksUsed,
                  icon: Swords,
                },
              ]}
            />
            {/* The honest footnote. A denominator that silently drops rows
                reads as complete and is not. */}
            {totals!.unknownLimits > 0 && (
              <p className="text-muted-foreground text-xs">
                {totals!.unknownLimits} with no known attack limit, not counted in the total.
              </p>
            )}
          </section>

          {/* ── The chase list, first ──────────────────────────────────────── */}
          {outstanding.length > 0 && (
            <section className="cb-panel space-y-3 rounded-panel border p-5">
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

          {/* ── Everyone — folded once it is a long list ───────────────────── */}
          <Disclosure title="Who raided" count={record.length} defaultOpen={record.length <= 15}>

            {record.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nobody raided this weekend. The season was still recorded — the
                medals and loot are on it — but no member took an attack.
              </p>
            ) : (
              <div className="-mx-5 overflow-x-auto px-5">
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-b text-left text-xs uppercase">
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
                          {compactOrDash(r.loot)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Disclosure>

          {/* ── 065 — the other way round: who raided us ──────────────────── */}
          <CapitalDefence season={season} summary={defence} />
        </>
      )}

      {profile && profile.capitalDistricts.length > 0 && <OurCapital profile={profile} />}

      {/* ── History ────────────────────────────────────────────────────────── */}
      {seasons.length > 0 && (
        <section className="cb-panel space-y-4 rounded-panel border p-5">
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
                  aria-current={s.id === season?.id ? "page" : undefined}
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
                  {compactOrDash(s.offensiveReward)} medals
                </span>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {compactOrDash(s.totalLoot)} loot
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

    </main>
  );
}

/**
 * 065 — how enemy clans did against our capital this weekend, and which of our
 * districts fell fastest. Captured once the weekend ends (065's header), so a
 * live weekend says when it will appear instead of showing nothing.
 */
function CapitalDefence({ season, summary }: { season: RaidSeasonRow; summary: DefenceSummary }) {
  return (
    <Disclosure title="Our capital's defence" icon={ShieldHalf} count={summary.raids.length} defaultOpen={false}>
      <CapitalDefenceBody season={season} summary={summary} />
    </Disclosure>
  );
}

function CapitalDefenceBody({ season, summary }: { season: RaidSeasonRow; summary: DefenceSummary }) {
  if (isOngoing(season)) {
    return (
      <p className="text-muted-foreground text-sm">
        Shown once this weekend ends. Raids on us are still moving until then, so the numbers
        are kept only when they are final.
      </p>
    );
  }
  if (season.defensesCapturedAt === null) {
    return (
      <p className="text-muted-foreground text-sm">
        The defence log was not captured for this weekend. Weekends from before it was added
        fill in on the next raid sync, as long as the game still lists them.
      </p>
    );
  }
  if (summary.raids.length === 0) {
    return <p className="text-muted-foreground text-sm">No clan raided our capital this weekend.</p>;
  }

  const weakest = summary.districts.find((d) => d.attacksToDestroy !== null);

  return (
    <div className="space-y-5">
      {weakest && (
        <p className="text-sm">
          Weakest district: <span className="font-medium">{weakest.name ?? "Unknown"}</span>
          {weakest.hallLevel !== null && ` (level ${weakest.hallLevel})`}, destroyed in{" "}
          <span className="font-medium tabular-nums">{weakest.attacksToDestroy!.toFixed(1)}</span> attacks on
          average. The one worth upgrading first.
        </p>
      )}

      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full text-sm">
          <caption className="text-muted-foreground pb-2 text-left text-xs">
            Each district, fastest to fall first.
          </caption>
          <thead className="text-muted-foreground border-b text-left text-xs uppercase">
            <tr>
              <th className="py-2 pr-3 font-medium">District</th>
              <th className="py-2 pr-3 text-right font-medium">Destroyed</th>
              <th className="py-2 text-right font-medium">Attacks to destroy</th>
            </tr>
          </thead>
          <tbody>
            {summary.districts.map((d) => (
              <tr key={d.districtId} className="border-b last:border-0">
                <td className="py-2 pr-3">
                  {d.name ?? "Unknown"}
                  {d.hallLevel !== null && <span className="text-muted-foreground"> · level {d.hallLevel}</span>}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {d.destroyed} of {d.raids}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {d.attacksToDestroy === null ? (
                    <span className="text-success-ink">held</span>
                  ) : (
                    d.attacksToDestroy.toFixed(1)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Clans that raided us</h3>
        <ul className="divide-y">
          {summary.raids.map((r) => (
            <li key={r.raidNumber} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <span className="min-w-0 flex-1 truncate">
                {r.attackerName ?? "Unknown clan"}{" "}
                <span className="text-muted-foreground font-mono text-xs">{r.attackerTag}</span>
                {r.attackerLevel !== null && (
                  <span className="text-muted-foreground text-xs"> · level {r.attackerLevel}</span>
                )}
              </span>
              <span className="tabular-nums">
                {r.districtsDestroyed} of {r.districts} districts
              </span>
              <span className="text-muted-foreground tabular-nums">{r.stars}★</span>
              <span className="text-muted-foreground tabular-nums">{compact(r.looted)} gold taken</span>
              <Badge variant="outline">{r.attacks} attacks</Badge>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 065 — our capital as it stands now, from the clan sync: the hall and each district. */
function OurCapital({ profile }: { profile: ClanProfile }) {
  return (
    <section className="cb-panel space-y-3 rounded-panel border p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-medium">
          <Landmark aria-hidden className="text-muted-foreground size-4" />
          Our capital
        </h2>
        {profile.capitalLeague && <Badge variant="secondary">{profile.capitalLeague}</Badge>}
      </div>
      <ul className="flex flex-wrap gap-2">
        {profile.capitalDistricts.map((d) => (
          <li key={d.id} className="cb-sunken rounded-chip px-2.5 py-1 text-xs">
            {d.name ?? "District"} <span className="font-semibold tabular-nums">{d.level ?? "?"}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        District levels as of the last clan sync
        {profile.capitalHallLevel !== null && ` · Capital Hall ${profile.capitalHallLevel}`}.
      </p>
    </section>
  );
}
