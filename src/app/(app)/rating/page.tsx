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
import { ChevronDown, Info, ListChecks, Search, Trophy, UserRound } from "lucide-react";
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
import { Podium, ShareBar, type PodiumEntry } from "@/components/rating-board";
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
      data-active={active || undefined}
      className={cn("cb-choice", dot && "cb-choice-clan")}
      style={dot ? ({ "--chip": dot } as React.CSSProperties) : undefined}
    >
      {dot && <span aria-hidden className="cb-choice-dot" />}
      {label}
      {count !== undefined && <span className="cb-choice-count">{count}</span>}
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

/**
 * A section's %, its bar against the family's best, and the marks behind it.
 * `idle` is a section nobody has marks in yet this month: still there, so the
 * columns do not jump about from month to month, but faded back.
 */
function Section({
  player,
  kind,
  top,
  idle,
}: {
  player: RatedPlayer;
  kind: RatingKind;
  top: number;
  idle: boolean;
}) {
  const marks = player.marks[kind];
  const share = player.shares[kind];
  return (
    <TableCell data-label={RATING_SHORT_LABELS[kind]} className={cn("text-right tabular-nums", idle && "opacity-40")}>
      <span className={cn("text-sm", share === 0 && "text-muted-foreground")}>{ratingPercent(share)}</span>
      {!idle && <ShareBar value={share} top={top} className="mt-1 h-1 w-14" />}
      <span className={cn("block text-xs", marks < 0 ? "text-destructive" : "text-muted-foreground")}>
        {signed2(marks)}
      </span>
    </TableCell>
  );
}

/** Rows that fade in on load. Past this they are simply there, so a long list does not crawl in. */
const ROWS_ANIMATED = 20;

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
          <li
            key={village.playerId}
            className="hover:bg-foreground/5 -mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-2 py-2 transition-colors"
          >
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

  // Every bar is against the best in the family, so a bar means the same
  // length whichever clan or search is showing.
  const top = Object.fromEntries(
    RATING_KINDS.map((kind) => [kind, Math.max(0, ...everyone.map((p) => p.shares[kind]))]),
  ) as Record<RatingKind, number>;
  const topRating = Math.max(0, ...everyone.map((p) => p.rating));

  // The podium: the clan's own top three when one clan is shown, else the
  // family's. Only a place with marks behind it, as with the medals.
  const placeOf = (p: RatedPlayer) => (only ? p.clanRank : p.familyRank);
  const podium: PodiumEntry[] = query
    ? []
    : rows
        .filter((p) => hasMarks(p.marks) && placeOf(p) <= 3)
        .sort((a, b) => placeOf(a) - placeOf(b))
        .slice(0, 3)
        .map((player) => ({ player, place: placeOf(player) }));
  const profileHref = (p: RatedPlayer) =>
    mine.has(p.clanId) ? `/${encodeURIComponent(p.clanTag)}/player/${encodeURIComponent(p.tag)}` : null;

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

  // A plain GET form: the search is URL state, so it survives a reload.
  const searchForm = (
    <form action="/rating" role="search" className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
      {month !== months[0] && <input type="hidden" name="month" value={month} />}
      {only && <input type="hidden" name="clan" value={only.tag} />}
      <Label htmlFor="rating-search" className="sr-only">
        Find a player by name or tag
      </Label>
      <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
        <Search
          aria-hidden
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          id="rating-search"
          name="q"
          type="search"
          defaultValue={query}
          maxLength={40}
          placeholder="Find a player by name or tag"
          className="pl-9"
        />
      </div>
      <Button type="submit" variant="outline">
        Find
      </Button>
      {query && (
        <Button asChild variant="ghost">
          <Link href={here({ q: null })}>Clear</Link>
        </Button>
      )}
    </form>
  );

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
            Updated {formatDisplay(everyone[0]?.computedAt)}.
            {notYet.length > 0 &&
              ` Nothing counted yet for ${notYet
                .map((kind) => RATING_SECTIONS.find((s) => s.kind === kind)!.label.replace(" rating", ""))
                .join(", ")}.`}
          </p>
          <details className="group text-sm">
            <summary className="text-primary inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 font-medium [&::-webkit-details-marker]:hidden">
              <Info aria-hidden className="size-4" />
              How to read this ranking
              <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180" />
            </summary>
            <p className="text-muted-foreground max-w-prose pb-1">
              # is the rank in the whole family, and players level on rating share it. Each % is a
              share of the whole family&apos;s marks, with the marks below it. Each bar is against the
              best in the family. A faded column has nothing counted in it yet this month.
            </p>
          </details>
        </div>

        {/* One toolbar: the month and the search, then all clans in one
            ranking or one clan's own. */}
        <div className="cb-sunken space-y-3 rounded-control p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {months.length > 1 && (
              <nav aria-label="Month" className="cb-segment cb-scroll-x flex max-w-full min-w-0 gap-1 [&>*]:shrink-0">
                {months.slice(0, 12).map((m) => (
                  <Choice key={m} href={here({ month: m })} active={m === month} label={seasonLabel(m)} />
                ))}
              </nav>
            )}
            {searchForm}
          </div>
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
        </div>

        <Podium
          entries={podium}
          clanView={only !== null}
          hrefFor={profileHref}
          isYou={(p) => ownIds.has(p.playerId)}
        />

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
                  <TableHead
                    key={kind}
                    className={cn("text-right", notYet.includes(kind) && "opacity-50")}
                    title={notYet.includes(kind) ? "Nothing counted yet this month" : undefined}
                  >
                    {RATING_SHORT_LABELS[kind]}
                    <span className="block">
                      <span className="cb-weight">{RATING_WEIGHTS[kind]}%</span>
                    </span>
                  </TableHead>
                ))}
                <TableHead className="text-right">Rating</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((player, i) => (
                <TableRow
                  key={player.playerId}
                  id={rankAnchor(player.tag)}
                  data-you={ownIds.has(player.playerId) || undefined}
                  className={cn(
                    "cb-board-row scroll-mt-24",
                    "hover:bg-[color-mix(in_oklch,var(--row-accent)_10%,transparent)]",
                    "data-[you]:bg-gold/10 data-[you]:hover:bg-gold/15",
                    i < ROWS_ANIMATED && "cb-fade",
                  )}
                  style={{ "--row-accent": clanAccent(player.clanId).color, "--i": i } as React.CSSProperties}
                >
                  <TableCell data-cell="corner" className="text-right">
                    <RankMedal rank={player.familyRank} medal={hasMarks(player.marks)} />
                    {player.tied && <span className="text-muted-foreground block text-xs">Tied</span>}
                  </TableCell>
                  <TableCell data-cell="title">
                    {mine.has(player.clanId) ? (
                      <Link href={profileHref(player)!} className="font-medium hover:underline">
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
                      <span className="cb-clan-tag">
                        <span aria-hidden className="cb-choice-dot" />
                        <span className="truncate">{player.clanName}</span>
                      </span>
                    </TableCell>
                  )}
                  <TableCell data-label="TH" className="text-right">
                    <TownHall level={player.thLevel} />
                  </TableCell>
                  {RATING_KINDS.map((kind) => (
                    <Section key={kind} player={player} kind={kind} top={top[kind]} idle={notYet.includes(kind)} />
                  ))}
                  <TableCell data-label="Rating" className="text-right tabular-nums">
                    <span className="cb-title text-lg leading-none">{ratingPercent(player.rating)}</span>
                    <ShareBar value={player.rating} top={topRating} colour="var(--gold)" className="mt-1.5 h-1.5 w-20" />
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
