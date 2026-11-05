// The top of /rating's leaderboard: the podium, and the bar every share sits on.
//
// PRESENTATION ONLY, and server-safe: no hooks, motion is CSS (globals.css,
// "THE LEADERBOARD"). The page decides who stands here and passes it in, so
// the rule that # is always the family rank stays in one place.
//
// THE PODIUM IS A HIGHLIGHT, NOT THE RANKING. Everyone on it is in the table
// below as well, with the same number, so a screen reader or a narrow phone
// loses nothing by skipping it. It is left out while searching: three people
// who did not match the search would be noise.

import Link from "next/link";
import { Crown } from "lucide-react";
import { TownHall } from "@/components/game/town-hall";
import { RankMedal, medalTier } from "@/components/player-rank";
import { Badge } from "@/components/ui/badge";
import { clanAccent } from "@/lib/clan-accent";
import { ratingPercent } from "@/lib/rating";
import { cn } from "@/lib/utils";
import type { RatedPlayer } from "@/repositories/player-ratings";

export interface PodiumEntry {
  player: RatedPlayer;
  /** 1 to 3: the family place, or the clan place when one clan is shown. */
  place: number;
}

/** 2-1-3 from `sm` up, the way a podium stands. In rank order on a phone. */
const ORDER: Record<number, string> = { 1: "sm:order-2", 2: "sm:order-1", 3: "sm:order-3" };

export function Podium({
  entries,
  clanView,
  hrefFor,
  isYou,
}: {
  entries: PodiumEntry[];
  /** One clan is shown: the place is the clan's, and the family rank is said in words. */
  clanView: boolean;
  /** The profile, or null where the viewer may not open it. */
  hrefFor: (player: RatedPlayer) => string | null;
  isYou: (player: RatedPlayer) => boolean;
}) {
  if (entries.length === 0) return null;

  return (
    <ol aria-label="Top of the ranking" className="grid items-end gap-3 sm:grid-cols-3">
      {entries.map(({ player, place }, i) => {
        const href = hrefFor(player);
        const you = isYou(player);
        return (
          <li
            key={player.playerId}
            data-place={place}
            data-tier={medalTier(place)}
            className={cn("cb-podium-step cb-rise min-w-0", ORDER[place])}
            style={{ "--i": i, "--row-accent": clanAccent(player.clanId).color } as React.CSSProperties}
          >
            <div
              className="cb-plate cb-lift cb-shine flex flex-col items-center gap-2 px-3 pt-4 pb-3 text-center"
              style={{ "--plate-accent": "var(--medal)" } as React.CSSProperties}
            >
              {place === 1 ? (
                <Crown aria-hidden className="cb-crown size-5" />
              ) : (
                <span aria-hidden className="block h-5" />
              )}
              <RankMedal rank={place} size="lg" className={place === 1 ? "cb-glow" : undefined} />
              <div className="flex max-w-full min-w-0 items-center gap-2">
                <TownHall level={player.thLevel} size="sm" />
                <p className="min-w-0 text-left">
                  {href ? (
                    <Link href={href} className="block truncate font-semibold hover:underline">
                      {player.name}
                    </Link>
                  ) : (
                    <span className="block truncate font-semibold">{player.name}</span>
                  )}
                  <span className="text-muted-foreground block truncate font-mono text-xs">{player.tag}</span>
                </p>
              </div>
              {clanView ? (
                <span className="text-muted-foreground text-xs tabular-nums">
                  #{player.familyRank} of {player.familySize} in the family
                </span>
              ) : (
                <span className="cb-clan-tag max-w-full">
                  <span aria-hidden className="cb-choice-dot" />
                  <span className="truncate">{player.clanName}</span>
                </span>
              )}
              <p className="leading-none">
                <span className="cb-title cb-pop block text-3xl tabular-nums" style={{ "--i": i + 2 } as React.CSSProperties}>
                  {ratingPercent(player.rating)}
                </span>
                <span className="text-muted-foreground text-xs">rating</span>
              </p>
              {you && <Badge variant="secondary">You</Badge>}
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

function ordinal(place: number): string {
  return place === 1 ? "1st" : place === 2 ? "2nd" : "3rd";
}

/**
 * A share as a bar under its number, against the best in the family. Below 0
 * has no bar: the number beside it carries the minus.
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
