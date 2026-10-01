// The CWL lineup's player details, shared by the builder, its "Add players"
// dialog, the members' read-only view and the export sheet — so a player reads
// the same wherever a leader meets them:
//
//   Town Hall · heroes (BK 95, AQ 95 …) · % of max · the last three CWLs
//
// Server components. The only interactive part is each card's Remove form,
// which posts to the page's own server action.

import Link from "next/link";
import { ActionForm, type ResultAction } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { TownHall } from "@/components/game/town-hall";
import type { HeroLevel } from "@/repositories/player-progress";
import { cn } from "@/lib/utils";
import { lineupBreakdown, type LineupBase, type LineupBreakdown } from "@/lib/roster-view";

export interface CwlSeasonLine {
  season: string;
  clanName: string;
  stars: number;
  attacksUsed: number;
  warsRostered: number;
}

/** "BK 95  AQ 95  GW 70" — maxed heroes in gold. */
export function HeroLevels({ heroes, compact = false }: { heroes: HeroLevel[]; compact?: boolean }) {
  if (heroes.length === 0) return <span className="text-muted-foreground text-xs">No hero data</span>;
  return (
    <span className="flex flex-wrap gap-1" aria-label="Hero levels">
      {heroes.map((h) => {
        const maxed = h.level >= h.cap;
        return (
          <span
            key={h.short}
            title={`${h.name} ${h.level} of ${h.cap}`}
            className={cn(
              "inline-flex items-baseline gap-0.5 rounded-chip border px-1.5 py-0.5 text-[0.6875rem] leading-none tabular-nums",
              maxed ? "border-gold/60 bg-gold/15 font-bold" : "bg-muted/60",
            )}
          >
            <span className="text-muted-foreground font-semibold">{h.short}</span>
            {h.level}
            {!compact && !maxed && <span className="text-muted-foreground">/{h.cap}</span>}
          </span>
        );
      })}
    </span>
  );
}

/** A percentage towards this Town Hall's caps, as a bar and a number. */
export function MaxPct({ pct, label = "of max" }: { pct: number | null; label?: string }) {
  if (pct === null) return <span className="text-muted-foreground text-xs">—</span>;
  const tone = pct >= 95 ? "var(--success)" : pct >= 80 ? "var(--info)" : "var(--warning)";
  return (
    <span className="flex items-center gap-2" title={`${pct.toFixed(1)}% ${label}`}>
      <span className="cb-gauge h-1.5 w-14" style={{ "--gauge": tone } as React.CSSProperties}>
        <span style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="text-xs font-semibold tabular-nums">{Math.round(pct)}%</span>
    </span>
  );
}

/** "2026-09" -> "Sep ’26". */
function shortSeason(season: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(season);
  if (!match) return season;
  const month = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)).toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  return `${month} ’${match[1]!.slice(2)}`;
}

/**
 * The last few CWLs: "Sep ’26 21★ 7/7", a missed attack in red. The clan is
 * named when it differs from `ownClanName`, or on every line with `showClan`
 * (the lineup cards, where there is no "own" clan to compare with).
 */
