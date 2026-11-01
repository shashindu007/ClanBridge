// Player rating — every player in the family, ranked on one number.
//
// The number is services/player-rating.ts: each section's marks as a % of the
// whole family's, weighed together. A player has the same number whoever is
// looking, which no page could work out from what a viewer may read, so
// scripts/sync/ratings.ts stores it and this page only shows it.
//
// Marks and % only. Each section's own page keeps its own rating, which is a
// share of one clan, so the % there differs from the one here.
//
// ALL CLANS, OR ONE (?clan=), a month picker (?month=) and a search (?q=), all in
// the URL. None of them renumbers anyone: # is always the family rank the database
// worked out (075), so a number means the same thing wherever it is seen. A
// player's place inside a clan is shown as its own line, in words.
//
// R3 — THE WHOLE FAMILY, ON PURPOSE. 073's family_player_ratings() is the third
// deliberate exception; read its header. A player is linked only in a clan the
// viewer belongs to, because the profile is a 404 anywhere else.
//
// Open to every member. See repositories/player-ratings.ts.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ListChecks, Trophy, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { formatDisplay } from "@/lib/display-time";
import {
  RATING_SECTIONS,
  RATING_SHORT_LABELS,
  hasMarks,
  matchesPlayer,
  openMonths,
  rankAnchor,
  ratingPercent,
  type RatingKind,
} from "@/lib/rating";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { canSeeMemberStats } from "@/lib/visibility";
import { PageHeader } from "@/components/page-header";
import { Disclosure, EmptyState, Panel, SectionHeader } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { RankMedal } from "@/components/player-rank";
import { RatingNav } from "@/components/rating-nav";
import { RuleList } from "@/components/rating-parts";
import { basesForUser } from "@/repositories/account-bases";
import { familyRatings, ratingMonths, type RatedPlayer } from "@/repositories/player-ratings";
import { DONATION_MARKS, RATING_KINDS, RATING_WEIGHTS } from "@/services/player-rating";
import { signed2 } from "@/services/raid-rating";

export const dynamic = "force-dynamic";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Player rating"
        description="Every player in the family, ranked on donations, war, CWL, Clan Games and raids together."
      />
      <RatingNav />
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

/** The rules, printed from the constants so they cannot drift from the sums. */
function Rules() {
  const { given, received, other } = DONATION_MARKS;
  const count = (per: number) => per.toLocaleString("en-GB");

  return (
    <Disclosure title="How the rating works" icon={ListChecks}>
      <div className="space-y-4 text-sm">
        <div className="space-y-2">
          <p className="font-medium">Donation marks</p>
          <RuleList
            rules={[
              [`Every ${count(given.per)} donated in the family`, given.marks],
              [`Every ${count(received.per)} received`, received.marks],
              [`Every ${count(other.per)} donated in other clans`, other.marks],
            ]}
          />
          <p className="text-muted-foreground text-xs">
            In proportion. War, CWL, Clan Games and raid marks are the ones on each section&apos;s page.
          </p>
        </div>

        <div className="space-y-2">
          <p className="font-medium">What each section is worth</p>
          <ul className="divide-y rounded-control border">
            {RATING_SECTIONS.map((section) => (
              <li key={section.kind} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                <span>{section.label}</span>
                <span className="font-semibold tabular-nums">{RATING_WEIGHTS[section.kind]}%</span>
              </li>
            ))}
          </ul>
        </div>

        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
          <li>
            A section&apos;s % is a player&apos;s marks divided by the plus marks of every player in the
            family. It is not the rating on that section&apos;s page, which is a share of one clan.
          </li>
          <li>The rating adds those up by the weights above.</li>
          <li>Missing a section scores 0 for it. The other sections do not make up for it.</li>
          <li>Only finished wars, CWL days and raid weekends count.</li>
          <li>
            Wars, CWL, raids and Clan Games go by calendar month. Donations use the season that overlaps
            the month most, so a few days at the turn of a month can count towards its neighbour.
          </li>
        </ul>
      </div>
    </Disclosure>
  );
}

/** A section's % and the marks behind it. */
function Section({ player, kind }: { player: RatedPlayer; kind: RatingKind }) {
  const marks = player.marks[kind];
  return (
    <TableCell data-label={RATING_SHORT_LABELS[kind]} className="text-right tabular-nums">
      <span className="text-sm">{ratingPercent(player.shares[kind])}</span>
      <span className={cn("block text-xs", marks < 0 ? "text-destructive" : "text-muted-foreground")}>
        {signed2(marks)}
      </span>
    </TableCell>
  );
}

