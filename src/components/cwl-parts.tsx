// The CWL pages' shared pieces: the coloured day strip, the season's tab row,
// the group table and the live-day panel. Server components, no state — the
// only moving part is the Countdown inside the live panel.
//
// Colour is never the only signal. Every pill and tab has its day number and
// an accessible name that says the result in words ("Day 3: won"), and the
// standings row for this clan is marked "You" as well as highlighted.

import Link from "next/link";
import { Clock, Crown, FileDown, Medal, Star, Swords, Trophy } from "lucide-react";
import { Countdown } from "@/components/countdown";
import { LocalTime } from "@/components/local-time";
import { ClanBadge } from "@/components/game/clan-badge";
import { GameArt } from "@/components/game/game-art";
import { TownHall } from "@/components/game/town-hall";
import { Button } from "@/components/ui/button";
import type { CwlWar } from "@/repositories/cwl";
import type { Standing } from "@/services/cwl-standings";
import type { StandingScout } from "@/services/cwl-scouting";
import type { SideAttacks } from "@/services/cwl-day";
import type { LineupBreakdown } from "@/lib/roster-view";
import { artKeyForLeague } from "@/lib/game-art";
import { DAY_TONE_CLASS, DAY_TONE_LABEL, dayTone, ordinal } from "@/lib/war-status";
import { cn } from "@/lib/utils";

export function LeagueArt({ league, size }: { league: string | null; size: number }) {
  return (
    <GameArt
      art={artKeyForLeague(league)}
      size={size}
      alt=""
      fallback={<Trophy aria-hidden className="text-muted-foreground shrink-0" style={{ width: size * 0.6, height: size * 0.6 }} />}
    />
  );
}

/**
 * Seven pills, one per war day, coloured by result. Days not yet recorded are
 * drawn as empty pills so the strip always reads as "a week".
 */
export function DayStrip({
  wars,
  hrefFor,
  total = 7,
  size = "md",
}: {
  wars: CwlWar[];
  hrefFor?: (war: CwlWar) => string;
  total?: number;
  size?: "sm" | "md";
}) {
  const byDay = new Map(wars.filter((w) => w.dayNumber !== null).map((w) => [w.dayNumber!, w]));
  const days = Array.from({ length: Math.max(total, wars.length) }, (_, i) => i + 1);
  const box = size === "sm" ? "size-6 text-[0.6875rem]" : "size-8 text-xs";

  return (
    <ol className="flex flex-wrap gap-1.5" aria-label="War days">
      {days.map((day) => {
        const war = byDay.get(day);
        const tone = war ? dayTone(war.result, war.state) : "pending";
        const label = `Day ${day}: ${DAY_TONE_LABEL[tone].toLowerCase()}`;
        const pill = (
          <span
            className={cn(
              "inline-flex items-center justify-center rounded-chip font-bold tabular-nums",
              box,
              war ? DAY_TONE_CLASS[tone].solid : "border border-dashed text-muted-foreground",
              tone === "live" && "animate-pulse",
            )}
          >
            {day}
          </span>
        );
        return (
          <li key={day} title={label} aria-label={label}>
            {war && hrefFor ? (
              <Link href={hrefFor(war)} className="block rounded-chip transition-transform hover:-translate-y-0.5">
                {pill}
              </Link>
            ) : (
              pill
            )}
          </li>
        );
      })}
    </ol>
  );
}

export type SeasonTab = "days" | "standings" | "medals" | "report";