export function CwlHistoryChips({
  seasons,
  ownClanName,
  showClan = false,
}: {
  seasons: CwlSeasonLine[];
  ownClanName?: string;
  showClan?: boolean;
}) {
  if (seasons.length === 0) return <span className="text-muted-foreground text-xs">No CWL yet</span>;
  return (
    <ul className="min-w-0 space-y-0.5">
      {seasons.map((s) => {
        const missed = s.warsRostered - s.attacksUsed;
        const namedClan = showClan || (ownClanName !== undefined && s.clanName !== ownClanName);
        return (
          <li
            key={`${s.season}-${s.clanName}`}
            className={cn("text-xs leading-tight tabular-nums", showClan && "truncate")}
            title={showClan ? `${shortSeason(s.season)} in ${s.clanName}: ${s.stars}★, ${s.attacksUsed} of ${s.warsRostered} attacks` : undefined}
          >
            <span className="text-muted-foreground">{shortSeason(s.season)}</span>{" "}
            <span className="font-semibold">{s.stars}★</span>{" "}
            <span className={missed > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>
              {s.attacksUsed}/{s.warsRostered}
            </span>
            {namedClan && <span className="text-muted-foreground"> · {s.clanName}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export interface LineupCardPlayer {
  playerId: string;
  tag: string;
  name: string;
  clanName: string | null;
  thLevel: number | null;
  heroes: HeroLevel[];
  maxPct: number | null;
  heroPct: number | null;
  history: CwlSeasonLine[];
}

/** One picked player, as a card in the lineup grid. */
export function LineupCard({
  index,
  player,
  remove,
}: {
  index: number;
  player: LineupCardPlayer;
  /** The Remove form, when the viewer may edit. */
  remove?: { action: ResultAction; hidden: Record<string, string> };
}) {
  return (
    <li className="bg-tile print-avoid-break flex min-w-0 flex-col gap-2 rounded-panel border p-3">
      <div className="flex items-start gap-3">
        <span className="bg-primary text-primary-foreground cb-title inline-flex size-7 shrink-0 items-center justify-center rounded-full text-sm">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold" title={player.name}>
            {player.name}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {player.clanName ? `${player.clanName} · ` : ""}
            <span className="font-mono">{player.tag}</span>
          </p>
        </div>
        <TownHall level={player.thLevel} size="sm" />
      </div>
      <HeroLevels heroes={player.heroes} compact />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Max</span>
          <MaxPct pct={player.maxPct} />
        </span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className="text-muted-foreground">Heroes</span>
          <MaxPct pct={player.heroPct} label="of hero max" />
        </span>
      </div>
      <div className="mt-auto flex items-end justify-between gap-2 border-t pt-2">
        <CwlHistoryChips seasons={player.history.slice(0, 2)} showClan />
      {remove && (
        <ActionForm
          action={remove.action}
          hidden={{ ...remove.hidden, action: "remove", playerId: player.playerId }}
          className="shrink-0"
        >
          <SubmitButton
            size="xs"
            variant="ghost"
            pendingLabel="Removing"
            aria-label={`Remove ${player.name} from the lineup`}
          >
            Remove
          </SubmitButton>
        </ActionForm>
      )}
      </div>
    </li>
  );
}

/** "[TH18] ×3  [TH17] ×5" — a lineup's Town Halls, highest first. */
export function ThBreakdown({ breakdown }: { breakdown: LineupBreakdown }) {
  if (breakdown.total === 0) return <span className="text-muted-foreground text-xs">Nobody picked yet</span>;
  return (
    <span className="flex flex-wrap items-center gap-2" aria-label="Town Halls in this lineup">
      {breakdown.levels.map(({ level, count }) => (
        <span key={level} className="bg-muted/60 inline-flex items-center gap-1 rounded-chip border py-0.5 pr-2 pl-1">
          <TownHall level={level} />
          <span className="text-sm font-semibold tabular-nums">×{count}</span>
        </span>
      ))}
      {breakdown.unknown > 0 && (
        <span className="text-muted-foreground text-xs tabular-nums">{breakdown.unknown} TH not known</span>
      )}
    </span>
  );
}

export interface LineupSummaryRow {
  key: string;
  name: string;
  slots: number;
  players: LineupBase[];
  href?: string;
  active?: boolean;
}

const avg = (value: number | null, digits = 0) => (value === null ? "—" : value.toFixed(digits));

/**
 * Every lineup side by side: how many of each Town Hall each clan has picked,
 * and the same for all of them together — the whole season on one table.
 */
export function LineupSummary({ rows }: { rows: LineupSummaryRow[] }) {
  const perRow = rows.map((row) => ({ row, breakdown: lineupBreakdown(row.players) }));
  const overall = lineupBreakdown(rows.flatMap((r) => r.players));
  const slots = rows.reduce((t, r) => t + r.slots, 0);
  const levels = overall.levels.map((l) => l.level);
  const countAt = (b: LineupBreakdown, level: number) => b.levels.find((l) => l.level === level)?.count ?? 0;
  const many = rows.length > 1;

  const cells = (b: LineupBreakdown) => (
    <>
      {levels.map((level) => {
        const n = countAt(b, level);
        return (
          <td key={level} className={cn("px-2 py-2 text-center tabular-nums", n === 0 && "text-muted-foreground/50")}>
            {n || "·"}
          </td>
        );
      })}
      {overall.unknown > 0 && <td className="px-2 py-2 text-center tabular-nums">{b.unknown || "·"}</td>}
      <td className="px-2 py-2 text-right tabular-nums">{avg(b.avgTh, 1)}</td>
      <td className="px-2 py-2 text-right tabular-nums">{b.avgHeroPct === null ? "—" : `${avg(b.avgHeroPct)}%`}</td>
      <td className="px-2 py-2 text-right tabular-nums">{b.avgMaxPct === null ? "—" : `${avg(b.avgMaxPct)}%`}</td>
    </>
  );

  return (
    <section aria-label="Lineup summary" className="cb-panel space-y-3 rounded-panel border p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Lineup summary</h2>
        <p className="text-muted-foreground text-xs">
          Town Halls picked {many ? "in each clan's lineup and across all of them" : "in this lineup"}, highest
          first. Lineups are listed in war order — strongest base at #1.
        </p>
      </div>
      {overall.total > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="font-medium tabular-nums">
            {many ? "All lineups" : "Total"} · {overall.total} of {slots}
          </span>
          <ThBreakdown breakdown={overall} />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="text-muted-foreground border-b text-xs uppercase">
            <tr>
              <th className="py-2 pr-3 text-left font-medium">Clan</th>
              <th className="px-2 py-2 text-right font-medium">Picked</th>
              {levels.map((level) => (
                <th key={level} className="px-2 py-2 text-center font-medium">
                  TH{level}
                </th>
              ))}
              {overall.unknown > 0 && <th className="px-2 py-2 text-center font-medium">TH ?</th>}
              <th className="px-2 py-2 text-right font-medium">Avg TH</th>
              <th className="px-2 py-2 text-right font-medium">Heroes</th>
              <th className="px-2 py-2 text-right font-medium">Max</th>
            </tr>
          </thead>
          <tbody>
            {perRow.map(({ row, breakdown }) => (
              <tr key={row.key} className={cn("border-b", row.active && "bg-primary/10")}>
                <td className="py-2 pr-3 font-medium">
                  {row.href && !row.active ? (
                    <Link href={row.href} className="underline-offset-2 hover:underline">
                      {row.name}
                    </Link>
                  ) : (
                    row.name
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {breakdown.total}/{row.slots}
                </td>
                {cells(breakdown)}
              </tr>
            ))}
            {many && (
              <tr className="font-semibold">
                <td className="py-2 pr-3">All lineups</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {overall.total}/{slots}
                </td>
                {cells(overall)}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
