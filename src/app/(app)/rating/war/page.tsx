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
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { canSeeMemberStats } from "@/lib/visibility";
import { loadWarMonth } from "@/lib/war-rating-data";
import { PageHeader } from "@/components/page-header";
import { EmptyState, Panel, SectionHeader } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { RatingNav } from "@/components/rating-nav";
import { warMonthsForClan } from "@/repositories/war";
import { oneDecimal, signed } from "@/services/cwl-rating";

export const dynamic = "force-dynamic";

/** Gold, silver, bronze for the top three, as on Player rating. */
const MEDAL = ["#f5c542", "#c0c7d1", "#cd8a4b"];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="War rating"
        back={{ href: "/rating", label: "Player rating" }}
        description="Every player of your clans over a month of regular wars, rated on attack and defence."
      />
      <RatingNav current="war" />
      {children}
    </main>
  );
}

/** One filter button: a clan (with its colour), a month, or "All clans". */
function Choice({
  href,
  active,
  label,
  count,
  dot,
}: {
  href: string;
  active: boolean;
  label: string;
  count?: number;
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
      {count !== undefined && (
        <span className={cn("text-xs font-normal tabular-nums", !active && "text-muted-foreground")}>{count}</span>
      )}
    </Link>
  );
}

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
      <Shell>
        <Panel>
          <EmptyState
            icon={Swords}
            title="You are not in a clan yet"
            body="There is nothing to rate until a leader adds you to a clan."
          />
        </Panel>
      </Shell>
    );
  }

  // Every month any of these clans has a war in, newest first.
  const monthLists = await Promise.all(clans.map((clan) => warMonthsForClan(supabase, clan.id)));
  const months = [...new Set(monthLists.flat())].sort().reverse();
  // An unknown or missing month is the latest one, never an error.
  const month = months.find((m) => m === monthParam) ?? months[0] ?? null;
  if (!month) {
    return (
      <Shell>
        <Panel>
          <EmptyState
            icon={Swords}
            title="No wars recorded yet"
            body="The rating appears with the first regular war the sync captures."
          />
        </Panel>
      </Shell>
    );
  }

  const loaded = await Promise.all(
    clans.map(async (clan) => ({ clan, view: await loadWarMonth(supabase, clan, month) })),
  );
  // The clans that fought a war this month.
  const played = loaded.filter(({ view }) => view.wars.length > 0);

  // One clan when asked for and it played this month; otherwise all of them.
  const only = played.find((p) => p.clan.tag === clanParam) ?? null;
  const shown = only ? [only] : played;
  const rankedOf = (p: (typeof played)[number]) =>
    p.view.rating.players.filter((player) => p.view.rating.started || player.provisional);

  const started = shown.some((p) => p.view.rating.started);
  const fighting = shown.some((p) => p.view.rating.wars.some((w) => w.status === "provisional"));
  const counted = shown.flatMap((p) => p.view.rating.wars.filter((w) => w.status === "counted"));
  const attackOnly = counted.filter((w) => w.attackOnly).length;
  const rows = shown
    .flatMap((p) => rankedOf(p).map((player) => ({ clan: p.clan, player })))
    .sort(
      (a, b) =>
        b.player.rating - a.player.rating ||
        b.player.marks - a.player.marks ||
        (b.player.averageDestruction ?? -1) - (a.player.averageDestruction ?? -1) ||
        (b.player.provisional?.share ?? 0) - (a.player.provisional?.share ?? 0) ||
        a.player.name.localeCompare(b.player.name),
    );

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

  return (
    <Shell>
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
        <nav aria-label="Month" className="flex flex-wrap gap-2">
          {months.slice(0, 12).map((m) => (
            <Choice key={m} href={here({ month: m })} active={m === month} label={seasonLabel(m)} />
          ))}
        </nav>
        {played.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Clan" className="flex flex-wrap gap-2">
              <Choice
                href={here({ clan: null })}
                active={!only}
                label="All clans"
                count={played.reduce((t, p) => t + rankedOf(p).length, 0)}
              />
              {played.map((p) => (
                <Choice
                  key={p.clan.id}
                  href={here({ clan: p.clan.tag })}
                  active={only?.clan.id === p.clan.id}
                  label={p.clan.name}
                  count={rankedOf(p).length}
                  dot={clanAccent(p.clan.id).color}
                />
              ))}
            </nav>
            {/* The clan's own page: each war, and the sum behind every mark. */}
            {only && (
              <Link href={clanHref(only.clan.tag)} className="text-primary text-sm font-medium hover:underline">
                {only.clan.name}, war by war →
              </Link>
            )}
          </div>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon={Swords}
            title="Nothing to rate yet"
            body="Marks appear once battle day starts and the first attacks land."
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
                  <TableHead className="text-right">Wars</TableHead>
                  <TableHead className="text-right">Marks</TableHead>
                  {fighting && <TableHead className="text-right">This war so far</TableHead>}
                  <TableHead className="text-right" title="Rating divided by the finished wars they were in">
                    Per war
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
                        <Link href={clanHref(clan.tag)} className="group flex items-center gap-2 text-sm">
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
                    <TableCell className="text-right tabular-nums">{player.warsCounted}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", player.marks < 0 && "text-destructive")}>
                      {signed(player.marks)}
                    </TableCell>
                    {fighting && (
                      <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                        {player.provisional
                          ? `${signed(player.provisional.marks)} · ${oneDecimal(player.provisional.share)}%`
                          : "—"}
                      </TableCell>
                    )}
                    <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                      {player.perWar === null ? "—" : oneDecimal(player.perWar)}
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
          Each attack is marked like a CWL attack; both of a player&apos;s attacks are added, with the better
          one counting 1.5 times. &ldquo;Per war&rdquo; is the rating divided by the finished wars played. The
          rules, and every player&apos;s sum for each war, are on each clan&apos;s own war rating page —{" "}
          {only ? "the link above" : "follow a clan's name"}.
          {attackOnly > 0 &&
            ` ${attackOnly} of the ${counted.length} finished wars ${attackOnly === 1 ? "is" : "are"} rated on attack only: the enemy's attacks were not recorded for wars before this was added.`}
        </p>
      </Panel>
    </Shell>
  );
}
