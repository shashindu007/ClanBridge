// T9.1 — Cross-clan participation report. Objective O3.
//
// Outside [clanTag] because it spans clans, the same reason /search is (T3B.6).
// One leader runs all three; the question they actually ask is never "how is
// clan A doing" but "who across all of it has stopped turning up", and the
// alternative to this page is three tabs and mental arithmetic.
//
// R3 — SPANNING CLANS IS NOT THE SAME AS NOT FILTERING BY CLAN. Every read below
// is per clan, over the list visibleClans() returned. Nothing queries players or
// member_snapshots unscoped and leans on RLS to sort it out afterwards; RLS is
// the net underneath, not the plan. test/authorisation.test.ts asserts the net
// holds anyway, because both are meant to be true.
//
// T3B.5 — ADVISORY ONLY. The flags here are reasons, never a score presented
// alone, and nothing in this system acts on them. A member on holiday and a
// member who has quit are identical from this data.
//
// OPEN TO EVERY MEMBER, over every clan they are in. This was leadership only
// (T10.8a); the clan decided participation is everybody's business, so the role
// filter is now canSeeMemberStats() — the same tier that already shows a member
// donations and ratios in their own clan's directory.
//
// It is still per clan, and still only the viewer's clans. RLS on
// member_snapshots is auth_clan_ids(), so a member of clan A cannot read clan
// B's donations here any more than anywhere else. Showing the whole family to
// everyone would need a 038-style security-definer function, not a looser
// filter in this file.

import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { currentUserId } from "@/lib/auth";
import { visibleClans } from "@/lib/clans";
import { canSeeMemberStats } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import { lastActivity, latestSnapshots, membersForClan } from "@/repositories/members";
import { clanSummaries, participation, type ClanInput } from "@/services/cross-clan";
import {
  SEGMENT_WINDOW_DAYS,
  donationReadings,
  donationSegments,
} from "@/repositories/season-donations";
import {
  seasonDonations,
  seasonResets,
  seasonKey,
  seasonsFrom,
  type Season,
  type SeasonDonationReport,
} from "@/services/season-donations";
import { formatDisplay } from "@/lib/display-time";
import { Activity, Eye, HandHeart, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Disclosure, EmptyState, FactRow, Panel, SectionHeader } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { clanAccent } from "@/lib/clan-accent";

export const dynamic = "force-dynamic";

function ratioLabel(ratio: number | null): string {
  return ratio === null ? "—" : ratio.toFixed(2);
}

const DAY = 86_400_000;

