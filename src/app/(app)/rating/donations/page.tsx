// Season donations — a section of Player rating. Was /report, "Participation"
// (T9.1); /report now redirects here.
//
// Outside [clanTag] because it spans clans, the same reason /search is (T3B.6).
// The reads live in ../data.ts.
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
//
// THE RANKING ON TOP is the stored family rating's donations section, the same
// numbers as Overall's Donations column (../family-board.tsx), with ?month and
// ?clan like every other section. The season report under it is what the
// marks come from, in donations rather than marks, and keeps its ?season.

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
import { DONATION_MARKS } from "@/services/player-rating";
import { signed2 } from "@/services/raid-rating";
import { seasonKey, type Season, type SeasonDonationReport } from "@/services/season-donations";
import { Activity, Eye, HandHeart, Users } from "lucide-react";
import { Disclosure, EmptyState, FactRow, Panel, SectionHeader } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { RankDock } from "@/components/rank-dock";
import { Choice, Leaderboard, Podium, RatingToolbar, podiumRows, topOf } from "@/components/rating-board";
import { RatingShell } from "@/components/rating-shell";
import { clanAccent } from "@/lib/clan-accent";
import { rankRows, ratingPercent } from "@/lib/rating";
import { seasonLabel as monthLabel } from "@/lib/roster-view";
import type { RatedPlayer } from "@/repositories/player-ratings";
import { loadRatingData, seasonLabel } from "../data";
import { clanChoices, dockEntries, familyClans, familyRow, loadFamily } from "../family-board";

const TITLE = "Donations";

export const dynamic = "force-dynamic";

function ratioLabel(ratio: number | null): string {
  return ratio === null ? "—" : ratio.toFixed(2);
}

