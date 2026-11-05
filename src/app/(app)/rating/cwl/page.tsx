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
// resolved under its own clan (lib/cwl-latest.ts), over the list visibleClans()
// returned, and every read hangs off that season's id. RLS on the CWL tables is
// auth_clan_ids(), so a member of clan A reads nothing of clan B here.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ImageDown, Medal } from "lucide-react";
import { currentUserId } from "@/lib/auth";
import { clanAccent } from "@/lib/clan-accent";
import { visibleClans } from "@/lib/clans";
import { latestCwlMonth } from "@/lib/cwl-latest";
import { rankAnchor, rankRows } from "@/lib/rating";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { canSeeMemberStats, isLeadership } from "@/lib/visibility";
import { EmptyState, Panel, SectionHeader } from "@/components/kit";
import { RankDock } from "@/components/rank-dock";
import {
  Leaderboard,
  Podium,
  RatingToolbar,
  podiumRows,
  topOf,
  type BoardColumn,
  type BoardRow,
} from "@/components/rating-board";
import { RatingShell } from "@/components/rating-shell";
import { basesForUser } from "@/repositories/account-bases";
import { oneDecimal, signed } from "@/services/cwl-rating";

export const dynamic = "force-dynamic";

const TITLE = "CWL rating";
const DESCRIPTION = "Every player of your clans in this month's Clan War League, rated on attack and defence.";

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
      <RatingShell title={TITLE} description={DESCRIPTION}>
        <Panel>
          <EmptyState
            icon={Medal}
            title="You are not in a clan yet"
            body="There is nothing to rate until a leader adds you to a clan."
          />
        </Panel>
      </RatingShell>
    );
  }

  // The latest CWL month any of these clans has, and the clans that played it.
  const [latest, bases] = await Promise.all([latestCwlMonth(supabase, clans), basesForUser(supabase, userId)]);
  if (!latest) {
    return (
      <RatingShell title={TITLE} description={DESCRIPTION}>
        <Panel>
          <EmptyState
            icon={Medal}
            title="No CWL recorded yet"
            body="The rating appears with the first Clan War League week the sync captures."
          />
        </Panel>
      </RatingShell>
    );
  }

  const { month, entries: ratings } = latest;
  const ownIds = new Set(bases.map((b) => b.playerId));
  // Leaders post the month's results; the image is theirs to make.
  const leads = clans.some((c) => isLeadership(c.role));

  // One clan when asked for and it played this month; otherwise all of them.
  // An unknown tag is "all", never an error.
  const only = ratings.find((r) => r.clan.tag === clanParam) ?? null;
  const shown = only ? [only] : ratings;

  const started = shown.some((r) => r.rating.started);
  const running = shown.some((r) => r.rating.days.some((d) => d.status === "provisional"));
  const countOf = (r: (typeof ratings)[number]) =>
    r.rating.players.filter((p) => r.rating.started || p.provisional).length;

  type Item = { clan: (typeof ratings)[number]["clan"]; player: (typeof ratings)[number]["rating"]["players"][number] };
  const order = (a: Item, b: Item) =>
    b.player.rating - a.player.rating ||
    b.player.marks - a.player.marks ||
    (b.player.averageDestruction ?? -1) - (a.player.averageDestruction ?? -1) ||
    (b.player.provisional?.share ?? 0) - (a.player.provisional?.share ?? 0);
  const sorted: Item[] = shown
    .flatMap(({ clan, rating }) => rating.players.map((player) => ({ clan, player })))
    // Until a day has finished there is only the running day to go on.
    .filter(({ player }) => started || player.provisional)
    .sort((a, b) => order(a, b) || a.player.name.localeCompare(b.player.name));

  const monthHref = (clanTag: string) =>
    `/${encodeURIComponent(clanTag)}/cwl/${encodeURIComponent(month)}/rating`;
  const here = (clanTag: string | null) =>
    clanTag ? `/rating/cwl?clan=${encodeURIComponent(clanTag)}` : "/rating/cwl";

  const rows: BoardRow[] = rankRows(sorted, (a, b) => order(a, b) === 0).map(({ item: { clan, player }, rank, tied }) => ({
    key: `${clan.id}:${player.playerId}`,
    anchorId: rankAnchor(player.tag),
    rank,
    tied,
    medal: player.rating > 0,
    name: player.name,
    tag: player.tag,
    href: `/${encodeURIComponent(clan.tag)}/player/${encodeURIComponent(player.tag)}`,
    you: ownIds.has(player.playerId),
    clan: { id: clan.id, name: clan.name, href: monthHref(clan.tag) },
    thLevel: player.thLevel,
    rating: { text: oneDecimal(player.rating), value: player.rating },
    cells: {
      days: player.daysCounted,
      marks: <span className={cn(player.marks < 0 && "text-destructive")}>{signed(player.marks)}</span>,
      live: (
        <span className="text-muted-foreground text-sm">
          {player.provisional ? `${signed(player.provisional.marks)} · ${oneDecimal(player.provisional.share)}%` : "—"}
        </span>
      ),
      perDay: (
        <span className="text-muted-foreground text-sm">
          {player.perDay === null ? "—" : oneDecimal(player.perDay)}
        </span>
      ),
    },
  }));

  const columns: BoardColumn[] = [
    { key: "days", label: "Days" },
    { key: "marks", label: "Marks" },
    ...(running ? [{ key: "live", label: "Today so far" }] : []),
    { key: "perDay", label: "Per day", title: "Rating divided by the finished days they played" },
  ];

  const dock = rows
    .filter((row) => row.you)
    .map((row) => ({
      key: row.key,
      name: row.name,
      rank: row.rank,
      medal: row.medal,
      line: `#${row.rank} of ${rows.length}${row.tied ? ", tied" : ""} in ${only ? only.clan.name : "your clans"} · ${row.clan.name}`,
      rating: row.rating.text,
      href: `${here(only?.clan.tag ?? null)}#${row.anchorId}`,
    }));

  const oneClan = only ?? (ratings.length === 1 ? ratings[0]! : null);

  return (
    <RatingShell
      title={TITLE}
      description={DESCRIPTION}
      dock={dock.length > 0 && <RankDock title={`CWL, ${seasonLabel(month)}`} entries={dock} />}
    >
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
        <RatingToolbar
          clans={
            ratings.length > 1
              ? [
                  {
                    href: here(null),
                    label: "All clans",
                    active: !only,
                    count: ratings.reduce((t, r) => t + countOf(r), 0),
                  },
                  ...ratings.map((r) => ({
                    href: here(r.clan.tag),
                    label: r.clan.name,
                    active: only?.clan.id === r.clan.id,
                    count: countOf(r),
                    dot: clanAccent(r.clan.id).color,
                  })),
                ]
              : []
          }
          extra={
            (oneClan || leads) && (
              <div className="flex flex-wrap items-center gap-3">
                {/* The clan's own table: the days, and the sum behind every mark. */}
                {oneClan && (
                  <Link
                    href={monthHref(oneClan.clan.tag)}
                    className="text-primary inline-flex min-h-10 items-center text-sm font-medium hover:underline"
                  >
                    {oneClan.clan.name}, day by day →
                  </Link>
                )}
                {leads && (
                  <Link href="/rating/cwl/share" className="cb-choice min-h-10">
                    <ImageDown aria-hidden className="size-4" />
                    Results image
                  </Link>
                )}
              </div>
            )
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={Medal}
            title="Nothing to rate yet"
            body="Marks appear once battle day starts and the first attacks land. A season whose enemy lineups were not recorded cannot be rated."
          />
        ) : (
          <>
            <Podium rows={podiumRows(rows)} />
            <Leaderboard
              rows={rows}
              columns={columns}
              ratingTop={topOf(rows.map((r) => r.rating.value))}
              showClan={!only && ratings.length > 1}
            />
          </>
        )}

        <p className="text-muted-foreground text-xs">
          Marks are for attack and defence: stars, hitting a higher Town Hall or a higher base, the
          day&apos;s heroic attack and defence, and how a base holds up. &ldquo;Per day&rdquo; is the rating divided
          by the finished days played. The rules, and every player&apos;s sum for each day, are on each clan&apos;s own
          rating page — {only ? "the link above" : "follow a clan's name"}.
        </p>
      </Panel>
    </RatingShell>
  );
}