export default async function CrossClanReportPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  // Every clan this account is a member of, whatever its role there. Stated as a
  // predicate rather than left unfiltered, so the decision is visible here.
  const clans = (await visibleClans(supabase, userId)).filter((c) =>
    canSeeMemberStats(c.role),
  );

  if (clans.length === 0) {
    return (
      <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
        <PageHeader title="Participation" />
        <Panel>
          {/* T9.10 — being in no clan yet is not a permission problem, and saying
              "not permitted" to someone waiting to be added is both wrong and
              discouraging. */}
          <EmptyState
            icon={Activity}
            title="You are not in a clan yet"
            body="There is nothing to report on until a leader adds you to a clan."
          />
        </Panel>
      </main>
    );
  }

  const clanIds = clans.map((c) => c.id);
  const now = Date.now();

  // One set of reads per clan, issued together. Three clans is six queries; in
  // sequence that is six round trips to a free-tier database in another region,
  // which is most of a second of nothing happening. The season stays ride along.
  const [inputs, segments] = await Promise.all([
    Promise.all(clans.map(async (clan): Promise<ClanInput> => {
      const members = await membersForClan(supabase, clan.id);
      const [latest, activity] = await Promise.all([
        latestSnapshots(supabase, clan.id, members.length),
        lastActivity(supabase, clan.id),
      ]);
      return {
        clanId: clan.id,
        clanTag: clan.tag,
        clanName: clan.name,
        members,
        latest,
        lastActivity: activity.byPlayer,
      };
    })),
    donationSegments(supabase, clanIds, new Date(now - SEGMENT_WINDOW_DAYS * DAY)),
  ]);

  // 052 — the season is picked from resets found in the data, never a calendar.
  // An unknown ?season= falls back to the running one rather than an error.
  const seasons = seasonsFrom(seasonResets(segments));
  const season = seasons.find((s) => seasonKey(s) === query.season) ?? seasons[0]!;
  // The readings a season needs: its own, a few days before (a stay straddling
  // its start), and ten after (last month's missed tail is found through the
  // next stay's first reading).
  const readings = await donationReadings(
    supabase,
    clanIds,
    new Date(season.start ? Date.parse(season.start) - 3 * DAY : now - SEGMENT_WINDOW_DAYS * DAY),
    new Date(season.end ? Date.parse(season.end) + 10 * DAY : now + DAY),
  );
  const donations = seasonDonations(segments, readings, season);

  const rows = participation(inputs);
  const summaries = clanSummaries(rows);

  const flagged = rows.filter((r) => r.flags.length > 0);
  const others = rows.filter((r) => r.flags.length === 0);

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Participation"
        description={`Every member of ${clans.length === 1 ? "your clan" : `all ${clans.length} of your clans`}, in one view — donations per clan and per season.`}
      />

      {rows.length === 0 ? (
        // T9.10 — clans exist but no members have synced yet. Day one of a fresh
        // install, and the fix is a sync rather than anything on this page.
        <Panel>
          <EmptyState
            icon={Users}
            title="No members synced yet"
            body="Once sync:clans has run, everybody appears here."
          />
        </Panel>
      ) : (
        <>
          {/* One line per clan. They were cards of three tiny numbers each,
              laid out like a dashboard of their own. */}
          <Panel aria-labelledby="by-clan" className="space-y-3">
            <SectionHeader id="by-clan" title="By clan" />
            <ul className="divide-y">
              {summaries.map((clan) => (
                <li key={clan.clanId} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-2.5 first:pt-0 last:pb-0">
                  <Link
                    href={`/${encodeURIComponent(clan.clanTag)}`}
                    className="flex min-w-40 items-center gap-2 font-medium hover:underline"
                  >
                    <span
                      aria-hidden
                      className="size-2.5 rounded-full"
                      style={{ background: clanAccent(clan.clanId).color }}
                    />
                    {clan.clanName}
                  </Link>
                  <FactRow
                    items={[
                      { label: "members", value: clan.members },
                      // Median, not mean. One member donating 40,000 drags a mean
                      // far above what a typical member there is doing.
                      { label: "median ratio", value: ratioLabel(clan.medianRatio) },
                      { label: "worth a look", value: clan.needsAttention },
                    ]}
                  />
                </li>
              ))}
            </ul>
          </Panel>

          <SeasonDonations
            report={donations}
            seasons={seasons}
            season={season}
            members={rows}
            clanNames={new Map(clans.map((c) => [c.id, c.name]))}
          />

          {/* Season donations lead now; the flag lists are the page's footnote,
              folded at the bottom, for whoever goes looking. */}
          {others.length > 0 && (
            <Disclosure title="Everyone else" icon={Users} count={others.length}>
              <MemberTable list={others} />
            </Disclosure>
          )}

          <Disclosure title="Worth a look" icon={Eye} count={flagged.length}>
            {flagged.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nobody is flagged.</p>
            ) : (
              <MemberTable list={flagged} />
            )}
          </Disclosure>
        </>
      )}
    </main>
  );
}

function seasonLabel(season: Season): string {
  // Before the first reset we saw: our readings began partway through it.
  if (season.start === null && season.end !== null) {
    return `Before ${formatDisplay(season.end, "date")} (partial)`;
  }
  if (season.start === null) return "So far";
  if (season.end === null) return `Current season (since ${formatDisplay(season.start, "date")})`;
  return `${formatDisplay(season.start, "date")} – ${formatDisplay(season.end, "date")}`;
}

/**
 * 052 — each member's season, per clan, with what the lifetime achievements add.
 *
 * Current members only, like the rest of the page. "Other clans" is everything
 * the achievements saw that no clan counter HERE accounts for — a clan outside
 * the family, a family clan this viewer is not in, or the hour before leaving —
 * and it is shown apart because a ranking weighs it differently.
 */
