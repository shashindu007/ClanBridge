// CWL rating — a section of Player rating: every player of the viewer's clans
// in the latest CWL month, in one ranking.
//
// The rating itself is one clan's season worked out by services/cwl-rating.ts,
// exactly as on that season's own Rating tab; this page lays the clans' tables
// side by side. A share is always of a player's OWN clan's marks for the day,
// so the ranking compares how much of their clan's result each player carried.
//
// ALL CLANS, OR ONE. The buttons narrow the ranking to a single clan (?clan=),
// renumbered from 1 — the same players and the same ratings, just that clan's.
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

/** One filter button: a clan (with its colour) or "All clans", and how many it holds. */
function ClanButton({
  href,
  active,
  label,
  count,
  dot,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
  dot?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-control px-3 py-1.5 text-sm font-medium",
        active ? "bg-primary text-primary-foreground" : "hover:bg-accent border",
      )}
    >
      {dot && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: dot }} />}
      {label}
      <span className={cn("text-xs font-normal tabular-nums", !active && "text-muted-foreground")}>{count}</span>
    </Link>
  );
}

export default async function CwlRatingPage({
  searchParams,
}: {
  searchParams: Promise<{ clan?: string }>;
}) {
  const { clan: clanParam } = await searchParams;
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

  // One clan when asked for and it played this month; otherwise all of them.
  // An unknown tag is "all", never an error.
  const only = ratings.find((r) => r.clan.tag === clanParam) ?? null;
  const shown = only ? [only] : ratings;

  const started = shown.some((r) => r.rating.started);
  const running = shown.some((r) => r.rating.days.some((d) => d.status === "provisional"));
  const rows = shown
    .flatMap(({ clan, rating }) => rating.players.map((player) => ({ clan, player })))
    // Until a day has finished there is only the running day to go on.
    .filter(({ player }) => started || player.provisional)
    .sort(
      (a, b) =>
        b.player.rating - a.player.rating ||
        b.player.marks - a.player.marks ||
        (b.player.averageDestruction ?? -1) - (a.player.averageDestruction ?? -1) ||
        (b.player.provisional?.share ?? 0) - (a.player.provisional?.share ?? 0) ||
        a.player.name.localeCompare(b.player.name),
    );
  const allCount = ratings.reduce(
    (t, r) => t + r.rating.players.filter((p) => r.rating.started || p.provisional).length,
    0,
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
              ? only
                ? `Rating is each finished day's share of ${only.clan.name}'s plus marks, added up.`
                : "Rating is each finished day's share of a player's own clan's plus marks, added up."
              : "No day has finished yet — this is the running day so far, and it will move."}
            {started && running && " The day still running is shown beside it and is not counted yet."}
          </p>
        </div>

        {/* All clans in one ranking, or one clan's own. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label="Clan" className="flex flex-wrap gap-2">
            <ClanButton href="/rating/cwl" active={!only} label="All clans" count={allCount} />
            {ratings.map(({ clan, rating }) => (
              <ClanButton
                key={clan.id}
                href={`/rating/cwl?clan=${encodeURIComponent(clan.tag)}`}
                active={only?.clan.id === clan.id}
                label={clan.name}
                count={rating.players.filter((p) => rating.started || p.provisional).length}
                dot={clanAccent(clan.id).color}
              />
            ))}
          </nav>
          {/* The clan's own table: the days, and the sum behind every mark. */}
          {only && (
            <Link href={monthHref(only.clan.tag)} className="text-primary text-sm font-medium hover:underline">
              {only.clan.name}, day by day →
            </Link>
          )}
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
                  {!only && <TableHead>Clan</TableHead>}
                  <TableHead className="text-right">TH</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-right">Marks</TableHead>
                  {running && <TableHead className="text-right">Today so far</TableHead>}
                  <TableHead className="text-right" title="Rating divided by the finished days they played">
                    Per day
                  </TableHead>
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
                    {!only && (
                      <TableCell>
                        <Link href={monthHref(clan.tag)} className="group flex items-center gap-2 text-sm">
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: clanAccent(clan.id).color }}
                          />
                          <span className="text-muted-foreground group-hover:underline">{clan.name}</span>
                        </Link>
                      </TableCell>
                    )}
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
                    <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                      {player.perDay === null ? "—" : oneDecimal(player.perDay)}
                    </TableCell>
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
          Marks are for attack and defence: stars, hitting a higher Town Hall or a higher base, the
          day&apos;s heroic attack and defence, and how a base holds up. &ldquo;Per day&rdquo; is the rating divided
          by the finished days played. The rules, and every player&apos;s sum for each day, are on each clan&apos;s own
          rating page — {only ? "the link above" : "follow a clan's name"}.
        </p>
      </Panel>
    </Shell>
  );
}
