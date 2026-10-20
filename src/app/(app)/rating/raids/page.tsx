// Raids rating — a section of Player rating: every player of the viewer's
// clans over one month of raid weekends, in one ranking.
//
// The rating itself is one clan's month worked out by services/raid-rating.ts.
// A share is always of a player's OWN clan's plus marks in one weekend, so the
// ranking compares how much of their clan's weekends each carried.
//
// ALL CLANS, OR ONE (?clan=), and a month picker (?month=). With one clan the
// page also shows every mark, attack by attack — the rules are only trusted
// when anyone can check their own sum.
//
// Outside [clanTag] because it spans clans, like the war and CWL ratings.
//
// R3 — spanning clans is not the same as not filtering by clan. Each clan's
// weekends are read under that clan's id, over the list visibleClans()
// returned, and every child read takes a season id from that read. RLS on the
// raid tables is auth_clan_ids(), so a member of clan A reads nothing of clan B.

import Link from "next/link";
import { redirect } from "next/navigation";
import { Castle, ListChecks } from "lucide-react";
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
import { loadRaidMonth } from "@/lib/raid-rating-data";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { canSeeMemberStats } from "@/lib/visibility";
import { PageHeader } from "@/components/page-header";
import { Disclosure, EmptyState, Panel, SectionHeader } from "@/components/kit";
import { RatingNav } from "@/components/rating-nav";
import { raidMonthsForClan } from "@/repositories/raids";
import { oneDecimal } from "@/services/cwl-rating";
import {
  LEAGUES,
  RAID_MARKS,
  signed2,
  type PlayerRaidWeekend,
  type RaidWeekendStatus,
} from "@/services/raid-rating";

export const dynamic = "force-dynamic";

/** Gold, silver, bronze for the top three, as on Player rating. */
const MEDAL = ["#f5c542", "#c0c7d1", "#cd8a4b"];

/** Short, for the folded line at phone width; the open section says why. */
const STATUS: Record<RaidWeekendStatus, string> = {
  counted: "Counted",
  provisional: "In progress",
  notRated: "Not rated",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Raids rating"
        back={{ href: "/rating", label: "Player rating" }}
        description="Every player of your clans over a month of raid weekends, rated attack by attack."
      />
      <RatingNav current="raids" />
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

/** "+0.38  Destroyed 38%" — one line of a sum. */
function Line({ label, marks }: { label: string; marks: number }) {
  return (
    <li className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("tabular-nums", marks < 0 && "text-destructive")}>{signed2(marks)}</span>
    </li>
  );
}

