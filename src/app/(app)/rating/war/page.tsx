// War rating — a section of Player rating: every player of the viewer's clans
// over one month of regular wars, in one ranking.
//
// The rating itself is one clan's month worked out by services/war-rating.ts,
// exactly as on that clan's own war rating page; this page lays the clans'
// tables side by side. A share is always of a player's OWN clan's plus marks in
// one war, so the ranking compares how much of their clan's wars each carried.
//
// ALL CLANS, OR ONE (?clan=), and a month picker (?month=) — a clan remembers
// its wars by the month, and a month is what the shares are added over.
//
// Outside [clanTag] because it spans clans, like the CWL rating beside it.
//
// R3 — spanning clans is not the same as not filtering by clan. Each clan's
// wars are read under that clan's id, over the list visibleClans() returned,
// and every child read takes a war id from that read. RLS on the war tables is
// auth_clan_ids(), so a member of clan A reads nothing of clan B here.

import Link from "next/link";
import { redirect } from "next/navigation";
import { Swords } from "lucide-react";
import { currentUserId } from "@/lib/auth";
import { clanAccent } from "@/lib/clan-accent";
import { visibleClans } from "@/lib/clans";
import { rankAnchor, rankRows } from "@/lib/rating";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { canSeeMemberStats } from "@/lib/visibility";
import { loadWarMonth } from "@/lib/war-rating-data";
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
import { warMonthsForClan } from "@/repositories/war";
import { oneDecimal, signed } from "@/services/cwl-rating";

export const dynamic = "force-dynamic";

const TITLE = "War rating";
const DESCRIPTION = "Every player of your clans over a month of regular wars, rated on attack and defence.";

