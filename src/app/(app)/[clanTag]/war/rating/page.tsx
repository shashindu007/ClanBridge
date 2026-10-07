// The war rating for one clan: a month of regular wars, everyone ranked, and
// one war taken apart mark by mark.
//
// The rules are CWL's with four differences, all in services/war-rating.ts —
// two attacks with the better one counting 1.5 times, full marks for a clean-up
// that adds a star, a target-rank scale that does not grow with the war, and a
// calendar month where CWL has a week.
//
// Three answers, in the order they get asked, as on the CWL rating page:
//
//   1. who is where              the month's table
//   2. why did I get that        one war, player by player, attack by attack
//   3. what are the rules        printed from the constants the sums use
//
// A war from before 063 is rated on its attacks alone — the enemy's attacks
// were not stored, and cannot be fetched now — and is labelled wherever it
// appears. Nothing here is stored: the rating is a reading of the rows kept.
//
// R1 — PostgreSQL only. R3 — every war is read under this clan's id, and every
// child read takes a war id that read returned.

import Link from "next/link";
import { ListChecks, Medal, Scale, Swords } from "lucide-react";
import { SyncBadge } from "@/components/sync-badge";
import { PageHeader } from "@/components/page-header";
import { TownHall } from "@/components/game/town-hall";
import { Stars } from "@/components/stars";
import { Disclosure, EmptyState, Panel, SectionHeader } from "@/components/kit";
import { Lines, Marks, RuleList } from "@/components/rating-parts";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireClanByTag } from "@/lib/clans";
import { DISPLAY_ZONE } from "@/lib/display-time";
import { seasonLabel } from "@/lib/roster-view";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { isLeader } from "@/lib/visibility";
import { loadWarMonth } from "@/lib/war-rating-data";
import { latestRun } from "@/repositories/sync-log";
import { warMonthsForClan } from "@/repositories/war";
import { CWL_MARKS, oneDecimal, signed } from "@/services/cwl-rating";
import { WAR_MARKS, WAR_RULES, type RatedWar } from "@/services/war-rating";

export const dynamic = "force-dynamic";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: DISPLAY_ZONE });
}

/** What a war is to the rating, in a word or two. */
function warNote(war: RatedWar): string {
  if (war.status === "notStarted") return "not started";
  const kind = war.attackOnly ? "attack only" : "attack and defence";
  return war.status === "provisional" ? `being fought · ${kind}` : kind;
}

