// Player rating — every member of the viewer's clans, ranked.
//
// PHASE ONE: THE RANKING IS DONATIONS ALONE. Most given this season, from the
// same season calculation as Season donations (../data.ts), so the two pages
// cannot disagree. The full rating formula — war, CWL, Clan Games and raids
// weighed together — arrives phase by phase; each has its own button below and
// a placeholder page until then. CWL is built (./cwl) and has its own ranking;
// it is not weighed into this one yet.
//
// Open to every member, over their own clans. See data.ts for R3.

import Link from "next/link";
import { redirect } from "next/navigation";
import { Trophy, Users } from "lucide-react";
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
import { clanAccent } from "@/lib/clan-accent";
import { PageHeader } from "@/components/page-header";
import { EmptyState, Panel, SectionHeader } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { RatingNav } from "@/components/rating-nav";
import { loadRatingData, seasonLabel } from "./data";

export const dynamic = "force-dynamic";

/** Gold, silver, bronze for the top three; the rest are plain numbers. */
const MEDAL = ["#f5c542", "#c0c7d1", "#cd8a4b"];

export default async function PlayerRatingPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const data = await loadRatingData(supabase, userId);

  if (!data) {
    return (
      <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
        <PageHeader title="Player rating" />
        <Panel>
          <EmptyState
            icon={Trophy}
            title="You are not in a clan yet"
            body="There is nothing to rate until a leader adds you to a clan."
          />
        </Panel>
      </main>
    );
  }

  const { rows, season, donations } = data;
  const given = new Map(donations.rows.map((r) => [r.playerId, r]));

  // Every current member, most given first. A member with no reading this
  // season goes last as "—" rather than 0, which would read as a real nothing.
  const ranked = rows
    .map((member) => ({ member, season: given.get(member.playerId) ?? null }))
    .sort(
      (a, b) =>
        (b.season?.total ?? -1) - (a.season?.total ?? -1) ||
        a.member.name.localeCompare(b.member.name),
    );

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Player rating"
        description="Every member of your clans, ranked. For now this ranking is donations this season; CWL has its own rating, and war, Clan Games and raids join phase by phase."
      />
      <RatingNav />

      <Panel aria-labelledby="ranking-title" className="space-y-4">
        <div className="space-y-1">
          <SectionHeader id="ranking-title" title="Most donations" icon={Trophy} count={ranked.length} />
          <p className="text-muted-foreground text-sm">{seasonLabel(season)}</p>
        </div>

        {ranked.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No members synced yet"
            body="Once sync:clans has run, everybody appears here."
          />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <Table className="cb-stack">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Clan</TableHead>
                  <TableHead className="text-right">TH</TableHead>
                  <TableHead className="text-right">Donated</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ranked.map(({ member, season: s }, i) => {
                  const rank = s ? i + 1 : null;
                  return (
                    <TableRow key={member.playerId}>
                      <TableCell data-cell="corner" className="text-right">
                        {rank !== null && rank <= 3 ? (
                          <span
                            className="inline-flex size-7 items-center justify-center rounded-full text-sm font-bold text-black"
                            style={{ background: MEDAL[rank - 1] }}
                          >
                            {rank}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm tabular-nums">
                            {rank ?? "—"}
                          </span>
                        )}
                      </TableCell>
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
                      <TableCell data-label="Clan">
                        <span className="flex items-center gap-2 text-sm">
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: clanAccent(member.clanId).color }}
                          />
                          <span className="text-muted-foreground">{member.clanName}</span>
                        </span>
                      </TableCell>
                      <TableCell data-label="TH" className="text-right">
                        <TownHall level={member.thLevel} />
                      </TableCell>
                      <TableCell data-label="Donated" className="text-right font-medium tabular-nums">
                        {s ? s.total.toLocaleString("en-GB") : "—"}
                      </TableCell>
                      <TableCell data-label="Received" className="text-right text-sm tabular-nums">
                        {s ? s.received.toLocaleString("en-GB") : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          Donated is the season total across every clan a member was in, as on{" "}
          <Link href="/rating/donations" className="underline">
            Season donations
          </Link>
          , where the split per clan is shown. The full rating formula comes in later phases.
        </p>
      </Panel>
    </main>
  );
}
