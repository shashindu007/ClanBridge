// A player's rank, worded and drawn one way on Home, the profile and /rating.
//
// PRESENTATION ONLY, and safe in the browser: components/base-carousel.tsx renders
// the Home form, so nothing here may import a repository. Which month to lead
// with, and what to say, is services/player-rank.ts.
//
// A MEDAL IS A COLOUR ON A NUMBER, never instead of one, so rank still reads with
// no colour at all. Status colours stay reserved: medals are the same three as the
// section ratings'.

import Link from "next/link";
import { History, Trophy } from "lucide-react";
import { Disclosure } from "@/components/kit";
import { Badge } from "@/components/ui/badge";
import { RATING_SECTIONS, RATING_SHORT_LABELS, rankAnchor, ratingPercent } from "@/lib/rating";
import { seasonLabel } from "@/lib/roster-view";
import { cn } from "@/lib/utils";
import type { RankHistoryRow, Standing } from "@/services/player-rank";

/** Gold, silver, bronze for the top three, as on the section ratings. */
const MEDAL = ["#f5c542", "#c0c7d1", "#cd8a4b"];

const medalColour = (rank: number): string | undefined => MEDAL[rank - 1];

/** Straight to this player's row, in the month being talked about. */
export function rankHref(month: string, tag: string): string {
  return `/rating?month=${encodeURIComponent(month)}#${rankAnchor(tag)}`;
}

const finality = (open: boolean) => (open ? "so far" : "final");

/** The rank column on /rating. A place with no marks behind it earns no medal. */
export function RankMedal({ rank, medal = true }: { rank: number; medal?: boolean }) {
  const colour = medal ? medalColour(rank) : undefined;
  return colour ? (
    <span
      className="inline-flex size-7 items-center justify-center rounded-full text-sm font-bold text-black"
      style={{ background: colour }}
    >
      {rank}
    </span>
  ) : (
    <span className="text-muted-foreground text-sm tabular-nums">{rank}</span>
  );
}

/** Each state that is not a rank, as one sentence. */
function notRankedText(standing: Exclude<Standing, { kind: "ranked" }>): string {
  switch (standing.kind) {
    case "failed":
      return "Rank could not be loaded. Try again in a moment.";
    case "not-ranked":
      return "Not ranked yet. Rankings update every 6 hours.";
    case "no-marks":
      return `No marks yet for ${seasonLabel(standing.month)}.`;
  }
}

function RankIcon({ rank }: { rank: number }) {
  const colour = medalColour(rank);
  return (
    <Trophy
      aria-hidden
      className={cn("size-4 shrink-0", !colour && "text-muted-foreground")}
      style={colour ? { color: colour } : undefined}
    />
  );
}

/**
 * Home's base card: the rank as the headline, then what it is made of. The same
 * facts as RankSummary, sized for a side panel rather than a page.
 */
export function HomeRank({
  standing,
  tag,
  showClan,
}: {
  standing: Standing;
  tag: string;
  /** False for a clan this viewer holds no role in. */
  showClan: boolean;
}) {
  if (standing.kind !== "ranked") {
    return (
      <div className="space-y-1">
        <h3 className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium uppercase">
          <Trophy aria-hidden className="size-3.5" />
          Player rank
        </h3>
        <p className="text-sm">{notRankedText(standing)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <h3 className="text-muted-foreground text-xs font-medium uppercase">
            Player rank · {seasonLabel(standing.month)}, {finality(standing.open)}
          </h3>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RankIcon rank={standing.familyRank} />
            <span
              className="cb-title text-4xl leading-none tabular-nums"
              style={medalColour(standing.familyRank) ? { color: medalColour(standing.familyRank) } : undefined}
            >
              #{standing.familyRank}
            </span>
            <span className="text-muted-foreground text-sm">of {standing.familySize} in the family</span>
            {standing.tied && <Badge variant="outline">Tied</Badge>}
          </p>
          {showClan && (
            <p className="truncate text-sm tabular-nums">
              #{standing.clanRank} of {standing.clanSize} in {standing.clanName}
            </p>
          )}
          {standing.movement && <p className="text-muted-foreground text-xs">{standing.movement}</p>}
        </div>
        <p className="shrink-0 text-right">
          <span className="cb-title block text-2xl leading-none tabular-nums">{ratingPercent(standing.rating)}</span>
          <span className="text-muted-foreground text-xs">rating</span>
        </p>
      </div>

      <dl className="grid grid-cols-5 gap-1 border-t pt-2.5 text-center">
        {RATING_SECTIONS.map(({ kind }) => (
          <div key={kind} className="min-w-0">
            <dt className="text-muted-foreground truncate text-[0.6875rem]">{RATING_SHORT_LABELS[kind]}</dt>
            <dd className="text-xs font-semibold tabular-nums">{ratingPercent(standing.shares[kind])}</dd>
          </div>
        ))}
      </dl>

      <Link
        href={rankHref(standing.month, tag)}
        className="text-primary inline-flex min-h-11 items-center text-sm font-medium hover:underline"
      >
        See the full ranking
      </Link>
    </div>
  );
}

/** The whole answer, for the top of a profile. */
export function RankSummary({
  standing,
  tag,
  showClan,
}: {
  standing: Standing;
  tag: string;
  showClan: boolean;
}) {
  if (standing.kind !== "ranked") {
    return (
      <div className="space-y-1">
        <h2 className="text-muted-foreground text-xs font-medium uppercase">Player rank</h2>
        <p className="text-sm">{notRankedText(standing)}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 space-y-1">
          <h2 className="text-muted-foreground text-xs font-medium uppercase">
            Player rank · {seasonLabel(standing.month)}, {finality(standing.open)}
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <RankIcon rank={standing.familyRank} />
            <span className="cb-title text-3xl tabular-nums">#{standing.familyRank}</span>
            <span className="text-muted-foreground text-sm">of {standing.familySize} in the family</span>
            {standing.tied && <Badge variant="outline">Tied</Badge>}
          </p>
          {showClan && (
            <p className="text-sm tabular-nums">
              #{standing.clanRank} of {standing.clanSize} in {standing.clanName}
            </p>
          )}
          {standing.movement && <p className="text-muted-foreground text-sm">{standing.movement}</p>}
        </div>
        <p className="text-right">
          <span className="cb-title block text-2xl tabular-nums">{ratingPercent(standing.rating)}</span>
          <span className="text-muted-foreground text-xs">rating</span>
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
        {RATING_SECTIONS.map(({ kind }) => (
          <div key={kind}>
            <dt className="text-muted-foreground text-xs">{RATING_SHORT_LABELS[kind]}</dt>
            <dd className="font-medium tabular-nums">{ratingPercent(standing.shares[kind])}</dd>
          </div>
        ))}
      </dl>

      <Link
        href={rankHref(standing.month, tag)}
        className="text-primary inline-flex min-h-11 items-center text-sm font-medium hover:underline"
      >
        See the full ranking
      </Link>
    </div>
  );
}

/** A list, not a chart: it reads the same on a phone and to a screen reader. */
export function RankHistory({ rows }: { rows: RankHistoryRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Disclosure title="Rank history" icon={History} count={rows.length}>
      <ol className="divide-y text-sm">
        {rows.map((row) => (
          <li key={row.month} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
            <span>
              {seasonLabel(row.month)}
              <span className="text-muted-foreground">, {finality(row.open)}</span>
            </span>
            <span className="tabular-nums">
              <span className="font-semibold">#{row.familyRank}</span>
              <span className="text-muted-foreground">
                {" "}
                of {row.familySize}
                {row.tied && ", tied"} · {ratingPercent(row.rating)}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}