export default async function ClanWarRatingPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string }>;
  searchParams: Promise<{ month?: string; war?: string }>;
}) {
  const { clanTag } = await params;
  const { month: monthParam, war: warParam } = await searchParams;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  const base = `/${encodeURIComponent(clan.tag)}`;
  const here = `${base}/war/rating`;

  const [months, run] = await Promise.all([
    warMonthsForClan(supabase, clan.id),
    latestRun(supabase, "war", clan.id),
  ]);
  // An unknown or missing month is the latest one, never an error.
  const month = months.find((m) => m === monthParam) ?? months[0] ?? null;

  const header = (
    <PageHeader
      eyebrow={clan.name}
      title="War rating"
      description="Every player rated on attack and defence in the month's wars, and where each mark came from."
      actions={<SyncBadge run={run} clanTag={clan.tag} target="war" canAdmin={isLeader(clan.role)} />}
    />
  );

  if (!month) {
    return (
      <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
        {header}
        <Panel>
          <EmptyState
            icon={Swords}
            title="No wars recorded yet"
            body="The rating appears with the first regular war the sync captures."
          />
        </Panel>
      </main>
    );
  }

  const { rating } = await loadWarMonth(supabase, clan, month);

  // The war whose sums are shown: the one asked for, else the latest with marks.
  const rated = rating.wars
    .map((war, index) => ({ war, index }))
    .filter(({ war }) => war.status !== "notStarted");
  const shown = rated.find(({ war }) => war.id === warParam) ?? rated[rated.length - 1] ?? null;
  const shownRows = shown
    ? rating.players
        .flatMap((p) => {
          const entry = p.wars[shown.index];
          return entry ? [entry] : [];
        })
        .sort((a, b) => b.marks - a.marks || (a.base ?? 999) - (b.base ?? 999))
    : [];

  const counted = rating.wars.filter((w) => w.status === "counted");
  const attackOnly = counted.filter((w) => w.attackOnly).length;
  const fighting = rating.wars.some((w) => w.status === "provisional");
  const ranked = rating.players.filter((p) => rating.started || p.provisional);

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
      {header}

      {/* The month: wars that started in it. */}
      <nav aria-label="Month" className="flex flex-wrap gap-2">
        {months.slice(0, 12).map((m) => (
          <Link
            key={m}
            href={`${here}?month=${m}`}
            aria-current={m === month ? "page" : undefined}
            className={cn(
              "rounded-control px-3 py-1.5 text-sm font-medium",
              m === month ? "bg-primary text-primary-foreground" : "hover:bg-accent border",
            )}
          >
            {seasonLabel(m)}
          </Link>
        ))}
      </nav>

      {ranked.length === 0 ? (
        <Panel>
          <EmptyState
            icon={Medal}
            title="No rating yet"
            body="Marks appear once battle day starts and the first attacks land."
          />
        </Panel>
      ) : (
        <>
          <section className="cb-panel space-y-4 rounded-panel border p-5" aria-labelledby="rating-title">
            <div className="space-y-1">
              <SectionHeader
                id="rating-title"
                icon={Medal}
                title={`${seasonLabel(month)} rating`}
                count={ranked.length}
              />
              <p className="text-muted-foreground text-sm">
                In each war a player&apos;s marks are taken as a share of the clan&apos;s plus marks, and the
                rating is those shares added up over the {counted.length} finished war
                {counted.length === 1 ? "" : "s"} that started this month.
                {fighting && " The war being fought is shown but not counted yet."}
              </p>
            </div>

            <div className="-mx-5 overflow-x-auto px-5">
              <Table className="min-w-[36rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 text-right">#</TableHead>
                    <TableHead>Player</TableHead>
                    <TableHead className="text-right">Wars</TableHead>
                    <TableHead className="text-right">Marks</TableHead>
                    {fighting && <TableHead className="text-right">This war so far</TableHead>}
                    <TableHead className="text-right" title="Rating divided by the finished wars they were in">
                      Per war
                    </TableHead>
                    <TableHead className="text-right">Rating</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ranked.map((p, index) => (
                    <TableRow key={p.playerId}>
                      <TableCell className="text-muted-foreground text-right tabular-nums">{index + 1}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <TownHall level={p.thLevel} />
                          <Link
                            className="font-medium underline-offset-2 hover:underline"
                            href={`${base}/player/${encodeURIComponent(p.tag)}`}
                          >
                            {p.name}
                          </Link>
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{p.warsCounted}</TableCell>
                      <TableCell className="text-right">
                        <Marks value={p.marks} />
                      </TableCell>
                      {fighting && (
                        <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                          {p.provisional
                            ? `${signed(p.provisional.marks)} · ${oneDecimal(p.provisional.share)}%`
                            : "—"}
                        </TableCell>
                      )}
                      <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
                        {p.perWar === null ? "—" : oneDecimal(p.perWar)}
                      </TableCell>
                      <TableCell className="cb-title text-right text-base tabular-nums">
                        {oneDecimal(p.rating)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-muted-foreground text-xs">
              &ldquo;Per war&rdquo; is the rating divided by the finished wars played — the rating is a sum, so it
              is the fair comparison between someone in ten wars and someone in four.
              {attackOnly > 0 &&
                ` ${attackOnly} of the ${counted.length} finished wars ${attackOnly === 1 ? "is" : "are"} rated on attack only: the enemy's attacks were not recorded for wars before this was added, and cannot be fetched now.`}
            </p>
          </section>

          {shown && (
            <section className="cb-panel space-y-4 rounded-panel border p-5" aria-labelledby="war-title">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SectionHeader
                    id="war-title"
                    icon={ListChecks}
                    title={`${when(shown.war.startTime)} vs ${shown.war.opponentName ?? "unknown"}, mark by mark`}
                  />
                  <Badge variant={shown.war.attackOnly ? "warning" : "info"}>{warNote(shown.war)}</Badge>
                </div>
                <nav aria-label="War" className="flex flex-wrap gap-1.5">
                  {rated.map(({ war, index }) => (
                    <Link
                      key={war.id}
                      href={`${here}?month=${month}&war=${encodeURIComponent(war.id)}#war-title`}
                      aria-current={index === shown.index ? "page" : undefined}
                      title={`${war.opponentName ?? "unknown"} · ${warNote(war)}`}
                      className={cn(
                        "rounded-chip px-2.5 py-1 text-sm font-medium tabular-nums transition-colors",
                        index === shown.index
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground border",
                      )}
                    >
                      {when(war.startTime)}
                    </Link>
                  ))}
                </nav>
              </div>
              <p className="text-muted-foreground text-sm">
                {shown.war.status === "provisional"
                  ? "Still being fought: these marks move with every attack, and nobody has lost marks for an unused attack yet."
                  : `The clan's plus marks came to ${signed(shown.war.total)}; each share is a player's marks out of that. Minus marks are not taken off it.`}
                {shown.war.orderMissing &&
                  " A base hit by more than one of ours is scored as a first hit each time here: the order of the attacks was not recorded for this war."}
              </p>

              <div className="-mx-5 overflow-x-auto px-5">
                <Table className="min-w-[50rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-14">Base</TableHead>
                      <TableHead>Player</TableHead>
                      <TableHead className="w-72">Attacks</TableHead>
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
                              href={`${base}/player/${encodeURIComponent(row.tag)}`}
                            >
                              {row.name}
                            </Link>
                          </span>
                        </TableCell>
                        <TableCell className="space-y-2.5 align-top whitespace-normal">
                          {row.attacks.map((attack, i) => (
                            <div key={i} className="space-y-1">
                              <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
                                <Stars stars={attack.stars} />
                                <span className="tabular-nums">{attack.destruction.toFixed(0)}%</span>
                                <span className="text-muted-foreground">
                                  on #{attack.target?.base ?? "?"} {attack.target?.name ?? ""}
                                </span>
                                {attack.best && (
                                  <span className="text-foreground font-semibold">· best</span>
                                )}
                                <Marks value={attack.marks} className="ml-auto font-semibold" />
                              </p>
                              <Lines lines={attack.lines} />
                            </div>
                          ))}
                          {(row.bonus || row.missed) && (
                            <Lines lines={[row.bonus, row.missed].flatMap((l) => (l ? [l] : []))} />
                          )}
                          {row.attacks.length === 0 && !row.missed && (
                            <span className="text-muted-foreground text-xs">Not attacked yet</span>
                          )}
                        </TableCell>
                        <TableCell className="align-top">
                          {shown.war.attackOnly ? (
                            <span className="text-muted-foreground text-xs">Not recorded</span>
                          ) : (
                            <Lines lines={row.defence} empty="Not attacked yet" />
                          )}
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
                The war itself — targets, both rosters and the plan — is on the{" "}
                <Link href={`${base}/war?war=${encodeURIComponent(shown.war.id)}`} className="underline">
                  War board
                </Link>
                .
              </p>
            </section>
          )}
        </>
      )}

      <Disclosure title="How marks are given in a regular war" icon={Scale} defaultOpen={ranked.length === 0}>
        <div className="grid gap-6 text-sm md:grid-cols-2">
          <div className="space-y-2">
            <h3 className="font-semibold">Each attack</h3>
            <RuleList
              rules={[
                ["3 stars", CWL_MARKS.stars[3]],
                ["2 stars", CWL_MARKS.stars[2]],
                [`2 stars with ${CWL_MARKS.nearMiss.destruction}% destruction or more, extra`, CWL_MARKS.nearMiss.marks],
                ["1 star", CWL_MARKS.stars[1]],
                ["0 stars", CWL_MARKS.stars[0]],
                ["Each Town Hall level above your own", CWL_MARKS.thUp],
                ["The same Town Hall as your own", CWL_MARKS.sameTh],
                ["Each Town Hall level below your own", CWL_MARKS.thBelow],
                ["Each base above your own on the war map", CWL_MARKS.baseUp],
                ["Your mirror base, or any base above it", CWL_MARKS.mirror],
                ["Each base below your own", CWL_MARKS.baseBelow],
                ["3 stars on their last base", CWL_MARKS.targetRank.last],
                ["3 stars on their #1", WAR_RULES.rankTop ?? 0],
                ["The war's heroic attack", CWL_MARKS.heroicAttack],
              ]}
            />
            <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
              <li>
                The marks for hitting up — a higher Town Hall or a higher base — are only given for{" "}
                {CWL_MARKS.upNeedsStars} stars or more.
              </li>
              <li>
                The war map never gives more than {CWL_MARKS.baseUpCap} for bases up, and never takes more
                than {CWL_MARKS.baseBelowCap} for bases below.
              </li>
              <li>
                Three stars also score for how high the base sits on their map: their last base{" "}
                {signed(CWL_MARKS.targetRank.last)}, their #1 {signed(WAR_RULES.rankTop ?? 0)}, evenly between,
                whatever the size of the war.
              </li>
              <li>
                Not finishing away from your mirror: a higher base with 2 stars {signed(CWL_MARKS.shortUp[2])};
                a lower base with 2 stars {signed(CWL_MARKS.shortDown[2])}, 1 star{" "}
                {signed(CWL_MARKS.shortDown[1])}, none {signed(CWL_MARKS.shortDown[0])}.
              </li>
            </ul>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">Your two attacks together</h3>
            <ul className="text-muted-foreground list-disc space-y-1 pl-5">
              <li>
                Both are scored and added, and the <span className="text-foreground font-medium">better
                one counts {WAR_MARKS.bestAttack} times</span> when it is above zero: +12 and +4 is 12 ×{" "}
                {WAR_MARKS.bestAttack} + 4 = 22.
              </li>
              <li>
                An attack not used costs {signed(WAR_MARKS.missed)} each, once the war is over.
              </li>
              <li>
                <span className="text-foreground font-medium">A base a clanmate already hit:</span> you keep
                full marks if your attack adds a star. An attack that adds no new star gets no star marks
                and nothing for hitting up.
              </li>
            </ul>

            <h3 className="pt-2 font-semibold">Defence</h3>
            <RuleList
              rules={[
                ["Your base held to 0 stars", CWL_MARKS.defence[0]],
                ["Held to 1 star", CWL_MARKS.defence[1]],
                ["Held to 2 stars", CWL_MARKS.defence[2]],
                ["3-starred", CWL_MARKS.defence[3]],
                ["3-starred by an enemy base lower on the map than yours", CWL_MARKS.tripledFromBelow],
                ["Not attacked (once the war is over)", CWL_MARKS.notAttacked],
                ["The war's heroic defence", CWL_MARKS.heroicDefence],
              ]}
            />
            <p className="text-muted-foreground text-xs">
              Only the enemy&apos;s best attack on a base counts. Wars from before enemy attacks were recorded
              have no defence marks, and are labelled &ldquo;attack only&rdquo;.
            </p>

            <h3 className="pt-2 font-semibold">From marks to rating</h3>
            <p className="text-muted-foreground">
              War share = your marks ÷ the clan&apos;s plus marks in that war. Minus marks are left out of what
              is divided by, so the plus shares add up to 100%. A minus war is a minus share, never worse
              than {oneDecimal(CWL_MARKS.worstShare)}%. The rating is the shares of every finished war that
              started in the month, added up; players level on it are ordered by marks, then by average
              destruction.
            </p>
          </div>
        </div>
      </Disclosure>
    </main>
  );
}
