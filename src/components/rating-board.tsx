// Every Player rating page's ranking, drawn one way: the toolbar, the podium,
// the leaderboard, and the bar every share sits on.
//
// PRESENTATION ONLY, and server-safe: no hooks, motion is CSS (globals.css,
// "THE LEADERBOARD"). Each page loads its own section, sorts it its own way
// and hands over BoardRows; nothing here decides who ranks where.
//
// ONE COLUMN ORDER ON EVERY PAGE: # | Player | Rating | the section's own
// numbers. The clan and the Town Hall are inside the Player cell, not columns
// of their own, so the number a member came for sits next to their name
// instead of at the far end of a table that scrolled sideways.
//
// THE PODIUM IS A HIGHLIGHT, NOT THE RANKING. Everyone on it is in the table
// below as well, with the same number, so a screen reader or a narrow phone
// loses nothing by skipping it. Pages leave it out while searching: three
// people who did not match the search would be noise.

import Link from "next/link";
import { Crown } from "lucide-react";
import { TownHall } from "@/components/game/town-hall";
import { RankMedal, medalTier } from "@/components/player-rank";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { clanAccent } from "@/lib/clan-accent";
import { cn } from "@/lib/utils";

/** One player's line in a ranking. */
export interface BoardRow {
  key: string;
  /** For linking straight to the row (rankAnchor()). */
  anchorId?: string;
  /** The # column. */
  rank: number;
  tied?: boolean;
  /** A place with something behind it: earns a medal and a podium step. */
  medal: boolean;
  /** The podium place, when it is not `rank` (one clan of the family ranking). */
  place?: number;
  name: string;
  tag: string;
  /** The profile, or null where the viewer may not open it. */
  href: string | null;
  you: boolean;
  clan: { id: string; name: string; href?: string };
  /** Undefined where the section does not know it; null is "not read yet". */
  thLevel?: number | null;
  /** An extra line under the name: a clan place, in words. */
  note?: React.ReactNode;
  /** The podium's line under the name, where it differs from the clan chip. */
  podiumNote?: React.ReactNode;
  /** `sub` is a line under the number: the unweighed rating, where it is weighed. */
  rating: { text: string; value: number; sub?: React.ReactNode };
  /** The section's own numbers, by column key. */
  cells: Record<string, React.ReactNode>;
}

/** One of a section's own columns. */
export interface BoardColumn {
  key: string;
  label: string;
  /** Under the heading: a weight, a unit. */
  sub?: React.ReactNode;
  title?: string;
  /** Nothing counted in it yet: kept, so columns do not jump about, but faded. */
  dim?: boolean;
}

/** The podium: the top three places with a medal, in place order. */
export function podiumRows(rows: readonly BoardRow[]): BoardRow[] {
  const placeOf = (row: BoardRow) => row.place ?? row.rank;
  return rows
    .filter((row) => row.medal && placeOf(row) <= 3)
    .sort((a, b) => placeOf(a) - placeOf(b))
    .slice(0, 3);
}

// ── Filters ────────────────────────────────────────────────────────────────

export interface ChoiceItem {
  href: string;
  label: string;
  active: boolean;
  count?: number;
  /** A clan's colour. */
  dot?: string;
}

/** One filter: a month, a clan (with its colour), or "All clans". */
export function Choice({ href, active, label, count, dot }: ChoiceItem) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      data-active={active || undefined}
      className={cn("cb-choice min-h-10", dot && "cb-choice-clan")}
      style={dot ? ({ "--chip": dot } as React.CSSProperties) : undefined}
    >
      {dot && <span aria-hidden className="cb-choice-dot" />}
      {label}
      {count !== undefined && <span className="cb-choice-count">{count}</span>}
    </Link>
  );
}

/**
 * The filters, in one well: the month (only when there is more than one to
 * pick) and the search on top, the clans under them.
 */
