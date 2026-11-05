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

import { redirect } from "next/navigation";
import { Castle, ListChecks } from "lucide-react";
import { currentUserId } from "@/lib/auth";
import { clanAccent } from "@/lib/clan-accent";
import { visibleClans } from "@/lib/clans";
import { formatDisplay } from "@/lib/display-time";
import { loadRaidMonth } from "@/lib/raid-rating-data";
import { rankAnchor, rankRows } from "@/lib/rating";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { canSeeMemberStats } from "@/lib/visibility";
import { Disclosure, EmptyState, Panel, SectionHeader } from "@/components/kit";
import { RankDock } from "@/components/rank-dock";
import {
  Leaderboard,
  Podium,
  RatingToolbar,
  podiumRows,
  topOf,
  type BoardColumn,
  type BoardRow,
} from "@/components/rating-board";
import { RatingShell } from "@/components/rating-shell";
import { basesForUser } from "@/repositories/account-bases";
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

/** Short, for the folded line at phone width; the open section says why. */
const STATUS: Record<RaidWeekendStatus, string> = {
  counted: "Counted",
  provisional: "In progress",
  notRated: "Not rated",
};

const TITLE = "Raids rating";
const DESCRIPTION = "Every player of your clans over a month of raid weekends, rated attack by attack.";

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
      <RatingShell title={TITLE} description={DESCRIPTION}>
        <Panel>
          <EmptyState
            icon={Castle}
            title="You are not in a clan yet"
            body="There is nothing to rate until a leader adds you to a clan."
          />
        </Panel>
      </RatingShell>
    );
  }

  // Every month any of these clans has a raid weekend in, newest first.
  const [monthLists, bases] = await Promise.all([
    Promise.all(clans.map((clan) => raidMonthsForClan(supabase, clan.id))),
    basesForUser(supabase, userId),
  ]);
  const months = [...new Set(monthLists.flat())].sort().reverse();
  // An unknown or missing month is the latest one, never an error.
  const month = months.find((m) => m === monthParam) ?? months[0] ?? null;
  if (!month) {
    return (
      <RatingShell title={TITLE} description={DESCRIPTION}>
        <Panel>
          <EmptyState
            icon={Castle}
            title="No raid weekends recorded yet"
            body="The rating appears with the first raid weekend the sync captures."
          />
        </Panel>
        <Rules />
      </RatingShell>
    );
  }

  const loaded = await Promise.all(
    clans.map(async (clan) => ({ clan, view: await loadRaidMonth(supabase, clan, month) })),
  );
  const played = loaded.filter(({ view }) => view.weekends.length > 0);
  const ownIds = new Set(bases.map((b) => b.playerId));

  const only = played.find((p) => p.clan.tag === clanParam) ?? null;
  const shown = only ? [only] : played;
  const rankedOf = (p: (typeof played)[number]) =>
    p.view.rating.players.filter((player) => p.view.rating.started || player.provisional);

  const started = shown.some((p) => p.view.rating.started);
  const raiding = shown.some((p) => p.view.ratings.some((r) => r.status === "provisional"));
  const notRated = shown.reduce((t, p) => t + p.view.ratings.filter((r) => r.status === "notRated").length, 0);
  type Item = { clan: (typeof played)[number]["clan"]; player: ReturnType<typeof rankedOf>[number] };
  const order = (a: Item, b: Item) =>
    b.player.rating - a.player.rating ||
    b.player.marks - a.player.marks ||
    (b.player.provisional?.share ?? 0) - (a.player.provisional?.share ?? 0);
  const sorted: Item[] = shown
    .flatMap((p) => rankedOf(p).map((player) => ({ clan: p.clan, player })))
    .sort((a, b) => order(a, b) || a.player.name.localeCompare(b.player.name));

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

  const rows: BoardRow[] = rankRows(sorted, (a, b) => order(a, b) === 0).map(({ item: { clan, player }, rank, tied }) => ({
    key: `${clan.id}:${player.playerId}`,
    anchorId: player.tag ? rankAnchor(player.tag) : undefined,
    rank,
    tied,
    medal: player.rating > 0,
    name: player.name,
    tag: player.tag,
    href: player.tag ? playerHref(clan.tag, player.tag) : null,
    you: ownIds.has(player.playerId),
    clan: { id: clan.id, name: clan.name, href: here({ clan: clan.tag }) },
    rating: { text: oneDecimal(player.rating), value: player.rating },
    cells: {
      weekends: player.weekendsCounted,
      marks: <span className={cn(player.marks < 0 && "text-destructive")}>{signed2(player.marks)}</span>,
      live: (
        <span className="text-muted-foreground text-sm">
          {player.provisional
            ? `${signed2(player.provisional.marks)} · ${oneDecimal(player.provisional.share)}%`
            : "—"}
        </span>
      ),
      perWeekend: (
        <span className="text-muted-foreground text-sm">
          {player.perWeekend === null ? "—" : oneDecimal(player.perWeekend)}
        </span>
      ),
    },
  }));

  const columns: BoardColumn[] = [
    { key: "weekends", label: "Weekends" },
    { key: "marks", label: "Marks" },
    ...(raiding ? [{ key: "live", label: "This weekend so far" }] : []),
    { key: "perWeekend", label: "Per weekend", title: "Rating divided by the finished weekends they raided" },
  ];

  const dock = rows
    .filter((row) => row.you && row.anchorId)
    .map((row) => ({
      key: row.key,
      name: row.name,
      rank: row.rank,
      medal: row.medal,
      line: `#${row.rank} of ${rows.length}${row.tied ? ", tied" : ""} in ${only ? only.clan.name : "your clans"} · ${row.clan.name}`,
      rating: row.rating.text,
      href: `${here({})}#${row.anchorId}`,
    }));

  return (
    <RatingShell
      title={TITLE}
      description={DESCRIPTION}
      dock={dock.length > 0 && <RankDock title={`Raids, ${seasonLabel(month)}`} entries={dock} />}
    >
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

        <RatingToolbar
          months={months.map((m) => ({ href: here({ month: m }), label: seasonLabel(m), active: m === month }))}
          clans={
            played.length > 1
              ? [
                  {
                    href: here({ clan: null }),
                    label: "All clans",
                    active: !only,
                    count: played.reduce((t, p) => t + rankedOf(p).length, 0),
                  },
                  ...played.map((p) => ({
                    href: here({ clan: p.clan.tag }),
                    label: p.clan.name,
                    active: only?.clan.id === p.clan.id,
                    count: rankedOf(p).length,
                    dot: clanAccent(p.clan.id).color,
                  })),
                ]
              : []
          }
        />

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
          <>
            <Podium rows={podiumRows(rows)} />
            <Leaderboard
              rows={rows}
              columns={columns}
              ratingTop={topOf(rows.map((r) => r.rating.value))}
              showClan={!only && played.length > 1}
            />
          </>
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
    </RatingShell>
  );
}