export default async function WarRatingPage({
  searchParams,
}: {
  searchParams: Promise<{ clan?: string; month?: string }>;
}) {
  const { clan: clanParam, month: monthParam } = await searchParams;
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clans = (await visibleClans(supabase, userId)).filter((c) => canSeeMemberStats(c.role));
  if (clans.length === 0) {
    return (
      <RatingShell title={TITLE} description={DESCRIPTION}>
        <Panel>
          <EmptyState
            icon={Swords}
            title="You are not in a clan yet"
            body="There is nothing to rate until a leader adds you to a clan."
          />
        </Panel>
      </RatingShell>
    );
  }

  // Every month any of these clans has a war in, newest first.
  const [monthLists, bases] = await Promise.all([
    Promise.all(clans.map((clan) => warMonthsForClan(supabase, clan.id))),
    basesForUser(supabase, userId),
  ]);
  const months = [...new Set(monthLists.flat())].sort().reverse();
  // An unknown or missing month is the latest one, never an error.
  const month = months.find((m) => m === monthParam) ?? months[0] ?? null;
  if (!month) {
    return (
      <RatingShell title={TITLE} description={DESCRIPTION}>
        <Panel>
          <EmptyState
            icon={Swords}
            title="No wars recorded yet"
            body="The rating appears with the first regular war the sync captures."
          />
        </Panel>
      </RatingShell>
    );
  }

  const loaded = await Promise.all(
    clans.map(async (clan) => ({ clan, view: await loadWarMonth(supabase, clan, month) })),
  );
  // The clans that fought a war this month.
  const played = loaded.filter(({ view }) => view.wars.length > 0);
  const ownIds = new Set(bases.map((b) => b.playerId));

  // One clan when asked for and it played this month; otherwise all of them.
  const only = played.find((p) => p.clan.tag === clanParam) ?? null;
  const shown = only ? [only] : played;
  const rankedOf = (p: (typeof played)[number]) =>
    p.view.rating.players.filter((player) => p.view.rating.started || player.provisional);

  const started = shown.some((p) => p.view.rating.started);
  const fighting = shown.some((p) => p.view.rating.wars.some((w) => w.status === "provisional"));
  const counted = shown.flatMap((p) => p.view.rating.wars.filter((w) => w.status === "counted"));
  const attackOnly = counted.filter((w) => w.attackOnly).length;
  const incomplete = counted.filter((w) => w.starsNotCaptured > 0).length;

  type Item = { clan: (typeof played)[number]["clan"]; player: ReturnType<typeof rankedOf>[number] };
  const order = (a: Item, b: Item) =>
    b.player.rating - a.player.rating ||
    b.player.marks - a.player.marks ||
    (b.player.averageDestruction ?? -1) - (a.player.averageDestruction ?? -1) ||
    (b.player.provisional?.share ?? 0) - (a.player.provisional?.share ?? 0);
  const sorted: Item[] = shown
    .flatMap((p) => rankedOf(p).map((player) => ({ clan: p.clan, player })))
    .sort((a, b) => order(a, b) || a.player.name.localeCompare(b.player.name));

  const clanHref = (clanTag: string) => `/${encodeURIComponent(clanTag)}/war/rating?month=${month}`;
  const here = (next: { clan?: string | null; month?: string }) => {
    const query = new URLSearchParams();
    const m = next.month ?? month;
    const c = next.clan === undefined ? (only?.clan.tag ?? null) : next.clan;
    if (m !== months[0]) query.set("month", m);
    if (c) query.set("clan", c);
    const text = query.toString();
    return text ? `/rating/war?${text}` : "/rating/war";
  };

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
    clan: { id: clan.id, name: clan.name, href: clanHref(clan.tag) },
    thLevel: player.thLevel,
    rating: { text: oneDecimal(player.rating), value: player.rating },
    cells: {
      wars: player.warsCounted,
      marks: <span className={cn(player.marks < 0 && "text-destructive")}>{signed(player.marks)}</span>,
      live: (
        <span className="text-muted-foreground text-sm">
          {player.provisional ? `${signed(player.provisional.marks)} · ${oneDecimal(player.provisional.share)}%` : "—"}
        </span>
      ),
      perWar: (
        <span className="text-muted-foreground text-sm">
          {player.perWar === null ? "—" : oneDecimal(player.perWar)}
        </span>
      ),
    },
  }));

  const columns: BoardColumn[] = [
    { key: "wars", label: "Wars" },
    { key: "marks", label: "Marks" },
    ...(fighting ? [{ key: "live", label: "This war so far" }] : []),
    { key: "perWar", label: "Per war", title: "Rating divided by the finished wars they were in" },
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
      href: `${here({})}#${row.anchorId}`,
    }));

  return (
    <RatingShell
      title={TITLE}
      description={DESCRIPTION}
      dock={dock.length > 0 && <RankDock title={`War, ${seasonLabel(month)}`} entries={dock} />}
    >
      <Panel aria-labelledby="war-rating-title" className="space-y-4">
        <div className="space-y-1">
          <SectionHeader
            id="war-rating-title"
            title={`Wars of ${seasonLabel(month)}`}
            icon={Swords}
            count={rows.length}
          />
          <p className="text-muted-foreground text-sm">
            {started
              ? only
                ? `Rating is each finished war's share of ${only.clan.name}'s plus marks, added up over the month.`
                : "Rating is each finished war's share of a player's own clan's plus marks, added up over the month."
              : "No war of this month has finished yet — this is the war being fought so far, and it will move."}
            {started && fighting && " The war being fought is shown beside it and is not counted yet."}
          </p>
        </div>

        {/* The month, then all clans in one ranking or one clan's own. */}
        <RatingToolbar
          months={months.map((m) => ({ href: here({ month: m }), label: seasonLabel(m), active: m === month }))}
          clans={
            played.length > 1
              ? [
                  {
                    href: here({ clan: null }),
                    label: "All clans",
                    active: !only,
                    count: played.reduce((t, p) => t + rankedOf(p).length, 0),
                  },
                  ...played.map((p) => ({
                    href: here({ clan: p.clan.tag }),
                    label: p.clan.name,
                    active: only?.clan.id === p.clan.id,
                    count: rankedOf(p).length,
                    dot: clanAccent(p.clan.id).color,
                  })),
                ]
              : []
          }
          extra={
            // The clan's own page: each war, and the sum behind every mark.
            (only ?? (played.length === 1 ? played[0] : null)) && (
              <Link
                href={clanHref((only ?? played[0]!).clan.tag)}
                className="text-primary inline-flex min-h-10 items-center text-sm font-medium hover:underline"
              >
                {(only ?? played[0]!).clan.name}, war by war →
              </Link>
            )
          }
        />

        {rows.length === 0 ? (
          <EmptyState
            icon={Swords}
            title="Nothing to rate yet"
            body="Marks appear once battle day starts and the first attacks land."
          />
        ) : (
          <>
            <Podium rows={podiumRows(rows)} />
            <Leaderboard
              rows={rows}
              columns={columns}
              ratingTop={topOf(rows.map((r) => r.rating.value))}
              showClan={!only && played.length > 1}
            />
          </>
        )}

        <p className="text-muted-foreground text-xs">
          Each attack is marked much like a CWL attack and both of a player&apos;s attacks are added; the
          best attack on each enemy base counts 1.5 times. &ldquo;Per war&rdquo; is the rating divided by the
          finished wars played. The
          rules, and every player&apos;s sum for each war, are on each clan&apos;s own war rating page —{" "}
          {only ? "the link above" : "follow a clan's name"}.
          {attackOnly > 0 &&
            ` ${attackOnly} of the ${counted.length} finished wars ${attackOnly === 1 ? "is" : "are"} rated on attack only: the enemy's attacks were not recorded for wars before this was added.`}
          {incomplete > 0 &&
            ` In ${incomplete} the last attacks were not captured, so nobody lost marks for an unused attack there.`}
        </p>
      </Panel>
    </RatingShell>
  );
}
