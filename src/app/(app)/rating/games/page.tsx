// Clan Games rating — a section of Player rating: every player of the viewer's
// clans over one month of Clan Games, in one ranking.
//
// The rating itself is one clan's month worked out by services/games-rating.ts.
// A share is always of a player's OWN clan's marks, so the ranking compares how
// much of their clan's games each carried.
//
// ALL CLANS, OR ONE (?clan=), and a month picker (?month=).
//
// Outside [clanTag] because it spans clans, like the war, CWL and raid ratings.
//
// R3 — spanning clans is not the same as not filtering by clan. Each clan's
// month is read under that clan's id, over the list visibleClans() returned,
// and its scores by the id that read returned. RLS on the Clan Games tables is
// auth_clan_ids(), so a member of clan A reads nothing of clan B.

import Link from "next/link";
import { redirect } from "next/navigation";
import { Gamepad2, HelpCircle, ListChecks } from "lucide-react";
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
import { loadGamesMonth } from "@/lib/games-rating-data";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { canSeeMemberStats } from "@/lib/visibility";
import { PageHeader } from "@/components/page-header";
import { Disclosure, EmptyState, Panel, SectionHeader } from "@/components/kit";
import { RatingNav } from "@/components/rating-nav";
import { gamesForClan } from "@/repositories/clan-games";
import { oneDecimal } from "@/services/cwl-rating";
import { GAMES_MARKS, gamesMarks } from "@/services/games-rating";
import { signed2 } from "@/services/raid-rating";

export const dynamic = "force-dynamic";

/** Gold, silver, bronze for the top three, as on Player rating. */
const MEDAL = ["#f5c542", "#c0c7d1", "#cd8a4b"];

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <PageHeader
        title="Clan Games rating"
        back={{ href: "/rating", label: "Player rating" }}
        description="Every player of your clans over a month of Clan Games, rated by their share of their clan's points."
      />
      <RatingNav current="games" />
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

