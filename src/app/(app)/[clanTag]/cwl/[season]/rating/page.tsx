// The season's player rating: everyone ranked, every day's marks and share, and
// the sum each mark came from.
//
// The rules are the clan's own and live in services/cwl-rating.ts. This page is
// three answers in the order they get asked:
//
//   1. who is where              the season table
//   2. why did I get that        one day, player by player, line by line
//   3. what are the rules        printed from CWL_MARKS, the constants the sums use
//
// Nothing here is stored: the rating is a reading of the attacks already kept
// (see the header of the service).
//
// R1 — PostgreSQL only. R3 — the season is resolved under an explicit clan
// filter, so every war and attack below it is known to belong here.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ListChecks, Medal, Scale } from "lucide-react";
import { SyncBadge } from "@/components/sync-badge";
import { TownHall } from "@/components/lineup-parts";
import { Disclosure, EmptyState, Panel, SectionHeader } from "@/components/kit";
import { CwlSeasonHeader } from "@/components/cwl-season-header";
import { Lines, Marks, RuleList } from "@/components/rating-parts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireClanByTag } from "@/lib/clans";
import { canPrintCwlReport, loadSeasonBoards, loadSeasonView, ratingFor } from "@/lib/cwl-season";
import { isLeader } from "@/lib/visibility";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { seasonByName } from "@/repositories/cwl";
import { latestRun } from "@/repositories/sync-log";
import {
  CWL_MARKS,
  oneDecimal,
  signed,
  type DayRatingStatus,
  type RatedDay,
} from "@/services/cwl-rating";

export const dynamic = "force-dynamic";

/** What a day is to the rating, under its number. */
function dayNote(day: RatedDay): string {
  const notes: Record<DayRatingStatus, string> = {
    counted: `clan ${signed(day.total)}`,
    provisional: "running",
    notStarted: "not started",
    notRated: "not rated",
  };
  return notes[day.status];
}

