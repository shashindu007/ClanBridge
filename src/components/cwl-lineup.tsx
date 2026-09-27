// The CWL lineup's player details, shared by the builder, its "Add players"
// dialog, the members' read-only view and the export sheet — so a player reads
// the same wherever a leader meets them:
//
//   Town Hall · heroes (BK 95, AQ 95 …) · % of max · the last three CWLs
//
// Server components. The only interactive part is each card's Remove form,
// which posts to the page's own server action.

import { ActionForm, type ResultAction } from "@/components/action-form";
import { SubmitButton } from "@/components/submit-button";
import { TownHall } from "@/components/game/town-hall";
import type { HeroLevel } from "@/repositories/player-progress";
import { cn } from "@/lib/utils";

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

/** The last few CWLs: "Sep ’26 21★ 7/7", a missed attack in red. */
export function CwlHistoryChips({
  seasons,
  ownClanName,
}: {
  seasons: CwlSeasonLine[];
  ownClanName?: string;
}) {
  if (seasons.length === 0) return <span className="text-muted-foreground text-xs">No CWL yet</span>;
  return (
    <ul className="space-y-0.5">
      {seasons.map((s) => {
        const missed = s.warsRostered - s.attacksUsed;
        return (
          <li key={`${s.season}-${s.clanName}`} className="text-xs leading-tight tabular-nums">
            <span className="text-muted-foreground">{shortSeason(s.season)}</span>{" "}
            <span className="font-semibold">{s.stars}★</span>{" "}
            <span className={missed > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}>
              {s.attacksUsed}/{s.warsRostered}
            </span>
            {ownClanName && s.clanName !== ownClanName && (
              <span className="text-muted-foreground"> · {s.clanName}</span>
            )}
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
        <CwlHistoryChips seasons={player.history.slice(0, 2)} />
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
