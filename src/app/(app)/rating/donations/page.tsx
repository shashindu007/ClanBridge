// Season donations — a section of Player rating. Was /report, "Participation"
// (T9.1); /report now redirects here.
//
// Outside [clanTag] because it spans clans, the same reason /search is (T3B.6).
// The reads live in ../data.ts, shared with the Player rating page, so the two
// cannot disagree about who is in the season or what they gave.
//
// R3 — SPANNING CLANS IS NOT THE SAME AS NOT FILTERING BY CLAN. Every read is
// per clan, over the list visibleClans() returned (see data.ts). RLS on
// member_snapshots is auth_clan_ids(), so a member of clan A cannot read clan
// B's donations here any more than anywhere else.
//
// T3B.5 — ADVISORY ONLY. The "Worth a look" flags are reasons, never a score
// presented alone, and nothing in this system acts on them.
//
// OPEN TO EVERY MEMBER, over every clan they are in (canSeeMemberStats). This
// was leadership only (T10.8a) until the clan decided otherwise.

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
import { createClient } from "@/lib/supabase/server";
import { clanSummaries, type ParticipationRow } from "@/services/cross-clan";
import { seasonKey, type Season, type SeasonDonationReport } from "@/services/season-donations";
import { Activity, Eye, HandHeart, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Disclosure, EmptyState, FactRow, Panel, SectionHeader } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { RatingNav } from "@/components/rating-nav";
import { clanAccent } from "@/lib/clan-accent";
import { loadRatingData, seasonLabel } from "../data";

export const dynamic = "force-dynamic";

function ratioLabel(ratio: number | null): string {
  return ratio === null ? "—" : ratio.toFixed(2);
}

export default async function SeasonDonationsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const data = await loadRatingData(supabase, userId, query.season);

  if (!data) {
    return (
      <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
        <PageHeader title="Season donations" back={{ href: "/rating", label: "Player rating" }} />
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

  const { clans, rows, seasons, season, donations } = data;
  const summaries = clanSummaries(rows);

  const flagged = rows.filter((r) => r.flags.length > 0);
  const others = rows.filter((r) => r.flags.length === 0);

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Season donations"
        back={{ href: "/rating", label: "Player rating" }}
        description={`Every member of ${clans.length === 1 ? "your clan" : `all ${clans.length} of your clans`}, in one view — donations per clan and per season.`}
      />
      <RatingNav current="donations" />

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
  members: ParticipationRow[];
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
                  href={i === 0 ? "/rating/donations" : `/rating/donations?season=${encodeURIComponent(seasonKey(s))}`}
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

function MemberTable({ list }: { list: ParticipationRow[] }) {
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