/** One player's weekend: every attack with its lines, then the once-a-weekend lines. */
function WeekendSum({ player }: { player: PlayerRaidWeekend }) {
  return (
    <details className="group border-b py-2 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="font-medium">{player.name}</span>
        <span className="text-sm tabular-nums">
          <span className={cn(player.marks < 0 && "text-destructive")}>{signed2(player.marks)}</span>
          <span className="text-muted-foreground"> · {oneDecimal(player.share)}%</span>
        </span>
      </summary>
      <div className="mt-2 space-y-3 text-sm">
        <p className="text-muted-foreground text-xs">
          {player.used}
          {player.offered !== null && ` of ${player.offered}`} attacks used
        </p>
        {player.attacks.map((attack) => (
          <div key={`${attack.raidNumber}:${attack.districtName}:${attack.attackNumber}`}>
            <p className="font-medium">
              {attack.districtName ?? "District"}
              {attack.districtHallLevel !== null && ` (DH${attack.districtHallLevel})`}
              <span className="text-muted-foreground font-normal">
                {" "}
                · {attack.opponentName ?? `raid ${attack.raidNumber}`} · {attack.after - attack.share}% →{" "}
                {attack.after}%
              </span>
            </p>
            <ul className="space-y-0.5 pl-3">
              {attack.lines.map((line, i) => (
                <Line key={i} {...line} />
              ))}
            </ul>
          </div>
        ))}
        {player.weekendLines.length > 0 && (
          <div>
            <p className="font-medium">This weekend</p>
            <ul className="space-y-0.5 pl-3">
              {player.weekendLines.map((line, i) => (
                <Line key={i} {...line} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

/** The rules, printed from RAID_MARKS so they cannot drift from the sums. */
function Rules() {
  const [big, bigger] = [...RAID_MARKS.bigHit].sort((a, b) => a.from - b.from);
  const rows: Array<[string, number | string]> = [
    ["Every 100% of a district destroyed (38% is +0.38)", RAID_MARKS.fullDistrict],
    ["Finishing a district (taking it to 100%)", RAID_MARKS.finished],
    ["Solo clear (0% to 100% in one attack), on top", RAID_MARKS.soloClear],
    [`${big!.from}% to ${bigger!.from - 1}% of a district in one attack`, big!.marks],
    [`${bigger!.from}% or more in one attack`, bigger!.marks],
    [`Under ${RAID_MARKS.weak.under}% in one attack, unless it finished the district`, RAID_MARKS.weak.marks],
    [
      `Enemy capital league, per step: ${LEAGUES[0]} ${signed2(RAID_MARKS.leagueStep)} … ${LEAGUES.at(-1)} ${signed2(
        RAID_MARKS.leagueStep * LEAGUES.length,
      )}`,
      RAID_MARKS.leagueStep,
    ],
    [`Every ${RAID_MARKS.gold.per.toLocaleString("en-GB")} capital gold looted, once a weekend`, RAID_MARKS.gold.marks],
    ["Each attack not used, once the weekend is over (only if they attacked at all)", RAID_MARKS.unused],
    ["Did not attack at all", "0"],
  ];

  return (
    <Disclosure title="Marking rules" icon={ListChecks}>
      <div className="space-y-3 text-sm">
        <ul className="space-y-1">
          {rows.map(([label, marks]) => (
            <li key={label} className="flex justify-between gap-3">
              <span>{label}</span>
              <span className="tabular-nums font-medium">{typeof marks === "number" ? signed2(marks) : marks}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs">
          An attack&apos;s share is what it destroyed itself: the game gives the district&apos;s total after
          each attack, so 0% → 38% → 78% → 100% is 38%, 40% and 22%. A weekend % is a player&apos;s marks
          divided by their clan&apos;s plus marks that weekend, never worse than {RAID_MARKS.worstShare}%. The
          rating is the weekend percentages added up over the month.
        </p>
      </div>
    </Disclosure>
  );
}

export default async function RaidRatingPage({
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
            icon={Castle}
            title="You are not in a clan yet"
            body="There is nothing to rate until a leader adds you to a clan."
          />
        </Panel>
      </Shell>
    );
  }

  // Every month any of these clans has a raid weekend in, newest first.
  const monthLists = await Promise.all(clans.map((clan) => raidMonthsForClan(supabase, clan.id)));
  const months = [...new Set(monthLists.flat())].sort().reverse();
  // An unknown or missing month is the latest one, never an error.
  const month = months.find((m) => m === monthParam) ?? months[0] ?? null;
  if (!month) {
    return (
      <Shell>
        <Panel>
          <EmptyState
            icon={Castle}
            title="No raid weekends recorded yet"
            body="The rating appears with the first raid weekend the sync captures."
          />
        </Panel>
        <Rules />
      </Shell>
    );
  }

  const loaded = await Promise.all(
    clans.map(async (clan) => ({ clan, view: await loadRaidMonth(supabase, clan, month) })),
  );
  const played = loaded.filter(({ view }) => view.weekends.length > 0);

  const only = played.find((p) => p.clan.tag === clanParam) ?? null;
  const shown = only ? [only] : played;
  const rankedOf = (p: (typeof played)[number]) =>
    p.view.rating.players.filter((player) => p.view.rating.started || player.provisional);

  const started = shown.some((p) => p.view.rating.started);
  const raiding = shown.some((p) => p.view.ratings.some((r) => r.status === "provisional"));
  const notRated = shown.reduce((t, p) => t + p.view.ratings.filter((r) => r.status === "notRated").length, 0);
  const rows = shown
    .flatMap((p) => rankedOf(p).map((player) => ({ clan: p.clan, player })))
    .sort(
      (a, b) =>
        b.player.rating - a.player.rating ||
        b.player.marks - a.player.marks ||
        (b.player.provisional?.share ?? 0) - (a.player.provisional?.share ?? 0) ||
        a.player.name.localeCompare(b.player.name),
    );

  const here = (next: { clan?: string | null; month?: string }) => {
    const query = new URLSearchParams();
    const m = next.month ?? month;
    const c = next.clan === undefined ? (only?.clan.tag ?? null) : next.clan;
    if (m !== months[0]) query.set("month", m);
    if (c) query.set("clan", c);
    const text = query.toString();
    return text ? `/rating/raids?${text}` : "/rating/raids";
  };
  const playerHref = (clanTag: string, tag: string) =>
    `/${encodeURIComponent(clanTag)}/player/${encodeURIComponent(tag)}`;

  return (
    <Shell>
      <Panel aria-labelledby="raid-rating-title" className="space-y-4">
        <div className="space-y-1">
          <SectionHeader
            id="raid-rating-title"
            title={`Raid weekends of ${seasonLabel(month)}`}
            icon={Castle}
            count={rows.length}
          />
          <p className="text-muted-foreground text-sm">
            {started
              ? only
                ? `Rating is each finished weekend's share of ${only.clan.name}'s plus marks, added up over the month.`
                : "Rating is each finished weekend's share of a player's own clan's plus marks, added up over the month."
              : "No weekend of this month has finished yet — this is the weekend being raided so far, and it will move."}
            {started && raiding && " The weekend being raided is shown beside it and is not counted yet."}
          </p>
        </div>

        <nav aria-label="Month" className="flex flex-wrap gap-2">
          {months.slice(0, 12).map((m) => (
            <Choice key={m} href={here({ month: m })} active={m === month} label={seasonLabel(m)} />
          ))}
        </nav>
        {played.length > 0 && (
          <nav aria-label="Clan" className="flex flex-wrap gap-2">
            <Choice
              href={here({ clan: null })}
              active={!only}
              label="All clans"
              count={played.reduce((t, p) => t + rankedOf(p).length, 0)}
            />
            {played.map((p) => (
              <Choice
                key={p.clan.id}
                href={here({ clan: p.clan.tag })}
                active={only?.clan.id === p.clan.id}
                label={p.clan.name}
                count={rankedOf(p).length}
                dot={clanAccent(p.clan.id).color}
              />
            ))}
          </nav>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon={Castle}
            title="Nothing to rate yet"
            body={
              notRated > 0
                ? "This month's weekends were recorded before attacks were captured, so there is nothing to mark."
                : "Marks appear once the raid weekend starts and the first attacks land."
            }
          />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <Table className="cb-stack">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">#</TableHead>
                  <TableHead>Member</TableHead>
                  {!only && <TableHead>Clan</TableHead>}
                  <TableHead className="text-right">Weekends</TableHead>
                  <TableHead className="text-right">Marks</TableHead>
                  {raiding && <TableHead className="text-right">This weekend so far</TableHead>}
                  <TableHead className="text-right" title="Rating divided by the finished weekends they raided">
                    Per weekend
                  </TableHead>
                  <TableHead className="text-right">Rating</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ clan, player }, index) => (
                  <TableRow key={`${clan.id}:${player.playerId}`}>
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
                      {player.tag ? (
                        <Link href={playerHref(clan.tag, player.tag)} className="font-medium hover:underline">
                          {player.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{player.name}</span>
                      )}
                    </TableCell>
                    {!only && (
                      <TableCell data-label="Clan">
                        <span className="flex items-center gap-2 text-sm">
                          <span
                            aria-hidden
                            className="size-2 shrink-0 rounded-full"
                            style={{ background: clanAccent(clan.id).color }}
                          />
                          <span className="text-muted-foreground">{clan.name}</span>
                        </span>
                      </TableCell>
                    )}
                    <TableCell data-label="Weekends" className="text-right tabular-nums">
                      {player.weekendsCounted}
                    </TableCell>
                    <TableCell
                      data-label="Marks"
                      className={cn("text-right tabular-nums", player.marks < 0 && "text-destructive")}
                    >
                      {signed2(player.marks)}
                    </TableCell>
                    {raiding && (
                      <TableCell
                        data-label="This weekend so far"
                        className="text-muted-foreground text-right text-sm tabular-nums"
                      >
                        {player.provisional
                          ? `${signed2(player.provisional.marks)} · ${oneDecimal(player.provisional.share)}%`
                          : "—"}
                      </TableCell>
                    )}
                    <TableCell data-label="Per weekend" className="text-muted-foreground text-right text-sm tabular-nums">
                      {player.perWeekend === null ? "—" : oneDecimal(player.perWeekend)}
                    </TableCell>
                    <TableCell data-label="Rating" className="text-right font-semibold tabular-nums">
                      {oneDecimal(player.rating)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-muted-foreground text-xs">
          {only
            ? "Every mark, attack by attack, is below."
            : "Pick a clan to see every mark, attack by attack."}
          {notRated > 0 &&
            ` ${notRated} weekend${notRated === 1 ? "" : "s"} of this month ${
              notRated === 1 ? "is" : "are"
            } not rated: the game shows who attacked what for the latest weekend only, and ${
              notRated === 1 ? "its" : "their"
            } attacks were not captured.`}
        </p>
      </Panel>

      {only &&
        only.view.weekends.map((weekend, index) => {
          const rating = only.view.ratings[index]!;
          return (
            <Disclosure
              key={weekend.id}
              title={`Weekend of ${formatDisplay(weekend.startTime, "date")}`}
              icon={Castle}
              count={rating.players.length}
              summary={STATUS[rating.status]}
            >
              {rating.status === "notRated" ? (
                <p className="text-muted-foreground text-sm">
                  Recorded before attacks were captured: the totals are kept, but there is nothing to mark.
                </p>
              ) : rating.players.length === 0 ? (
                <p className="text-muted-foreground text-sm">No attacks yet.</p>
              ) : (
                <div>
                  {rating.status === "provisional" && (
                    <p className="text-muted-foreground mb-2 text-sm">
                      Still being raided: these marks will move, and are not in the rating until the weekend ends.
                    </p>
                  )}
                  {rating.players.map((player) => (
                    <WeekendSum key={player.playerId} player={player} />
                  ))}
                </div>
              )}
            </Disclosure>
          );
        })}

      <Rules />
    </Shell>
  );
}
