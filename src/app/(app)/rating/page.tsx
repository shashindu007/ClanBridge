// Player rating, Overall: every player in the family, ranked on one number.
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
// Drawn with components/rating-board.tsx, like every section page. Open to
// every member. See repositories/player-ratings.ts and ./family-board.tsx.

import Link from "next/link";
import { ChevronDown, Info, ListChecks, Search, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDisplay } from "@/lib/display-time";
import {
  RATING_SECTIONS,
  RATING_SHORT_LABELS,
  hasMarks,
  matchesPlayer,
  ratingPercent,
  type RatingKind,
} from "@/lib/rating";
import { seasonLabel } from "@/lib/roster-view";
import { cn } from "@/lib/utils";
import { Disclosure, EmptyState, Panel, SectionHeader } from "@/components/kit";
import { RankDock } from "@/components/rank-dock";
import {
  Leaderboard,
  Podium,
  RatingToolbar,
  ShareBar,
  podiumRows,
  topOf,
  type BoardColumn,
  type BoardRow,
} from "@/components/rating-board";
import { RuleList } from "@/components/rating-parts";
import { RatingShell } from "@/components/rating-shell";
import type { RatedPlayer } from "@/repositories/player-ratings";
import { DONATION_MARKS, RATING_KINDS, RATING_WEIGHTS } from "@/services/player-rating";
import { signed2 } from "@/services/raid-rating";
import { clanChoices, dockEntries, familyClans, familyRow, loadFamily } from "./family-board";

export const dynamic = "force-dynamic";

const TITLE = "Player rating";
const DESCRIPTION = "Every player in the family, ranked on donations, war, CWL, Clan Games and raids together.";

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

/** A section's %, its bar against the family's best, and the marks behind it. */
function SectionCell({
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
    <>
      <span className={cn("text-sm", share === 0 && "text-muted-foreground")}>{ratingPercent(share)}</span>
      {!idle && <ShareBar value={share} top={top} className="mt-1 h-1 w-14" />}
      <span className={cn("block text-xs", marks < 0 ? "text-destructive" : "text-muted-foreground")}>
        {signed2(marks)}
      </span>
    </>
  );
}

export default async function PlayerRatingPage({
  searchParams,
}: {
  searchParams: Promise<{ clan?: string; month?: string; q?: string | string[] }>;
}) {
  const { clan: clanParam, month: monthParam, q: queryParam } = await searchParams;
  const query = (Array.isArray(queryParam) ? queryParam[0] : queryParam)?.trim().slice(0, 40) ?? "";

  const family = await loadFamily(monthParam);
  if (family.kind === "no-clan") {
    return (
      <RatingShell title={TITLE} description={DESCRIPTION}>
        <Panel>
          <EmptyState
            icon={Trophy}
            title="You are not in a clan yet"
            body="There is nothing to rate until a leader adds you to a clan."
          />
        </Panel>
      </RatingShell>
    );
  }
  if (family.kind === "no-month") {
    return (
      <RatingShell title={TITLE} description={DESCRIPTION}>
        <Panel>
          <EmptyState
            icon={Trophy}
            title="No ranking yet"
            body="The first ranking appears after the next rating update, which runs every 6 hours."
          />
        </Panel>
      </RatingShell>
    );
  }

  const { months, month, everyone, ownIds, mine, isOpen } = family;
  const clans = familyClans(everyone);

  // One clan when asked for; otherwise all of them. An unknown tag is "all".
  const only = clans.find((c) => c.tag === clanParam) ?? null;
  const shown = (only ? everyone.filter((p) => p.clanId === only.id) : everyone).filter((p) =>
    matchesPlayer(p, query),
  );
  const notYet = RATING_KINDS.filter((kind) => everyone.every((p) => p.marks[kind] === 0));

  // Every bar is against the best in the family, so a bar means the same
  // length whichever clan or search is showing.
  const top = Object.fromEntries(
    RATING_KINDS.map((kind) => [kind, topOf(everyone.map((p) => p.shares[kind]))]),
  ) as Record<RatingKind, number>;

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

  const toRow = (p: RatedPlayer): BoardRow =>
    familyRow(p, {
      rank: p.familyRank,
      tied: p.tied,
      medal: hasMarks(p.marks),
      oneClan: only ? { place: p.clanRank, size: p.clanSize } : null,
      mine,
      ownIds,
      rating: { text: ratingPercent(p.rating), value: p.rating },
      cells: Object.fromEntries(
        RATING_KINDS.map((kind) => [
          kind,
          <SectionCell key={kind} player={p} kind={kind} top={top[kind]} idle={notYet.includes(kind)} />,
        ]),
      ),
    });

  const rows = shown.map(toRow);
  const columns: BoardColumn[] = RATING_KINDS.map((kind) => ({
    key: kind,
    label: RATING_SHORT_LABELS[kind],
    sub: <span className="cb-weight">{RATING_WEIGHTS[kind]}%</span>,
    dim: notYet.includes(kind),
    title: notYet.includes(kind) ? "Nothing counted yet this month" : undefined,
  }));

  // The bubble lists every own village in the month, whatever the filter shows.
  const dock = dockEntries(
    everyone.filter((p) => ownIds.has(p.playerId)).map(toRow),
    (row) => {
      const p = everyone.find((q) => q.playerId === row.key)!;
      return `#${p.familyRank} of ${p.familySize} in the family${p.tied ? ", tied" : ""} · #${p.clanRank} of ${p.clanSize} in ${p.clanName}`;
    },
    (row) => `${here({ clan: null, q: null })}#${row.anchorId}`,
  );

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
    <RatingShell
      title={TITLE}
      description={DESCRIPTION}
      dock={dock.length > 0 && <RankDock title={seasonLabel(month)} entries={dock} />}
    >
      <Panel aria-labelledby="ranking-title" className="space-y-4">
        <div className="space-y-1">
          <SectionHeader
            id="ranking-title"
            title={`${seasonLabel(month)}${isOpen ? ", so far" : ", final"}`}
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

        <RatingToolbar
          months={months.map((m) => ({ href: here({ month: m }), label: seasonLabel(m), active: m === month }))}
          clans={clanChoices(clans, everyone.length, only, (tag) => here({ clan: tag }))}
          search={searchForm}
        />

        <Podium rows={query ? [] : podiumRows(rows)} />

        {rows.length === 0 ? (
          <p className="text-muted-foreground rounded-panel border border-dashed p-6 text-center text-sm">
            No player matches &ldquo;{query}&rdquo; here.{" "}
            <Link className="text-foreground underline underline-offset-2" href={here({ clan: null, q: null })}>
              Show everyone
            </Link>
          </p>
        ) : (
          <Leaderboard
            rows={rows}
            columns={columns}
            ratingTop={topOf(everyone.map((p) => p.rating))}
            showClan={!only}
          />
        )}
      </Panel>

      <Rules />
    </RatingShell>
  );
}