export default async function CwlRatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string; season: string }>;
  searchParams: Promise<{ day?: string }>;
}) {
  const { clanTag, season: seasonName } = await params;
  const { day: dayParam } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const season = await seasonByName(supabase, clan.id, decodeURIComponent(seasonName));
  if (!season) notFound();

  const [view, run, canPrint] = await Promise.all([
    loadSeasonView(supabase, clan, season, { withPlayers: true }),
    latestRun(supabase, "cwl", clan.id),
    canPrintCwlReport(supabase, clan.role),
  ]);
  const boards = await loadSeasonBoards(supabase, clan, view);
  const rating = ratingFor(view, boards);

  const clanBase = `/${encodeURIComponent(clan.tag)}`;
  const base = `${clanBase}/cwl/${encodeURIComponent(season.season)}`;

  // The day whose sums are shown: the one asked for, else the latest with marks.
  const rated = rating.days
    .map((day, index) => ({ day, index }))
    .filter(({ day }) => day.status === "counted" || day.status === "provisional");
  const shown =
    rated.find(({ day }) => day.dayNumber !== null && String(day.dayNumber) === dayParam) ??
    rated[rated.length - 1] ??
    null;
  const shownRows = shown
    ? rating.players
        .flatMap((p) => {
          const entry = p.days[shown.index];
          return entry ? [entry] : [];
        })
        .sort((a, b) => b.marks - a.marks || (a.base ?? 99) - (b.base ?? 99))
    : [];
  const provisional = rating.days.some((d) => d.status === "provisional");
  const unrated = rating.days.filter((d) => d.status === "notRated").length;
  // Days where a base was hit twice and nobody recorded which attack came first.
  const unordered = rating.days.filter((d) => d.orderMissing).map((d) => d.dayNumber ?? "?");

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      <CwlSeasonHeader
        clanName={clan.name}
        clanBase={clanBase}
        view={view}
        active="rating"
        canPrint={canPrint}
        description="Every player rated on attack and defence, day by day, and where each mark came from."
        actions={<SyncBadge run={run} clanTag={clan.tag} target="cwl" canAdmin={isLeader(clan.role)} />}
      />

      {rating.players.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Medal}
            title={unrated > 0 ? "This season cannot be rated" : "No rating yet"}
            body={
              unrated > 0
                ? "The rating needs the enemy lineups — their base numbers, Town Halls and attacks on us — and they were not recorded for this season."
                : "Marks appear once battle day starts and the first attacks land."
            }
          />
        </Panel>
      ) : (
        <>
          <section className="cb-panel space-y-4 rounded-panel border p-5" aria-labelledby="rating-title">
            <div className="space-y-1">
              <SectionHeader id="rating-title" icon={Medal} title="Season rating" count={rating.players.length} />
              <p className="text-muted-foreground text-sm">
                Each day a player&apos;s marks are taken as a share of the clan&apos;s plus marks, and the
                rating is those shares added up over the finished days.
                {provisional && " The day still running is shown but not counted yet."}
              </p>
            </div>

            <div className="-mx-5 overflow-x-auto px-5">
              <Table className="min-w-[52rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-right">#</TableHead>
                    <TableHead>Player</TableHead>
                    {rating.days.map((day, index) => (
                      <TableHead key={index} className="text-right">
                        <span className="block">Day {day.dayNumber ?? "?"}</span>
                        <span className="text-muted-foreground block text-[0.6875rem] font-normal">{dayNote(day)}</span>
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Marks</TableHead>
                    <TableHead className="text-right" title="Rating divided by the finished days they played">
                      Per day
                    </TableHead>
                    <TableHead className="text-right">Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rating.players.map((p, index) => (
                    <TableRow key={p.playerId}>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{index + 1}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <TownHall level={p.thLevel} />
                          <Link
                            className="font-medium underline-offset-2 hover:underline"
                            href={`${clanBase}/player/${encodeURIComponent(p.tag)}`}
                          >
                            {p.name}
                          </Link>
                        </span>
                      </TableCell>
                      {p.days.map((entry, dayIndex) => {
                        const live = rating.days[dayIndex]!.status === "provisional";
                        return (
                          <TableCell key={dayIndex} className={cn("text-right", live && "opacity-70")}>
                            {entry ? (
                              <>
                                <span className="block text-sm font-medium tabular-nums">{oneDecimal(entry.share)}%</span>
                                <Marks value={entry.marks} className="block text-xs" />
                              </>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-right">
                        <Marks value={p.marks} />
                      </TableCell>
                      <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                        {p.perDay === null ? "—" : oneDecimal(p.perDay)}
                      </TableCell>
                      <TableCell className="cb-title text-right text-base tabular-nums">{oneDecimal(p.rating)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-muted-foreground text-xs">
              Under each day: the share of the clan&apos;s plus marks, then the marks themselves. &ldquo;clan
              +123&rdquo; is what the marks of everyone above zero came to that day — minus marks are not taken
              off it. A dash is a day the player was not in the lineup.
              &ldquo;Per day&rdquo; is the rating divided by the finished days played — the rating is a sum, so it is
              the fair comparison between someone fielded seven days and someone fielded four.
              {unrated > 0 &&
                ` ${unrated} day${unrated === 1 ? " is" : "s are"} not rated: the enemy lineup was not recorded.`}
              {unordered.length > 0 &&
                ` On day ${unordered.join(", ")} a base was hit more than once and the order of those attacks is not recorded yet, so each was rated as a first hit; the next sync fills it in while the week runs.`}
            </p>
          </section>

          {shown && (
            <section className="cb-panel space-y-4 rounded-panel border p-5" aria-labelledby="day-title">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SectionHeader
                  id="day-title"
                  icon={ListChecks}
                  title={`Day ${shown.day.dayNumber ?? "?"}, mark by mark`}
                />
                <nav aria-label="Day" className="bg-muted/60 flex gap-1 rounded-control p-1">
                  {rated.map(({ day, index }) => (
                    <Link
                      key={index}
                      href={`${base}/rating?day=${day.dayNumber ?? ""}#day-title`}
                      aria-current={index === shown.index ? "page" : undefined}
                      className={cn(
                        "rounded-chip px-2.5 py-1 text-sm font-medium tabular-nums transition-colors",
                        index === shown.index
                          ? "bg-card text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {day.dayNumber ?? "?"}
                    </Link>
                  ))}
                </nav>
              </div>
              <p className="text-muted-foreground text-sm">
                {shown.day.status === "provisional"
                  ? "Still running: these marks move with every attack, and nobody has lost marks for an unused attack yet."
                  : `The clan's plus marks came to ${signed(shown.day.total)}; each share is a player's marks out of that. Minus marks are not taken off it.`}
              </p>

              <div className="-mx-5 overflow-x-auto px-5">
                <Table className="min-w-[46rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Base</TableHead>
                      <TableHead>Player</TableHead>
                      <TableHead className="w-56">Attack</TableHead>
                      <TableHead className="w-56">Defence</TableHead>
                      <TableHead className="text-right">Marks</TableHead>
                      <TableHead className="text-right">Share</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shownRows.map((row) => (
                      <TableRow key={row.playerId}>
                        <TableCell className="cb-title align-top text-base tabular-nums">#{row.base ?? "?"}</TableCell>
                        <TableCell className="align-top">
                          <span className="flex items-center gap-2">
                            <TownHall level={row.thLevel} />
                            <Link
                              className="font-medium underline-offset-2 hover:underline"
                              href={`${clanBase}/player/${encodeURIComponent(row.tag)}`}
                            >
                              {row.name}
                            </Link>
                          </span>
                        </TableCell>
                        <TableCell className="align-top">
                          <Lines lines={row.attack} empty="Not attacked yet" />
                        </TableCell>
                        <TableCell className="align-top">
                          <Lines lines={row.defence} empty="Not attacked yet" />
                        </TableCell>
                        <TableCell className="text-right align-top">
                          <Marks value={row.marks} className="font-semibold" />
                        </TableCell>
                        <TableCell className="text-right align-top font-medium tabular-nums">
                          {oneDecimal(row.share)}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-muted-foreground text-xs">
                Who attacked whom, with stars and destruction, is on the{" "}
                <Link href={`${base}?day=${shown.day.dayNumber ?? ""}`} className="underline">
                  Days tab
                </Link>
                .
              </p>
            </section>
          )}
        </>
      )}

      <Disclosure title="How marks are given" icon={Scale} defaultOpen={rating.players.length === 0}>
        <div className="grid gap-6 text-sm md:grid-cols-2">
          <div className="space-y-2">
            <h3 className="font-semibold">Attack</h3>
            <RuleList
              rules={[
                ["3 stars", CWL_MARKS.stars[3]],
                ["2 stars", CWL_MARKS.stars[2]],
                [`2 stars with ${CWL_MARKS.nearMiss.destruction}% destruction or more, extra`, CWL_MARKS.nearMiss.marks],
                ["1 star", CWL_MARKS.stars[1]],
                ["0 stars", CWL_MARKS.stars[0]],
                ["Attack not used (once the day is over)", CWL_MARKS.missed],
                ["Each Town Hall level above your own", CWL_MARKS.thUp],
                ["The same Town Hall as your own", CWL_MARKS.sameTh],
                ["Each Town Hall level below your own", CWL_MARKS.thBelow],
                ["Each base above your own on the war map", CWL_MARKS.baseUp],
                ["Your mirror base, or any base above it", CWL_MARKS.mirror],
                ["Each base below your own", CWL_MARKS.baseBelow],
                ["3 stars on their last base", CWL_MARKS.targetRank.last],
                ["…and for each place higher on their map", CWL_MARKS.targetRank.step],
                ["The day's heroic attack", CWL_MARKS.heroicAttack],
              ]}
            />
            <h3 className="pt-2 font-semibold">Not finishing the job</h3>
            <p className="text-muted-foreground text-xs">
              On top of the marks above, when you attack away from your mirror and fall short. A higher
              base with 1 star or none loses nothing extra: it already gets no marks for hitting up.
            </p>
            <RuleList
              rules={[
                ["A higher base, 2 stars (not 3)", CWL_MARKS.shortUp[2]],
                ["A lower base, 2 stars (not 3)", CWL_MARKS.shortDown[2]],
                ["A lower base, 1 star", CWL_MARKS.shortDown[1]],
                ["A lower base, no star", CWL_MARKS.shortDown[0]],
              ]}
            />
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
              <li>
                The marks for hitting up — a higher Town Hall or a higher base — are only given for{" "}
                {CWL_MARKS.upNeedsStars} stars or more.
              </li>
              <li>
                The war map never gives more than {CWL_MARKS.baseUpCap} for bases up, and never takes more
                than {CWL_MARKS.baseBelowCap} for bases below, however many.
              </li>
              <li>
                <span className="text-foreground font-medium">Their map.</span> Three stars also score for
                how high the base sits on the enemy&apos;s map, whoever attacks it: their last base{" "}
                {signed(CWL_MARKS.targetRank.last)}, and {signed(CWL_MARKS.targetRank.step)} for each place
                higher, so their #1 of 15 is{" "}
                {signed(CWL_MARKS.targetRank.last + CWL_MARKS.targetRank.step * 14)}. A mirror at the top is
                worth more than a mirror at the bottom.
              </li>
              <li>
                <span className="text-foreground font-medium">New stars only.</span> On a base a clanmate
                already hit, 2 or 3 stars lose a mark for each star already taken: 3 stars on a base
                already at 2 is 5 − 2 = +3. An attack that adds no new star gets no star marks and nothing
                for hitting up. 1 star and 0 stars score as always.
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">Defence</h3>
            <RuleList
              rules={[
                ["Your base held to 0 stars", CWL_MARKS.defence[0]],
                ["Held to 1 star", CWL_MARKS.defence[1]],
                ["Held to 2 stars", CWL_MARKS.defence[2]],
                ["3-starred", CWL_MARKS.defence[3]],
                ["3-starred by an enemy base lower on the map than yours", CWL_MARKS.tripledFromBelow],
                ["Not attacked (once the day is over)", CWL_MARKS.notAttacked],
                ["The day's heroic defence", CWL_MARKS.heroicDefence],
              ]}
            />
            <p className="text-muted-foreground text-xs">
              Only the enemy&apos;s best attack on a base counts — the one that scores in the war.
            </p>

            <h3 className="pt-2 font-semibold">Heroic attack and defence</h3>
            <p className="text-muted-foreground">
              One of each per day. The game does not tell us which they were, so they are picked here.
            </p>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
              <li>
                <span className="text-foreground font-medium">Attack:</span> the most stars, then the furthest
                above their own Town Hall, then the furthest up the map, then the most destruction. It needs
                at least {CWL_MARKS.upNeedsStars} stars and a new star for the clan.
              </li>
              <li>
                <span className="text-foreground font-medium">Defence:</span> the fewest stars given, then the
                least destruction, then the strongest attacker. A 3-starred base cannot be heroic.
              </li>
            </ul>

            <h3 className="pt-2 font-semibold">From marks to rating</h3>
            <p className="text-muted-foreground">
              Day share = your marks ÷ the clan&apos;s plus marks that day — the marks of everyone who finished
              above zero. 4 marks when the other players have 47 between them is 4 ÷ 51 = 7.8%. Minus marks
              are left out of what is divided by, so the plus shares always add up to 100% and one
              player&apos;s bad day does not lift everyone else&apos;s. A minus day is a minus share, never worse
              than {oneDecimal(CWL_MARKS.worstShare)}%. The rating is the shares of
              every finished day added up; players level on it are ordered by marks, then by average
              destruction.
            </p>
          </div>
        </div>
      </Disclosure>
    </main>
  );
}
