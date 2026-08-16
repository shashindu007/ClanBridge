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
import { createClient } from "@/lib/supabase/server";
import {
  latestSnapshots,
  membersForClan,
  recentSnapshots,
} from "@/repositories/members";
import { clanSummaries, participation, type ClanInput } from "@/services/cross-clan";

export const dynamic = "force-dynamic";

function ratioLabel(ratio: number | null): string {
  return ratio === null ? "—" : ratio.toFixed(2);
}

/** Same rule as /roster: co-leader and above. */
function isLeadership(role: string): boolean {
  return role === "leader" || role === "co-leader";
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
      <main className="mx-auto max-w-5xl space-y-4 p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Participation</h1>
        <p className="text-muted-foreground text-sm">
          {all.length === 0
            ? // T9.10 — being in no clan yet is not a permission problem, and
              // saying "not permitted" to someone waiting to be added is both
              // wrong and discouraging.
              "You are not in any clan yet, so there is nothing to report on. A leader needs to add you to one."
            : "This report is for leaders and co-leaders. It lists every member with the reasons they were flagged, which is not a view of your own clan you are meant to have."}
        </p>
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
  const flaggedCount = rows.filter((r) => r.flags.length > 0).length;

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Participation</h1>
        <p className="text-muted-foreground text-sm">
          Every member of {clans.length === 1 ? "your clan" : `all ${clans.length} clans`}, in
          one view. Members needing a look are listed first.
        </p>
      </div>

      {rows.length === 0 ? (
        // T9.10 — clans exist but no members have synced yet. Day one of a fresh
        // install, and the fix is a sync rather than anything on this page.
        <section className="rounded-lg border p-6">
          <p className="text-muted-foreground text-sm">
            No members have been synced yet. Once <code>sync:clans</code> has run,
            everybody appears here.
          </p>
        </section>
      ) : (
        <>
          <section className="space-y-4">
            <h2 className="font-medium">By clan</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {summaries.map((clan) => (
                <div key={clan.clanId} className="space-y-2 rounded-lg border p-4">
                  <Link
                    href={`/${encodeURIComponent(clan.clanTag)}`}
                    className="font-medium hover:underline"
                  >
                    {clan.clanName}
                  </Link>
                  <dl className="text-muted-foreground space-y-1 text-sm">
                    <div className="flex justify-between">
                      <dt>Members</dt>
                      <dd className="text-foreground">{clan.members}</dd>
                    </div>
                    <div className="flex justify-between">
                      {/* Median, not mean. One member donating 40,000 drags a
                          mean far above what a typical member there is doing,
                          and the leader reads that as "this clan is fine". */}
                      <dt>Median ratio</dt>
                      <dd className="text-foreground">{ratioLabel(clan.medianRatio)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Needs a look</dt>
                      <dd className="text-foreground">{clan.needsAttention}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">Every member</h2>
              <p className="text-muted-foreground text-sm">
                {flaggedCount === 0
                  ? "Nobody is flagged."
                  : `${flaggedCount} of ${rows.length} worth a look.`}
              </p>
            </div>

            <div className="overflow-x-auto">
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
                  {rows.map((row) => (
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
                      <TableCell className="text-right text-sm">
                        {row.thLevel ?? "—"}
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
          </section>
        </>
      )}
    </main>
  );
}