export default async function SeasonDonationsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string; month?: string; clan?: string }>;
}) {
  const query = await searchParams;
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const [data, family] = await Promise.all([
    loadRatingData(supabase, userId, query.season),
    loadFamily(query.month),
  ]);

  if (!data) {
    return (
      <RatingShell title={TITLE}>
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
      </RatingShell>
    );
  }

  const { clans, rows, seasons, season, donations } = data;
  const summaries = clanSummaries(rows);

  const flagged = rows.filter((r) => r.flags.length > 0);
  const others = rows.filter((r) => r.flags.length === 0);

  const board = family.kind === "ok" ? donationBoard(family, query) : null;

  return (
    <RatingShell
      title={TITLE}
      description={`Who gave most in the family, then every member of ${clans.length === 1 ? "your clan" : `all ${clans.length} of your clans`} by clan and by season.`}
      dock={board && board.dock.length > 0 && <RankDock title={`Donations, ${monthLabel(board.month)}`} entries={board.dock} />}
    >
      {board?.panel}

      {rows.length === 0 ? (
        // T9.10 — clans exist but no members have synced yet. Day one of a fresh
        // install, and the fix is a sync rather than anything on this page.
        <Panel>
          <EmptyState
            icon={Users}
            title="No members synced yet"
            body="Everybody appears here after the next sync."
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
    </RatingShell>
  );
}

/**
 * The donations ranking: the stored family rating's donations share, sorted,
 * with ties sharing a place. Medals only for a place with marks behind it.
 */
function donationBoard(
  family: Extract<Awaited<ReturnType<typeof loadFamily>>, { kind: "ok" }>,
  query: { season?: string; month?: string; clan?: string },
) {
  const { months, month, everyone, ownIds, mine, isOpen } = family;
  const clans = familyClans(everyone);
  const only = clans.find((c) => c.tag === query.clan) ?? null;

  const order = (a: RatedPlayer, b: RatedPlayer) =>
    b.shares.donations - a.shares.donations || b.marks.donations - a.marks.donations;
  const sorted = [...everyone].sort((a, b) => order(a, b) || a.name.localeCompare(b.name));
  const familyPlaces = new Map(rankRows(sorted, (a, b) => order(a, b) === 0).map((r) => [r.item.playerId, r]));
  const clanPlaces = new Map<string, { place: number; size: number }>();
  for (const clan of clans) {
    const inClan = sorted.filter((p) => p.clanId === clan.id);
    for (const r of rankRows(inClan, (a, b) => order(a, b) === 0)) {
      clanPlaces.set(r.item.playerId, { place: r.rank, size: inClan.length });
    }
  }

  const here = (next: { clan?: string | null; month?: string }) => {
    const search = new URLSearchParams();
    const m = next.month ?? month;
    const c = next.clan === undefined ? (only?.tag ?? null) : next.clan;
    if (m !== months[0]) search.set("month", m);
    if (c) search.set("clan", c);
    if (query.season) search.set("season", query.season);
    const text = search.toString();
    return text ? `/rating/donations?${text}` : "/rating/donations";
  };

  const toRow = (p: RatedPlayer) => {
    const place = familyPlaces.get(p.playerId)!;
    const marks = p.marks.donations;
    return familyRow(p, {
      rank: place.rank,
      tied: place.tied,
      medal: marks > 0,
      oneClan: only ? (clanPlaces.get(p.playerId) ?? null) : null,
      mine,
      ownIds,
      rating: { text: ratingPercent(p.shares.donations), value: p.shares.donations },
      cells: {
        marks: <span className={marks < 0 ? "text-destructive" : undefined}>{signed2(marks)}</span>,
      },
    });
  };

  const rows = sorted.filter((p) => !only || p.clanId === only.id).map(toRow);
  const dock = dockEntries(
    sorted.filter((p) => ownIds.has(p.playerId)).map(toRow),
    (row) => {
      const p = everyone.find((q) => q.playerId === row.key)!;
      const inClan = clanPlaces.get(p.playerId);
      const clanPart = inClan ? ` · #${inClan.place} of ${inClan.size} in ${p.clanName}` : "";
      return `#${row.rank} of ${everyone.length} in the family${row.tied ? ", tied" : ""}${clanPart}`;
    },
    (row) => `${here({ clan: null })}#${row.anchorId}`,
  );

  const panel = (
    <Panel aria-labelledby="donation-ranking" className="space-y-4">
      <div className="space-y-1">
        <SectionHeader
          id="donation-ranking"
          title={`${monthLabel(month)}${isOpen ? ", so far" : ", final"}`}
          icon={HandHeart}
          count={rows.length}
        />
        <p className="text-muted-foreground text-sm">
          Each player&apos;s share of the whole family&apos;s donation marks, as in the Overall
          ranking, with the marks beside it.
        </p>
      </div>
      <RatingToolbar
        months={months.map((m) => ({ href: here({ month: m }), label: monthLabel(m), active: m === month }))}
        clans={clanChoices(clans, everyone.length, only, (tag) => here({ clan: tag }))}
      />
      <Podium rows={podiumRows(rows)} />
      {rows.length === 0 ? (
        <EmptyState
          icon={HandHeart}
          title="Nothing to rank yet"
          body="Donation marks appear after the next rating update."
        />
      ) : (
        <Leaderboard
          rows={rows}
          columns={[{ key: "marks", label: "Marks", title: "Donation marks this month" }]}
          ratingLabel="Share"
          ratingTitle="Share of the family's donation marks"
          ratingTop={topOf(everyone.map((p) => p.shares.donations))}
          showClan={!only}
        />
      )}
    </Panel>
  );

  return { month, panel, dock };
}

/**
 * 052 — each member's season, per clan, with what the lifetime achievements add.
 *
 * Current members only, like the rest of the page. "Other clans" is everything
 * the achievements saw that no clan counter HERE accounts for — a clan outside
 * the family, a family clan this viewer is not in, or the hour before leaving —
 * and it is shown apart because the Player rating weighs it differently.
 *
 * Marks are not shown per player here. That rating is worked out over the whole
 * family, where a family clan this viewer is not in is not "other" at all, so a
 * figure from this report could disagree with /rating.
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
          <nav aria-label="Season" className="cb-segment cb-scroll-x flex max-w-full gap-1 [&>*]:shrink-0">
            {seasons.map((s, i) => (
              <Choice
                key={seasonKey(s)}
                // The running season is the page's default, so it has no parameter.
                href={i === 0 ? "/rating/donations" : `/rating/donations?season=${encodeURIComponent(seasonKey(s))}`}
                active={s === season}
                label={seasonLabel(s)}
              />
            ))}
          </nav>
        )}
        {seasons.length === 1 && (
          <p className="text-muted-foreground text-sm">{seasonLabel(season)}</p>
        )}

        {list.length === 0 ? (
          <p className="text-muted-foreground text-sm">No donation readings for this season yet.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <Table className="cb-stack">
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
                      <TableCell data-cell="title">
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
                      <TableCell data-cell="wide" data-label="In each clan">
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
                      <TableCell data-label="Other clans" className="text-right text-sm tabular-nums">
                        {/* "—", not 0: no usable lifetime reading is not the
                            same as having given nothing elsewhere. */}
                        {row.other === null ? "—" : row.other.toLocaleString("en-GB")}
                      </TableCell>
                      <TableCell data-label="Total given" className="text-right font-medium tabular-nums">
                        {row.total.toLocaleString("en-GB")}
                      </TableCell>
                      <TableCell data-label="Received" className="text-right text-sm tabular-nums">
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

        <p className="text-muted-foreground text-xs">
          In the{" "}
          <Link href="/rating" className="underline">
            Overall ranking
          </Link>
          , every {DONATION_MARKS.given.per.toLocaleString("en-GB")} donated in the family is{" "}
          {signed2(DONATION_MARKS.given.marks)} mark, every{" "}
          {DONATION_MARKS.received.per.toLocaleString("en-GB")} received is{" "}
          {signed2(DONATION_MARKS.received.marks)}, and every{" "}
          {DONATION_MARKS.other.per.toLocaleString("en-GB")} donated in other clans is{" "}
          {signed2(DONATION_MARKS.other.marks)}.
        </p>
      </div>
    </Disclosure>
  );
}

function MemberTable({ list }: { list: ParticipationRow[] }) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <Table className="cb-stack">
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
              <TableCell data-cell="title">
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
              <TableCell data-label="Clan" className="text-muted-foreground text-sm">
                {row.clanName}
              </TableCell>
              <TableCell data-label="TH" className="text-right">
                <TownHall level={row.thLevel} />
              </TableCell>
              <TableCell data-label="Given" className="text-right text-sm">
                {/* "—" rather than 0: a member the sync has not reached
                    has no reading, and a zero there is indistinguishable
                    from genuinely having donated nothing. */}
                {row.activity.donations ?? "—"}
              </TableCell>
              <TableCell data-label="Ratio" className="text-right text-sm">
                {row.activity.lowRatio ? (
                  <Badge variant="destructive">
                    {ratioLabel(row.activity.ratio)}
                  </Badge>
                ) : (
                  ratioLabel(row.activity.ratio)
                )}
              </TableCell>
              <TableCell data-cell="wide" data-label="Needs a look">
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