/** The season's own tab row, and the leadership-only PDF button beside it. */
export function SeasonNav({
  base,
  active,
  canPrint,
}: {
  base: string;
  active: SeasonTab;
  canPrint: boolean;
}) {
  const tabs: Array<{ key: SeasonTab; label: string; href: string }> = [
    { key: "days", label: "Days", href: base },
    { key: "standings", label: "Standings", href: `${base}/standings` },
    { key: "medals", label: "Medals", href: `${base}/medals` },
    { key: "report", label: "Report", href: `${base}/report` },
  ];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <nav aria-label="This season" className="bg-muted/60 flex gap-1 rounded-control p-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={tab.key === active ? "page" : undefined}
            className={cn(
              "rounded-chip px-3 py-1.5 text-sm font-medium transition-colors",
              tab.key === active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {canPrint && (
        <Button asChild variant="outline" size="sm">
          <Link href={`${base}/report/print`}>
            <FileDown aria-hidden />
            Monthly report (PDF)
          </Link>
        </Button>
      )}
    </div>
  );
}

const PODIUM = ["var(--gold)", "oklch(0.78 0.02 250)", "oklch(0.62 0.1 55)"];

/**
 * "TH18 ×5 · TH17 ×8 · +2" — the top of a roster's Town Halls in a table cell.
 * The full mix is on the clan's own page; three levels say who the clan is.
 */
export function ThMix({ breakdown, limit = 3 }: { breakdown: LineupBreakdown; limit?: number }) {
  if (breakdown.total === 0) return <span className="text-muted-foreground text-xs">—</span>;
  const shown = breakdown.levels.slice(0, limit);
  const rest = breakdown.levels.slice(limit).reduce((t, l) => t + l.count, 0);
  return (
    <span
      className="flex flex-wrap items-center gap-1"
      aria-label={breakdown.levels.map((l) => `${l.count} at Town Hall ${l.level}`).join(", ")}
    >
      {shown.map(({ level, count }) => (
        <span key={level} className="bg-muted/60 inline-flex items-center gap-0.5 rounded-chip border py-0.5 pr-1.5 pl-0.5">
          <TownHall level={level} />
          <span className="text-xs font-semibold tabular-nums">×{count}</span>
        </span>
      ))}
      {rest > 0 && <span className="text-muted-foreground text-xs tabular-nums">+{rest}</span>}
    </span>
  );
}

/** The group table: eight clans, this one highlighted and labelled. */
export function StandingsTable({
  standings,
  compact = false,
  scout,
  hrefFor,
}: {
  standings: Standing[];
  compact?: boolean;
  /** Scouting per clan tag (057). Adds the Town Hall and heroes columns. */
  scout?: ReadonlyMap<string, StandingScout>;
  /** Where a clan's name links to — its scouting page. */
  hrefFor?: (tag: string) => string;
}) {
  return (
    <div className="-mx-5 overflow-x-auto px-5">
      <table className={cn("w-full text-sm", scout ? "min-w-[50rem]" : "min-w-[34rem]")}>
        <thead className="text-muted-foreground border-b text-left text-xs uppercase">
          <tr>
            <th className="py-2 pr-3 font-medium">#</th>
            <th className="py-2 pr-3 font-medium">Clan</th>
            {scout && <th className="py-2 pr-3 font-medium">Town Halls</th>}
            {scout && (
              <th className="py-2 pr-3 text-right font-medium" title="Average heroes against each village's Town Hall max">
                Heroes
              </th>
            )}
            {scout && (
              <th
                className="py-2 pr-3 text-right font-medium"
                title="How their bases hold up: average destruction each attack against them took, and how many were 3-starred"
              >
                Defence
              </th>
            )}
            <th className="py-2 pr-3 text-right font-medium">W–L–D</th>
            <th className="py-2 pr-3 text-right font-medium">
              <span className="inline-flex items-center gap-1">
                <Star aria-hidden className="fill-trim text-trim size-3.5" />
                Stars
              </span>
            </th>
            <th className="py-2 text-right font-medium">Destruction</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s) => {
            const scouted = scout?.get(s.tag);
            const href = hrefFor?.(s.tag);
            return (
              <tr
                key={s.tag}
                className={cn(
                  "border-b last:border-0",
                  s.isUs && "bg-primary/10 font-semibold",
                )}
              >
                <td className="py-2.5 pr-3">
                  <span
                    className="cb-title inline-flex size-7 items-center justify-center rounded-full text-sm tabular-nums"
                    style={
                      s.rank <= 3
                        ? { background: PODIUM[s.rank - 1], color: "oklch(0.2 0.03 60)" }
                        : undefined
                    }
                  >
                    {s.rank}
                  </span>
                </td>
                <td className="py-2.5 pr-3">
                  <span className="flex min-w-0 items-center gap-2">
                    <ClanBadge src={s.badgeUrl} name={s.name} size="sm" tone={s.isUs ? "var(--primary)" : "var(--foe)"} />
                    {href ? (
                      <Link href={href} className="truncate underline-offset-2 hover:underline">
                        {s.name}
                      </Link>
                    ) : (
                      <span className="truncate">{s.name}</span>
                    )}
                    {s.isUs && (
                      <span className="bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 text-[0.625rem] font-bold uppercase">
                        You
                      </span>
                    )}
                  </span>
                </td>
                {scout && (
                  <td className="py-2.5 pr-3 font-normal">
                    {scouted ? <ThMix breakdown={scouted.roster} /> : <span className="text-muted-foreground text-xs">—</span>}
                  </td>
                )}
                {scout && (
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {scouted?.avgHeroPct != null ? `${Math.round(scouted.avgHeroPct)}%` : "—"}
                    {scouted && scouted.weakPoints > 0 && (
                      <span className="text-muted-foreground block text-[0.6875rem] font-normal">
                        {scouted.weakPoints} weak point{scouted.weakPoints === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                )}
                {scout && (
                  <td className="py-2.5 pr-3 text-right tabular-nums">
                    {scouted?.avgDestructionAgainst != null ? (
                      <>
                        {Math.round(scouted.avgDestructionAgainst)}%
                        <span className="text-muted-foreground block text-[0.6875rem] font-normal">
                          {scouted.tripledAgainst} of {scouted.defences} hits 3★
                        </span>
                      </>
                    ) : (
                      <span title="Not attacked yet">—</span>
                    )}
                  </td>
                )}
                <td className="py-2.5 pr-3 text-right tabular-nums">
                  {s.wins}–{s.losses}–{s.ties}
                </td>
                <td className="py-2.5 pr-3 text-right tabular-nums">
                  {s.stars}
                  {!compact && s.wins > 0 && (
                    <span className="text-muted-foreground block text-[0.6875rem] font-normal">
                      {s.attackStars} + {s.wins * 10} bonus
                    </span>
                  )}
                </td>
                <td className="py-2.5 text-right tabular-nums">{s.destruction.toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "3rd of 8", with a crown for first. */
export function RankBadge({ rank, of, final }: { rank: number; of: number; final: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {rank === 1 && <Crown aria-hidden className="text-gold size-5" />}
      <span className="cb-title text-2xl tabular-nums">{ordinal(rank)}</span>
      <span className="text-muted-foreground text-sm">
        of {of}
        {final ? "" : " so far"}
      </span>
    </span>
  );
}

/**
 * One side's attacks: used, out of how many, and how many are still to come.
 * "Not recorded" rather than a zero when the count is not known — a zero reads
 * as "nobody has attacked".
 */
function AttackTally({ label, side }: { label: string; side: SideAttacks }) {
  const left = side.used !== null && side.of !== null ? Math.max(0, side.of - side.used) : null;
  return (
    <div className="bg-card/70 rounded-control p-3">
      <dt className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Swords aria-hidden className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </dt>
      <dd>
        <span className="cb-title text-2xl tabular-nums">
          {side.used ?? "—"} <span className="text-muted-foreground text-base">/ {side.of ?? "?"}</span>
        </span>
        <span className="text-muted-foreground block text-xs">
          {left === null ? "Not recorded" : left === 0 ? "All attacks used" : `${left} still to attack`}
        </span>
      </dd>
    </div>
  );
}

/**
 * The day being fought now: "Stars 23 vs 19", when it ends, how long is left,
 * and how many attacks EACH side has used. The biggest thing on the page during
 * CWL week, because it is the only part of it that changes by the minute.
 *
 * Both sides' attacks, not ours alone: 16 stars to 8 means one thing when the
 * enemy has used 4 of 15 and another when they have used 14.
 */
export function LiveDayPanel({
  war,
  clanName,
  ours: ourAttacks,
  theirs: theirAttacks,
}: {
  war: CwlWar;
  clanName: string;
  ours: SideAttacks;
  theirs: SideAttacks;
}) {
  const ours = war.ourStars ?? 0;
  const theirs = war.theirStars ?? 0;
  const ahead = ours > theirs || (ours === theirs && (war.ourDestruction ?? 0) > (war.theirDestruction ?? 0));
  const level = ours === theirs && (war.ourDestruction ?? 0) === (war.theirDestruction ?? 0);

  return (
    <section
      aria-label="Battle day in progress"
      className="border-warning/70 bg-warning-tint/60 relative overflow-hidden rounded-panel border-2 p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="bg-warning text-gold-ink inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold tracking-wide uppercase">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-current" />
          Ongoing · Day {war.dayNumber ?? "?"}
        </span>
        <span className="text-warning-ink text-sm font-semibold">
          {level ? "Level" : ahead ? "We are ahead" : "We are behind"}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground truncate text-xs font-medium">{clanName}</p>
          <p className="flex items-center gap-1.5">
            <Star aria-hidden className="fill-trim text-trim-shade size-7" />
            <span className="cb-title text-4xl tabular-nums sm:text-5xl">{ours}</span>
          </p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {(war.ourDestruction ?? 0).toFixed(1)}% destroyed
          </p>
        </div>
        <span className="cb-title text-muted-foreground text-lg">vs</span>
        <div className="min-w-0 text-right">
          <p className="text-muted-foreground truncate text-xs font-medium">
            {war.opponentName ?? war.opponentTag ?? "Opponent"}
          </p>
          <p className="flex items-center justify-end gap-1.5">
            <span className="cb-title text-4xl tabular-nums sm:text-5xl">{theirs}</span>
            <Star aria-hidden className="fill-foe/70 text-foe size-7" />
          </p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {(war.theirDestruction ?? 0).toFixed(1)}% destroyed
          </p>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="bg-card/70 col-span-2 rounded-control p-3 sm:col-span-1">
          <dt className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
            <Clock aria-hidden className="size-3.5" />
            Time remaining
          </dt>
          <dd className="cb-title text-2xl">
            <Countdown iso={war.endTime} />
          </dd>
        </div>
        <div className="bg-card/70 col-span-2 rounded-control p-3 sm:col-span-1">
          <dt className="text-muted-foreground text-xs font-medium">Ends at</dt>
          <dd className="text-lg font-semibold">
            <LocalTime iso={war.endTime} style="weekday" />
          </dd>
        </div>
        <AttackTally label="Our attacks" side={ourAttacks} />
        <AttackTally label="Enemy attacks" side={theirAttacks} />
      </dl>
    </section>
  );
}

/** A compact medal summary line, for tiles. */
export function MedalHint({ perFull, bonus }: { perFull: number; bonus: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <Medal aria-hidden className="text-gold size-4" />
      <span className="font-semibold tabular-nums">up to {perFull}</span>
      <span className="text-muted-foreground">medals each · {bonus} bonus</span>
    </span>
  );
}