function SeasonDonations({
  report,
  seasons,
  season,
  members,
  clanNames,
}: {
  report: SeasonDonationReport;
  seasons: Season[];
  season: Season;
  members: ReturnType<typeof participation>;
  clanNames: Map<string, string>;
}) {
  const byId = new Map(members.map((m) => [m.playerId, m]));
  const list = report.rows.filter((r) => byId.has(r.playerId));
  const { check } = report;

  return (
    <Disclosure title="Season donations" icon={HandHeart} count={list.length} defaultOpen>
      <div className="space-y-4">
        {seasons.length > 1 && (
          <nav aria-label="Season" className="flex flex-wrap gap-2">
            {seasons.map((s, i) => {
              const active = s === season;
              return (
                <Link
                  key={seasonKey(s)}
                  // The running season is the page's default, so it has no parameter.
                  href={i === 0 ? "/report" : `/report?season=${encodeURIComponent(seasonKey(s))}`}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "bg-primary text-primary-foreground rounded-control px-3 py-1 text-sm"
                      : "hover:bg-accent rounded-control border px-3 py-1 text-sm"
                  }
                >
                  {seasonLabel(s)}
                </Link>
              );
            })}
          </nav>
        )}
        {seasons.length === 1 && (
          <p className="text-muted-foreground text-sm">{seasonLabel(season)}</p>
        )}

        {list.length === 0 ? (
          <p className="text-muted-foreground text-sm">No donation readings for this season yet.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>In each clan</TableHead>
                  <TableHead className="text-right">Other clans</TableHead>
                  <TableHead className="text-right">Total given</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((row) => {
                  const member = byId.get(row.playerId)!;
                  return (
                    <TableRow key={row.playerId}>
                      <TableCell>
                        <Link
                          href={`/${encodeURIComponent(member.clanTag)}/player/${encodeURIComponent(member.tag)}`}
                          className="font-medium hover:underline"
                        >
                          {member.name}
                        </Link>
                        <span className="text-muted-foreground block font-mono text-xs">
                          {member.tag}
                        </span>
                      </TableCell>
                      <TableCell>
                        <ul className="space-y-0.5 text-sm">
                          {row.byClan.map((s) => (
                            <li key={s.clanId} className="flex items-center gap-2">
                              <span
                                aria-hidden
                                className="size-2 shrink-0 rounded-full"
                                style={{ background: clanAccent(s.clanId).color }}
                              />
                              <span className="text-muted-foreground">{clanNames.get(s.clanId)}</span>
                              <span className="tabular-nums">{s.given.toLocaleString("en-GB")}</span>
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {/* "—", not 0: no usable lifetime reading is not the
                            same as having given nothing elsewhere. */}
                        {row.other === null ? "—" : row.other.toLocaleString("en-GB")}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {row.total.toLocaleString("en-GB")}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {row.received.toLocaleString("en-GB")}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          Each clan&apos;s figure survives a move between clans. &ldquo;Other clans&rdquo; is what the
          lifetime donation achievements saw beyond that: a clan outside the family, one of ours you
          are not in, or the last hour before leaving.{" "}
          {season.start === null && season.end !== null
            ? "This season began before our readings did, so it shows only what was given after they started. "
            : ""}
          {check.checked === 0
            ? "Lifetime counters are still being collected — the first check needs two daily readings in the same clan."
            : `Counter check: ${check.consistent} of ${check.checked} stays matched exactly (${check.formula}).`}
        </p>
      </div>
    </Disclosure>
  );
}

function MemberTable({ list }: { list: ReturnType<typeof participation> }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Clan</TableHead>
            <TableHead className="text-right">TH</TableHead>
            <TableHead className="text-right">Given</TableHead>
            <TableHead className="text-right">Ratio</TableHead>
            <TableHead>Needs a look</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {list.map((row) => (
            <TableRow key={row.playerId}>
              <TableCell>
                <Link
                  href={`/${encodeURIComponent(row.clanTag)}/player/${encodeURIComponent(row.tag)}`}
                  className="font-medium hover:underline"
                >
                  {row.name}
                </Link>
                <span className="text-muted-foreground block font-mono text-xs">
                  {row.tag}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {row.clanName}
              </TableCell>
              <TableCell className="text-right">
                <TownHall level={row.thLevel} />
              </TableCell>
              <TableCell className="text-right text-sm">
                {/* "—" rather than 0: a member the sync has not reached
                    has no reading, and a zero there is indistinguishable
                    from genuinely having donated nothing. */}
                {row.activity.donations ?? "—"}
              </TableCell>
              <TableCell className="text-right text-sm">
                {row.activity.lowRatio ? (
                  <Badge variant="destructive">
                    {ratioLabel(row.activity.ratio)}
                  </Badge>
                ) : (
                  ratioLabel(row.activity.ratio)
                )}
              </TableCell>
              <TableCell>
                {row.flags.length === 0 ? (
                  <span className="text-muted-foreground text-sm">—</span>
                ) : (
                  // The reasons in full, never a bare score. A leader who
                  // cannot see why somebody was flagged cannot defend the
                  // decision to them.
                  <ul className="space-y-1">
                    {row.flags.map((flag) => (
                      <li key={flag} className="text-sm">
                        {flag}
                      </li>
                    ))}
                  </ul>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
