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
// ALL CLANS, OR ONE (?clan=), and a month picker (?month=).
//
// R3 — THE WHOLE FAMILY, ON PURPOSE. 073's family_player_ratings() is the third
// deliberate exception; read its header. A player is linked only in a clan the
// viewer belongs to, because the profile is a 404 anywhere else.
//
// Open to every member. See repositories/player-ratings.ts.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ListChecks, Trophy } from "lucide-react";
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
import { RATING_SECTIONS, type RatingKind } from "@/lib/rating";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { canSeeMemberStats } from "@/lib/visibility";
import { PageHeader } from "@/components/page-header";
import { Disclosure, EmptyState, Panel, SectionHeader } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { RatingNav } from "@/components/rating-nav";
import { RuleList } from "@/components/rating-parts";
import { familyRatings, ratingMonths, type RatedPlayer } from "@/repositories/player-ratings";
import { DONATION_MARKS, RATING_KINDS, RATING_WEIGHTS } from "@/services/player-rating";
import { signed2 } from "@/services/raid-rating";

export const dynamic = "force-dynamic";

/** Gold, silver, bronze for the top three, as on the section ratings. */
const MEDAL = ["#f5c542", "#c0c7d1", "#cd8a4b"];

/** Short, for a table with ten columns. */
const COLUMN: Record<RatingKind, string> = {
  donations: "Donations",
  war: "War",
  cwl: "CWL",
  games: "Games",
  raids: "Raids",
};

/** "0.70%", with a real minus. */
function percent(value: number): string {
  const text = `${Math.abs(value).toFixed(2)}%`;
  return value < 0 ? `−${text}` : text;
}

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
    <TableCell data-label={COLUMN[kind]} className="text-right tabular-nums">
      <span className="text-sm">{percent(player.shares[kind])}</span>
      <span className={cn("block text-xs", marks < 0 ? "text-destructive" : "text-muted-foreground")}>
        {signed2(marks)}
      </span>
    </TableCell>
  );
}

export default async function PlayerRatingPage({
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

  const everyone = await familyRatings(supabase, month);

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
  const rows = only ? everyone.filter((p) => p.clanId === only.id) : everyone;

  const mine = new Set(clans.map((c) => c.id));
  const notYet = RATING_KINDS.filter((kind) => everyone.every((p) => p.marks[kind] === 0));

  const here = (next: { clan?: string | null; month?: string }) => {
    const query = new URLSearchParams();
    const m = next.month ?? month;
    const c = next.clan === undefined ? (only?.tag ?? null) : next.clan;
    if (m !== months[0]) query.set("month", m);
    if (c) query.set("clan", c);
    const text = query.toString();
    return text ? `/rating?${text}` : "/rating";
  };

  return (
    <Shell>
      <Panel aria-labelledby="ranking-title" className="space-y-4">
        <div className="space-y-1">
          <SectionHeader
            id="ranking-title"
            title={`Ranking for ${seasonLabel(month)}`}
            icon={Trophy}
            count={rows.length}
          />
          <p className="text-muted-foreground text-sm">
            Each % is a share of the whole family&apos;s marks, with the marks below it. Updated{" "}
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

        <div className="-mx-5 overflow-x-auto px-5">
          <Table className="cb-stack">
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-right">#</TableHead>
                <TableHead>Member</TableHead>
                {!only && <TableHead>Clan</TableHead>}
                <TableHead className="text-right">TH</TableHead>
                {RATING_KINDS.map((kind) => (
                  <TableHead key={kind} className="text-right">
                    {COLUMN[kind]}
                    <span className="text-muted-foreground block text-xs font-normal">
                      {RATING_WEIGHTS[kind]}%
                    </span>
                  </TableHead>
                ))}
                <TableHead className="text-right">Rating</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((player, index) => (
                <TableRow key={player.playerId}>
                  <TableCell data-cell="corner" className="text-right">
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
                    <span className="text-muted-foreground block font-mono text-xs">{player.tag}</span>
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
                    {percent(player.rating)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>

      <Rules />
    </Shell>
  );
}