/** The viewer's own villages in this month, each with a way to its row. */
function YourRank({
  villages,
  rowHref,
}: {
  villages: RatedPlayer[];
  rowHref: (player: RatedPlayer) => string;
}) {
  return (
    <Panel aria-labelledby="your-rank-title" className="space-y-3">
      <SectionHeader id="your-rank-title" title="Your rank" icon={UserRound} />
      <ul className="divide-y">
        {villages.map((village) => (
          <li key={village.playerId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
            <RankMedal rank={village.familyRank} medal={hasMarks(village.marks)} />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{village.name}</span>
              <span className="text-muted-foreground block text-xs tabular-nums">
                #{village.familyRank} of {village.familySize} in the family
                {village.tied && ", tied"} · #{village.clanRank} of {village.clanSize} in {village.clanName}
              </span>
            </span>
            <span className="font-semibold tabular-nums">{ratingPercent(village.rating)}</span>
            <Link
              href={rowHref(village)}
              className="text-primary inline-flex min-h-11 items-center text-sm font-medium hover:underline"
            >
              Show in list
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default async function PlayerRatingPage({
  searchParams,
}: {
  searchParams: Promise<{ clan?: string; month?: string; q?: string | string[] }>;
}) {
  const { clan: clanParam, month: monthParam, q: queryParam } = await searchParams;
  const query = (Array.isArray(queryParam) ? queryParam[0] : queryParam)?.trim().slice(0, 40) ?? "";
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) redirect("/login");

  const clans = (await visibleClans(supabase, userId)).filter((c) => canSeeMemberStats(c.role));
  if (clans.length === 0) {
    return (
      <Shell>
        <Panel>
          <EmptyState
            icon={Trophy}
            title="You are not in a clan yet"
            body="There is nothing to rate until a leader adds you to a clan."
          />
        </Panel>
      </Shell>
    );
  }

  const months = await ratingMonths(supabase);
  // An unknown or missing month is the latest one, never an error.
  const month = months.find((m) => m === monthParam) ?? months[0] ?? null;
  if (!month) {
    return (
      <Shell>
        <Panel>
          <EmptyState
            icon={Trophy}
            title="No ranking yet"
            body="The first ranking appears after the next rating update, which runs every 6 hours."
          />
        </Panel>
      </Shell>
    );
  }

  const [everyone, bases] = await Promise.all([familyRatings(supabase, month), basesForUser(supabase, userId)]);
  const ownIds = new Set(bases.map((b) => b.playerId));
  const ownRows = everyone.filter((p) => ownIds.has(p.playerId));

  const ranked = [...new Map(everyone.map((p) => [p.clanId, p])).values()]
    .map((p) => ({
      id: p.clanId,
      tag: p.clanTag,
      name: p.clanName,
      count: everyone.filter((q) => q.clanId === p.clanId).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // One clan when asked for; otherwise all of them. An unknown tag is "all".
  const only = ranked.find((c) => c.tag === clanParam) ?? null;
  const rows = (only ? everyone.filter((p) => p.clanId === only.id) : everyone).filter((p) =>
    matchesPlayer(p, query),
  );

  const mine = new Set(clans.map((c) => c.id));
  const notYet = RATING_KINDS.filter((kind) => everyone.every((p) => p.marks[kind] === 0));
  const isOpen = openMonths(new Date()).includes(month);

  const here = (next: { clan?: string | null; month?: string; q?: string | null }) => {
    const search = new URLSearchParams();
    const m = next.month ?? month;
    const c = next.clan === undefined ? (only?.tag ?? null) : next.clan;
    const q = next.q === undefined ? query : next.q;
    if (m !== months[0]) search.set("month", m);
    if (c) search.set("clan", c);
    if (q) search.set("q", q);
    const text = search.toString();
    return text ? `/rating?${text}` : "/rating";
  };

  return (
    <Shell>
      {ownRows.length > 0 && (
        <YourRank
          villages={ownRows}
          rowHref={(p) => `${here({ clan: null, q: null })}#${rankAnchor(p.tag)}`}
        />
      )}

      <Panel aria-labelledby="ranking-title" className="space-y-4">
        <div className="space-y-1">
          <SectionHeader
            id="ranking-title"
            title={`Ranking for ${seasonLabel(month)}${isOpen ? ", so far" : ", final"}`}
            icon={Trophy}
            count={rows.length}
          />
          <p className="text-muted-foreground text-sm">
            # is the rank in the whole family, and players level on rating share it. Each % is a
            share of the whole family&apos;s marks, with the marks below it. Updated{" "}
            {formatDisplay(everyone[0]?.computedAt)}.
            {notYet.length > 0 &&
              ` Nothing counted yet for ${notYet
                .map((kind) => RATING_SECTIONS.find((s) => s.kind === kind)!.label.replace(" rating", ""))
                .join(", ")}.`}
          </p>
        </div>

        {/* The month, then all clans in one ranking or one clan's own. */}
        {months.length > 1 && (
          <nav aria-label="Month" className="cb-scroll-x flex gap-2 [&>*]:shrink-0">
            {months.slice(0, 12).map((m) => (
              <Choice key={m} href={here({ month: m })} active={m === month} label={seasonLabel(m)} />
            ))}
          </nav>
        )}
        <nav aria-label="Clan" className="flex flex-wrap gap-2">
          <Choice href={here({ clan: null })} active={!only} label="All clans" count={everyone.length} />
          {ranked.map((clan) => (
            <Choice
              key={clan.id}
              href={here({ clan: clan.tag })}
              active={only?.id === clan.id}
              label={clan.name}
              count={clan.count}
              dot={clanAccent(clan.id).color}
            />
          ))}
        </nav>

        {/* A plain GET form: the search is URL state, so it survives a reload. */}
        <form action="/rating" role="search" className="flex flex-wrap items-center gap-2">
          {month !== months[0] && <input type="hidden" name="month" value={month} />}
          {only && <input type="hidden" name="clan" value={only.tag} />}
          <Label htmlFor="rating-search" className="sr-only">
            Find a player by name or tag
          </Label>
          <Input
            id="rating-search"
            name="q"
            type="search"
            defaultValue={query}
            maxLength={40}
            placeholder="Find a player by name or tag"
            className="min-w-0 flex-1 sm:max-w-xs"
          />
          <Button type="submit" variant="outline">
            Find
          </Button>
          {query && (
            <Button asChild variant="ghost">
              <Link href={here({ q: null })}>Clear</Link>
            </Button>
          )}
        </form>

        {rows.length === 0 ? (
          <p className="text-muted-foreground rounded-panel border border-dashed p-6 text-center text-sm">
            No player matches &ldquo;{query}&rdquo; here. <Link className="text-foreground underline underline-offset-2" href={here({ clan: null, q: null })}>Show everyone</Link>
          </p>
        ) : (
        <div className="-mx-5 overflow-x-auto px-5">
          <Table className="cb-stack">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-right" title="Rank in the whole family">
                  #
                </TableHead>
                <TableHead>Member</TableHead>
                {!only && <TableHead>Clan</TableHead>}
                <TableHead className="text-right">TH</TableHead>
                {RATING_KINDS.map((kind) => (
                  <TableHead key={kind} className="text-right">
                    {RATING_SHORT_LABELS[kind]}
                    <span className="text-muted-foreground block text-xs font-normal">
                      {RATING_WEIGHTS[kind]}%
                    </span>
                  </TableHead>
                ))}
                <TableHead className="text-right">Rating</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((player) => (
                <TableRow
                  key={player.playerId}
                  id={rankAnchor(player.tag)}
                  className={cn("scroll-mt-24", ownIds.has(player.playerId) && "bg-primary/10")}
                >
                  <TableCell data-cell="corner" className="text-right">
                    <RankMedal rank={player.familyRank} medal={hasMarks(player.marks)} />
                    {player.tied && <span className="text-muted-foreground block text-xs">Tied</span>}
                  </TableCell>
                  <TableCell data-cell="title">
                    {mine.has(player.clanId) ? (
                      <Link
                        href={`/${encodeURIComponent(player.clanTag)}/player/${encodeURIComponent(player.tag)}`}
                        className="font-medium hover:underline"
                      >
                        {player.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{player.name}</span>
                    )}
                    {ownIds.has(player.playerId) && (
                      <Badge variant="secondary" className="ml-2">
                        You
                      </Badge>
                    )}
                    <span className="text-muted-foreground block font-mono text-xs">{player.tag}</span>
                    {only && (
                      <span className="text-muted-foreground block text-xs tabular-nums">
                        #{player.clanRank} of {player.clanSize} in {player.clanName}
                      </span>
                    )}
                  </TableCell>
                  {!only && (
                    <TableCell data-label="Clan">
                      <span className="flex items-center gap-2 text-sm">
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: clanAccent(player.clanId).color }}
                        />
                        <span className="text-muted-foreground">{player.clanName}</span>
                      </span>
                    </TableCell>
                  )}
                  <TableCell data-label="TH" className="text-right">
                    <TownHall level={player.thLevel} />
                  </TableCell>
                  {RATING_KINDS.map((kind) => (
                    <Section key={kind} player={player} kind={kind} />
                  ))}
                  <TableCell data-label="Rating" className="text-right font-semibold tabular-nums">
                    {ratingPercent(player.rating)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        )}
      </Panel>

      <Rules />
    </Shell>
  );
}