export function RatingToolbar({
  months = [],
  monthLabel = "Month",
  clans = [],
  search,
  extra,
}: {
  months?: ChoiceItem[];
  monthLabel?: string;
  clans?: ChoiceItem[];
  search?: React.ReactNode;
  /** Right of the clans: a link to one clan's own page. */
  extra?: React.ReactNode;
}) {
  const showMonths = months.length > 1;
  const showClans = clans.length > 1;
  if (!showMonths && !showClans && !search && !extra) return null;

  return (
    <div className="cb-sunken space-y-3 rounded-control p-3">
      {(showMonths || search) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {showMonths && (
            <nav aria-label={monthLabel} className="cb-segment cb-scroll-x flex max-w-full min-w-0 gap-1 [&>*]:shrink-0">
              {months.slice(0, 12).map((m) => (
                <Choice key={m.href} {...m} />
              ))}
            </nav>
          )}
          {search}
        </div>
      )}
      {(showClans || extra) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {showClans && (
            <nav aria-label="Clan" className="flex flex-wrap gap-2">
              {clans.map((c) => (
                <Choice key={c.href} {...c} />
              ))}
            </nav>
          )}
          {extra}
        </div>
      )}
    </div>
  );
}

// ── The podium ─────────────────────────────────────────────────────────────

/** 2-1-3 from `sm` up, the way a podium stands. In rank order on a phone. */
const ORDER: Record<number, string> = { 1: "sm:order-2", 2: "sm:order-1", 3: "sm:order-3" };

function ordinal(place: number): string {
  return place === 1 ? "1st" : place === 2 ? "2nd" : "3rd";
}

