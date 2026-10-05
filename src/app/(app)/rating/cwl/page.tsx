// CWL rating — a section of Player rating: every player of the viewer's clans
// in the latest CWL month, in one ranking.
//
// The rating itself is one clan's season worked out by services/cwl-rating.ts,
// exactly as on that season's own Rating tab; this page lays the clans' tables
// side by side. A share is always of a player's OWN clan's marks for the day,
// so the ranking compares how much of their clan's result each player carried.
//
// THE LATEST MONTH ONLY. The rating is about the CWL being played, or the one
// just finished; an older month is on its own season page, where its days are.
//
// Outside [clanTag] because it spans clans, like Season donations beside it.
//
// R3 — spanning clans is not the same as not filtering by clan. Each season is
// resolved under its own clan (seasonsForClan), over the list visibleClans()
// returned, and every read below hangs off that season's id. RLS on the CWL
// tables is auth_clan_ids(), so a member of clan A reads nothing of clan B here.

import Link from "next/link";
import { redirect } from "next/navigation";
import { Medal } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { currentUserId } from "@/lib/auth";
import { clanAccent } from "@/lib/clan-accent";
import { visibleClans } from "@/lib/clans";
import { loadSeasonBoards, loadSeasonView, ratingFor } from "@/lib/cwl-season";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { canSeeMemberStats } from "@/lib/visibility";
import { PageHeader } from "@/components/page-header";
import { EmptyState, Panel, SectionHeader } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { RatingNav } from "@/components/rating-nav";
import { seasonsForClan } from "@/repositories/cwl";
import { oneDecimal, signed } from "@/services/cwl-rating";

export const dynamic = "force-dynamic";

/** Gold, silver, bronze for the top three, as on Player rating. */
const MEDAL = ["#f5c542", "#c0c7d1", "#cd8a4b"];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="CWL rating"
        back={{ href: "/rating", label: "Player rating" }}
        description="Every player of your clans in this month's Clan War League, rated on attack and defence."
      />
      <RatingNav current="cwl" />
      {children}
    </main>
  );
}

export default async function CwlRatingPage() {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clans = (await visibleClans(supabase, userId)).filter((c) => canSeeMemberStats(c.role));
  if (clans.length === 0) {
    return (
      <Shell>
        <Panel>
          <EmptyState
            icon={Medal}
            title="You are not in a clan yet"
            body="There is nothing to rate until a leader adds you to a clan."
          />
        </Panel>
      </Shell>
    );
  }

  // The latest CWL month any of these clans has, and the clans that played it.
  const seasonLists = await Promise.all(clans.map((clan) => seasonsForClan(supabase, clan.id)));
  const month = seasonLists.flatMap((list) => list.map((s) => s.season)).sort().at(-1) ?? null;
  if (!month) {
    return (
      <Shell>
        <Panel>
          <EmptyState
            icon={Medal}
            title="No CWL recorded yet"
            body="The rating appears with the first Clan War League week the sync captures."
          />
        </Panel>
      </Shell>
    );
  }

  const played = clans.flatMap((clan, index) => {
    const season = seasonLists[index]!.find((s) => s.season === month);
    return season ? [{ clan, season }] : [];
  });
  const ratings = await Promise.all(
    played.map(async ({ clan, season }) => {
      const view = await loadSeasonView(supabase, clan, season, { withPlayers: true });
      const boards = await loadSeasonBoards(supabase, clan, view);
      return { clan, rating: ratingFor(view, boards) };
    }),
  );

  const started = ratings.some((r) => r.rating.started);
  const running = ratings.some((r) => r.rating.days.some((d) => d.status === "provisional"));
  const rows = ratings
    .flatMap(({ clan, rating }) => rating.players.map((player) => ({ clan, player })))
    // Until a day has finished there is only the running day to go on.
    .filter(({ player }) => started || player.provisional)
    .sort(
      (a, b) =>
        b.player.rating - a.player.rating ||
        b.player.marks - a.player.marks ||
        (b.player.provisional?.share ?? 0) - (a.player.provisional?.share ?? 0) ||
        a.player.name.localeCompare(b.player.name),
    );
  const monthHref = (clanTag: string) =>
    `/${encodeURIComponent(clanTag)}/cwl/${encodeURIComponent(month)}/rating`;

  return (
    <Shell>
      <Panel aria-labelledby="cwl-rating-title" className="space-y-4">
        <div className="space-y-1">
          <SectionHeader
            id="cwl-rating-title"
            title={`CWL ${seasonLabel(month)}`}
            icon={Medal}
            count={rows.length}
          />
          <p className="text-muted-foreground text-sm">
            {started
              ? "Rating is each finished day's share of a player's own clan's marks, added up."
              : "No day has finished yet — this is the running day so far, and it will move."}
            {started && running && " The day still running is shown beside it and is not counted yet."}
          </p>
          {/* Each clan's own table: the days, and the sum behind every mark. */}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {ratings.map(({ clan }) => (
              <Link key={clan.id} href={monthHref(clan.tag)} className="flex items-center gap-1.5 hover:underline">
                <span aria-hidden className="size-2 rounded-full" style={{ background: clanAccent(clan.id).color }} />
                {clan.name}: day by day →
              </Link>
            ))}
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={Medal}
            title="Nothing to rate yet"
            body="Marks appear once battle day starts and the first attacks land. A season whose enemy lineups were not recorded cannot be rated."
          />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Member</TableHead>
                  <TableHead>Clan</TableHead>
                  <TableHead className="text-right">TH</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Marks</TableHead>
                  {running && <TableHead className="text-right">Today so far</TableHead>}
                  <TableHead className="text-right">Rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ clan, player }, index) => (
                  <TableRow key={`${clan.id}:${player.playerId}`}>
                    <TableCell className="text-right">
                      {index < 3 ? (
                        <span
                          className="inline-flex size-7 items-center justify-center rounded-full text-sm font-bold text-black"
                          style={{ background: MEDAL[index] }}
                        >
                          {index + 1}
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-sm tabular-nums">{index + 1}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/${encodeURIComponent(clan.tag)}/player/${encodeURIComponent(player.tag)}`}
                        className="font-medium hover:underline"
                      >
                        {player.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 text-sm">
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: clanAccent(clan.id).color }}
                        />
                        <span className="text-muted-foreground">{clan.name}</span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <TownHall level={player.thLevel} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{player.daysCounted}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        player.marks < 0 && "text-destructive",
                      )}
                    >
                      {signed(player.marks)}
                    </TableCell>
                    {running && (
                      <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                        {player.provisional
                          ? `${signed(player.provisional.marks)} · ${oneDecimal(player.provisional.share)}%`
                          : "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-right font-semibold tabular-nums">
                      {oneDecimal(player.rating)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          Marks are for attack and defence: stars, hitting a higher Town Hall or a higher base, and how
          a base holds up. The rules, and every player&apos;s sum for each day, are on each clan&apos;s own
          rating page above.
        </p>
      </Panel>
    </Shell>
  );
}