/** The rules, printed from GAMES_MARKS so they cannot drift from the sums. */
function Rules() {
  const example = 7_000;
  const exampleMarks = gamesMarks(example);
  const rows: Array<[string, string]> = [
    [
      `Every ${GAMES_MARKS.per.toLocaleString("en-GB")} points, in proportion (7,500 is +7.50)`,
      signed2(GAMES_MARKS.marks),
    ],
    [`Most a player can score in a month: ${GAMES_MARKS.cap.toLocaleString("en-GB")} points`, signed2(gamesMarks(GAMES_MARKS.cap))],
    ["Not measured (joined during the games, or missed by the opening reading)", "Not rated"],
  ];

  return (
    <Disclosure title="Marking rules" icon={ListChecks}>
      <div className="space-y-3 text-sm">
        <ul className="space-y-1">
          {rows.map(([label, marks]) => (
            <li key={label} className="flex justify-between gap-3">
              <span>{label}</span>
              <span className="tabular-nums font-medium">{marks}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground text-xs">
          The rating is a player&apos;s marks divided by the marks of everyone measured in their own clan
          that month. A player with {example.toLocaleString("en-GB")} points has{" "}
          {signed2(exampleMarks)} marks; if the clan has 100 marks in all, that is{" "}
          {oneDecimal((exampleMarks / 100) * 100)}%. A clan&apos;s ratings add up to 100%. Points over{" "}
          {GAMES_MARKS.cap.toLocaleString("en-GB")} count as {GAMES_MARKS.cap.toLocaleString("en-GB")}.
        </p>
      </div>
    </Disclosure>
  );
}

export default async function GamesRatingPage({
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
            icon={Gamepad2}
            title="You are not in a clan yet"
            body="There is nothing to rate until a leader adds you to a clan."
          />
        </Panel>
      </Shell>
    );
  }

  // Every month any of these clans has Clan Games in, newest first.
  const monthLists = await Promise.all(
    clans.map(async (clan) => (await gamesForClan(supabase, clan.id)).map((g) => g.season)),
  );
  const months = [...new Set(monthLists.flat())].sort().reverse();
  // An unknown or missing month is the latest one, never an error.
  const month = months.find((m) => m === monthParam) ?? months[0] ?? null;
  if (!month) {
    return (
      <Shell>
        <Panel>
          <EmptyState
            icon={Gamepad2}
            title="No Clan Games recorded yet"
            body="The rating appears once the first Clan Games the sync measures has ended."
          />
        </Panel>
        <Rules />
      </Shell>
    );
  }

  const loaded = await Promise.all(
    clans.map(async (clan) => ({ clan, view: await loadGamesMonth(supabase, clan, month) })),
  );
  const played = loaded.filter(({ view }) => view.games !== null);

  const only = played.find((p) => p.clan.tag === clanParam) ?? null;
  const shown = only ? [only] : played;

  const running = shown.some((p) => !p.view.rating.settled);
  const rows = shown
    .flatMap((p) => p.view.rating.players.map((player) => ({ clan: p.clan, player })))
    .sort(
      (a, b) =>
        b.player.share - a.player.share ||
        b.player.points - a.player.points ||
        a.player.name.localeCompare(b.player.name),
    );
  const unmeasured = shown.flatMap((p) => p.view.rating.unmeasured.map((player) => ({ clan: p.clan, player })));

  const here = (next: { clan?: string | null; month?: string }) => {
    const query = new URLSearchParams();
    const m = next.month ?? month;
    const c = next.clan === undefined ? (only?.clan.tag ?? null) : next.clan;
    if (m !== months[0]) query.set("month", m);
    if (c) query.set("clan", c);
    const text = query.toString();
    return text ? `/rating/games?${text}` : "/rating/games";
  };
  const playerHref = (clanTag: string, tag: string) =>
    `/${encodeURIComponent(clanTag)}/player/${encodeURIComponent(tag)}`;

  return (
    <Shell>
      <Panel aria-labelledby="games-rating-title" className="space-y-4">
        <div className="space-y-1">
          <SectionHeader
            id="games-rating-title"
            title={`Clan Games of ${seasonLabel(month)}`}
            icon={Gamepad2}
            count={rows.length}
          />
          <p className="text-muted-foreground text-sm">
            {only
              ? `Rating is each player's share of ${only.clan.name}'s marks this month.`
              : "Rating is each player's share of their own clan's marks this month."}
            {running &&
              rows.length > 0 &&
              " A clan whose games are still running is not in the ranking until they end."}
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
              count={played.reduce((t, p) => t + p.view.rating.players.length, 0)}
            />
            {played.map((p) => (
              <Choice
                key={p.clan.id}
                href={here({ clan: p.clan.tag })}
                active={only?.clan.id === p.clan.id}
                label={p.clan.name}
                count={p.view.rating.players.length}
                dot={clanAccent(p.clan.id).color}
              />
            ))}
          </nav>
        )}

        {rows.length === 0 ? (
          <EmptyState
            icon={Gamepad2}
            title={running ? "The games are still running" : "Nothing to rate"}
            body={
              running
                ? "Points are measured when the games end on the 28th, and the rating appears then."
                : "Nobody was measured for this month's games."
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
                  <TableHead className="text-right">Points</TableHead>
                  <TableHead className="text-right">Marks</TableHead>
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
                    <TableCell data-label="Points" className="text-right tabular-nums">
                      {player.counted.toLocaleString("en-GB")}
                      {player.points > player.counted && (
                        <span
                          className="text-muted-foreground text-xs"
                          title={`${player.points.toLocaleString("en-GB")} measured; counted up to the cap`}
                        >
                          {" "}
                          (cap)
                        </span>
                      )}
                    </TableCell>
                    <TableCell data-label="Marks" className="text-right tabular-nums">
                      {signed2(player.marks)}
                    </TableCell>
                    <TableCell data-label="Rating" className="text-right font-semibold tabular-nums">
                      {oneDecimal(player.share)}%
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {shown.some((p) => p.view.rating.settled) && (
          <p className="text-muted-foreground text-xs">
            {shown
              .filter((p) => p.view.rating.settled)
              .map((p) => `${p.clan.name}: ${signed2(p.view.rating.totalMarks)} marks in all`)
              .join(" · ")}
          </p>
        )}
      </Panel>

      {unmeasured.length > 0 && (
        <Disclosure title="Not measured" icon={HelpCircle} count={unmeasured.length}>
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              No score this month: they joined during the games, or the opening reading missed them. This is
              not a zero, so they are not ranked.
            </p>
            <ul className="space-y-1">
              {unmeasured.map(({ clan, player }) => (
                <li key={`${clan.id}:${player.playerId}`} className="flex justify-between gap-3">
                  {player.tag ? (
                    <Link href={playerHref(clan.tag, player.tag)} className="hover:underline">
                      {player.name}
                    </Link>
                  ) : (
                    <span>{player.name}</span>
                  )}
                  {!only && <span className="text-muted-foreground">{clan.name}</span>}
                </li>
              ))}
            </ul>
          </div>
        </Disclosure>
      )}

      <Rules />
    </Shell>
  );
}
