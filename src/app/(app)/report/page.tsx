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
// T10.8a — LEADERSHIP ONLY, and it is checked here rather than assumed.
//
// This page previously had no role check at all. The nav link in (app)/layout.tsx
// is rendered only for a leader or co-leader, and that hiding was the whole of
// the protection — so any approved member who typed the URL got a list of
// everyone in their clan with the reasons each was flagged. RLS still scoped it
// to their own clans, so nothing crossed a clan boundary, but a member reading
// which of their clanmates are "worth a look" is precisely what the link's own
// comment says this page is not for.
//
// A hidden link is not an access control. /roster and /admin/audit both filter
// by role in the page; this now does the same.

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
import { isLeadership } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import {
  latestSnapshots,
  membersForClan,
  recentSnapshots,
} from "@/repositories/members";
import { clanSummaries, participation, type ClanInput } from "@/services/cross-clan";
import { Activity, Eye, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Disclosure, EmptyState, FactRow, Panel, SectionHeader } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { clanAccent } from "@/lib/clan-accent";

export const dynamic = "force-dynamic";

function ratioLabel(ratio: number | null): string {
  return ratio === null ? "—" : ratio.toFixed(2);
}

export default async function CrossClanReportPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const all = await visibleClans(supabase, userId);

  // T10.8a — the report covers only the clans this member LEADS, not every clan
  // they are in. Filtering rather than refusing outright is the right shape: a
  // co-leader of one clan and an ordinary member of another should see the first
  // and not the second, and an all-or-nothing check would give them both or
  // neither.
  const clans = all.filter((c) => isLeadership(c.role));

  if (clans.length === 0) {
    return (
      <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
        <PageHeader title="Participation" />
        <Panel>
          <EmptyState
            icon={Activity}
            title={all.length === 0 ? "You are not in a clan yet" : "For leaders and co-leaders"}
            body={
              all.length === 0
                ? // T9.10 — being in no clan yet is not a permission problem, and
                  // saying "not permitted" to someone waiting to be added is both
                  // wrong and discouraging.
                  "There is nothing to report on until a leader adds you to a clan."
                : "This report lists every member with the reasons they were flagged, which is not a view of your own clan you are meant to have."
            }
          />
        </Panel>
      </main>
    );
  }

  // One set of reads per clan, issued together. Three clans is six queries; in
  // sequence that is six round trips to a free-tier database in another region,
  // which is most of a second of nothing happening.
  const inputs: ClanInput[] = await Promise.all(
    clans.map(async (clan): Promise<ClanInput> => {
      const members = await membersForClan(supabase, clan.id);
      const [latest, recent] = await Promise.all([
        latestSnapshots(supabase, clan.id, members.length),
        recentSnapshots(supabase, clan.id),
      ]);
      return {
        clanId: clan.id,
        clanTag: clan.tag,
        clanName: clan.name,
        members,
        latest,
        history: recent.byPlayer,
      };
    }),
  );

  const rows = participation(inputs);
  const summaries = clanSummaries(rows);

  const flagged = rows.filter((r) => r.flags.length > 0);
  const others = rows.filter((r) => r.flags.length === 0);

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Participation"
        description={`Every member of ${clans.length === 1 ? "your clan" : `all ${clans.length} clans you help run`}, in one view — the ones worth a look first.`}
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

          {/* Flagged members were SORTED first in one long table; now they are
              their own section, open, and everyone else folds beneath. */}
          <Disclosure title="Worth a look" icon={Eye} count={flagged.length} defaultOpen>
            {flagged.length === 0 ? (
              <p className="text-muted-foreground text-sm">Nobody is flagged.</p>
            ) : (
              <MemberTable list={flagged} />
            )}
          </Disclosure>

          {others.length > 0 && (
            <Disclosure title="Everyone else" icon={Users} count={others.length}>
              <MemberTable list={others} />
            </Disclosure>
          )}
        </>
      )}
    </main>
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