export function Podium({ rows }: { rows: BoardRow[] }) {
  if (rows.length === 0) return null;

  return (
    <ol aria-label="Top of the ranking" className="grid items-end gap-3 sm:grid-cols-3">
      {rows.map((row, i) => {
        const place = row.place ?? row.rank;
        return (
          <li
            key={row.key}
            data-place={place}
            data-tier={medalTier(place)}
            className={cn("cb-podium-step cb-rise min-w-0", ORDER[place])}
            style={{ "--i": i, "--row-accent": clanAccent(row.clan.id).color } as React.CSSProperties}
          >
            <div className="cb-plate cb-lift cb-shine flex flex-col items-center gap-2 px-3 pt-4 pb-3 text-center">
              {place === 1 ? (
                <Crown aria-hidden className="cb-crown size-5" />
              ) : (
                <span aria-hidden className="block h-5" />
              )}
              <RankMedal rank={place} size="lg" className={place === 1 ? "cb-glow" : undefined} />
              <div className="flex max-w-full min-w-0 items-center gap-2">
                {row.thLevel !== undefined && <TownHall level={row.thLevel} size="sm" />}
                <p className="min-w-0 text-left">
                  <PlayerName row={row} className="block truncate font-semibold" />
                  <span className="text-muted-foreground block truncate font-mono text-xs">{row.tag}</span>
                </p>
              </div>
              {row.podiumNote ? (
                <span className="text-muted-foreground text-xs tabular-nums">{row.podiumNote}</span>
              ) : (
                <ClanTag clan={row.clan} className="max-w-full" />
              )}
              <p className="leading-none">
                <span className="cb-title cb-pop block text-3xl tabular-nums" style={{ "--i": i + 2 } as React.CSSProperties}>
                  {row.rating.text}
                </span>
                <span className="text-muted-foreground text-xs">rating</span>
              </p>
              {row.you && <Badge variant="secondary">You</Badge>}
            </div>
            <div aria-hidden className="cb-podium-plinth hidden sm:flex">
              <span className="cb-title">{ordinal(place)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── The leaderboard ────────────────────────────────────────────────────────

/** Rows that fade in on load. Past this they are simply there, so a long list does not crawl in. */
const ROWS_ANIMATED = 20;

function PlayerName({ row, className }: { row: BoardRow; className?: string }) {
  return row.href ? (
    <Link href={row.href} className={cn("hover:underline", className)}>
      {row.name}
    </Link>
  ) : (
    <span className={className}>{row.name}</span>
  );
}

function ClanTag({ clan, className }: { clan: BoardRow["clan"]; className?: string }) {
  const inner = (
    <>
      <span aria-hidden className="cb-choice-dot" />
      <span className="truncate">{clan.name}</span>
    </>
  );
  const style = { "--row-accent": clanAccent(clan.id).color } as React.CSSProperties;
  return clan.href ? (
    <Link href={clan.href} className={cn("cb-clan-tag hover:underline", className)} style={style}>
      {inner}
    </Link>
  ) : (
    <span className={cn("cb-clan-tag", className)} style={style}>
      {inner}
    </span>
  );
}

export function Leaderboard({
  rows,
  columns,
  ratingTop,
  ratingLabel = "Rating",
  ratingTitle,
  showClan = true,
}: {
  rows: BoardRow[];
  columns: BoardColumn[];
  /** The best rating shown, for the bars. */
  ratingTop: number;
  ratingLabel?: string;
  ratingTitle?: string;
  /** False when one clan is shown: the chip would say the same thing on every row. */
  showClan?: boolean;
}) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <Table className="cb-stack">
        <TableHeader>
          <TableRow>
            <TableHead className="w-14 text-right" title="Rank">
              #
            </TableHead>
            <TableHead>Player</TableHead>
            <TableHead className="text-right" title={ratingTitle}>
              {ratingLabel}
            </TableHead>
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={cn("text-right", column.dim && "opacity-50")}
                title={column.title}
              >
                {column.label}
                {column.sub !== undefined && <span className="block">{column.sub}</span>}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, i) => (
            <TableRow
              key={row.key}
              id={row.anchorId}
              data-you={row.you || undefined}
              className={cn(
                "cb-board-row scroll-mt-24",
                "hover:bg-[color-mix(in_oklch,var(--row-accent)_10%,transparent)]",
                "data-[you]:bg-gold/10 data-[you]:hover:bg-gold/15",
                i < ROWS_ANIMATED && "cb-fade",
              )}
              style={{ "--row-accent": clanAccent(row.clan.id).color, "--i": i } as React.CSSProperties}
            >
              <TableCell data-cell="corner" className="text-right">
                <RankMedal rank={row.rank} medal={row.medal} />
                {row.tied && <span className="text-muted-foreground block text-xs">Tied</span>}
              </TableCell>
              <TableCell data-cell="title">
                <div className="flex min-w-0 items-center gap-3">
                  {row.thLevel !== undefined && <TownHall level={row.thLevel} size="sm" />}
                  <div className="min-w-0">
                    <PlayerName row={row} className="font-medium" />
                    {row.you && (
                      <Badge variant="secondary" className="ml-2">
                        You
                      </Badge>
                    )}
                    <span className="text-muted-foreground block font-mono text-xs">{row.tag}</span>
                    {showClan && <ClanTag clan={row.clan} className="mt-1 max-w-full" />}
                    {row.note && <span className="text-muted-foreground block text-xs tabular-nums">{row.note}</span>}
                  </div>
                </div>
              </TableCell>
              <TableCell data-label={ratingLabel} data-cell="row" className="text-right tabular-nums">
                <span className="cb-title text-lg leading-none">{row.rating.text}</span>
                <ShareBar value={row.rating.value} top={ratingTop} colour="var(--gold)" className="mt-1.5 h-1.5 w-20" />
                {row.rating.sub && (
                  <span className="text-muted-foreground mt-1 block text-xs">{row.rating.sub}</span>
                )}
              </TableCell>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  data-label={column.label}
                  className={cn("text-right tabular-nums", column.dim && "opacity-40")}
                >
                  {row.cells[column.key] ?? "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * A share as a bar under its number, against the best shown. At or below 0
 * there is no bar: the number beside it carries the minus.
 */
export function ShareBar({
  value,
  top,
  className,
  colour,
}: {
  value: number;
  top: number;
  className?: string;
  colour?: string;
}) {
  const width = top > 0 && value > 0 ? Math.max(4, Math.min(100, (value / top) * 100)) : 0;
  return (
    <span aria-hidden className={cn("cb-gauge ml-auto block", className)}>
      <span
        className="cb-bar-fill"
        style={{ width: `${width}%`, ...(colour ? { "--gauge": colour } : {}) } as React.CSSProperties}
      />
    </span>
  );
}

/** The best of a list of numbers, never below 0: the top a bar is drawn against. */
export function topOf(values: readonly number[]): number {
  return values.reduce((best, v) => (v > best ? v : best), 0);
}
