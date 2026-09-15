// T11.11 — the six panels of a village's report, so two pages cannot drift.
//
// A SERVER COMPONENT: no "use client", no hydration cost, no state. It takes the
// bundle repositories/player-report.ts assembled and renders it, and that is all.
//
// WHY A COMPONENT AND NOT TWO COPIES. [clanTag]/player/[tag] and
// /account/bases/[tag] answer the same question about the same subject from
// different doors — a leader looking at a member, and a member looking at
// themselves. Every number is identical. Two copies of six panels is two sets of
// empty-state wording, two places to add a seventh section (T11B.7 adds one), and
// eventually two different answers to "how many attacks did they miss".
//
// IT IS TESTED, in player-report-sections.test.ts, and it was worth finding out
// that it could be. vitest.config.ts includes `.ts` only and there is no jsdom,
// which reads like "no component tests" — but src/components/toaster.test.ts
// already renders a .tsx component from a .ts file with renderToStaticMarkup, and
// this component has no state and no effects, so that is enough to hold every
// panel, every empty state and the movement table's visibility rule.
//
// What a test still cannot hold is that the PROFILE PAGE is unchanged by the
// extraction, since that depends on the page's own props. That half of T11.11's
// done-when is a manual check.
//
// The links are all clan-scoped and take `clanTag` pre-encoded by the caller,
// because a tag is `#2PP0JCCL` and an unencoded hash would be read as a fragment.

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DISPLAY_ZONE } from "@/lib/display-time";
import type { PlayerReport } from "@/repositories/player-report";
import { HISTORY_DAYS } from "@/repositories/player-report";
import { donationRatio } from "@/services/members";

/**
 * A donation season's month. Stays UTC: the key is 'YYYY-MM' and the date is
 * constructed to sit inside it, so re-zoning could roll it into the neighbouring
 * month and label August's totals "Jul 2026".
 */
function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * A real instant — when a member joined a clan, when activity was last seen —
 * so it moves to clan-local time (T9.9). Sri Lanka is UTC+05:30, which is
 * enough to put a late-evening reading on the following day.
 */
export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DISPLAY_ZONE,
  });
}

export interface PlayerReportSectionsProps {
  report: PlayerReport;
  /** The clan these numbers are about, already URL-encoded. */
  clanTag: string;
  /** Its name, for the empty states — they say WHICH clan has no record yet. */
  clanName: string;
  /**
   * Clan ids to names, for the movement table.
   *
   * Passed in rather than resolved here, because resolving it means visibleClans()
   * and that is an authorisation read, not a presentational one. An id with no
   * entry is DROPPED rather than shown as a bare uuid — which is the same
   * restriction RLS already applied to the underlying query.
   */
  clanNames: Map<string, string>;
}

export function PlayerReportSections({
  report,
  clanTag,
  clanName,
  clanNames,
}: PlayerReportSectionsProps) {
  const { cwlSeasons, cwlTotals, donations, movement, raids, games, war } = report;

  // Newest first — a leader reads the current month, then looks back. The
  // repository deliberately returns oldest-first; this is the reading decision.
  const donationRows = donations.slice().reverse();

  const movementRows = movement
    .map((m) => ({ ...m, name: clanNames.get(m.clanId) }))
    .filter((m): m is typeof m & { name: string } => Boolean(m.name));

  return (
    <>
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Clan War League</h2>
          {cwlSeasons.length > 0 && (
            <p className="text-muted-foreground text-sm tabular-nums">
              {cwlTotals.attacksUsed} of {cwlTotals.warsRostered} attacks used ·{" "}
              {cwlTotals.stars} stars
            </p>
          )}
        </div>

        {cwlSeasons.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No CWL record for this member in {clanName} yet. They have either not
            played a CWL season here, or CWL has not run since the sync job
            started capturing it.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Season</TableHead>
                  <TableHead className="text-right">Wars</TableHead>
                  <TableHead className="text-right">Attacks</TableHead>
                  <TableHead className="text-right">Missed</TableHead>
                  <TableHead className="text-right">Stars</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cwlSeasons.map((s) => {
                  const missed = s.warsRostered - s.attacksUsed;
                  return (
                    <TableRow key={s.season}>
                      <TableCell className="font-medium">
                        <Link
                          className="underline-offset-2 hover:underline"
                          href={`/${clanTag}/cwl/${encodeURIComponent(s.season)}`}
                        >
                          {s.season}
                        </Link>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.warsRostered}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {s.attacksUsed}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {missed > 0 ? (
                          <span className="text-destructive">{missed}</span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.stars}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* T3B.4 — the donation trend.
          Each row is a completed month's FINAL cumulative reading, not a sum of
          deltas; see the header of services/members.ts for why that distinction
          decides whether these numbers are right. */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Donations</h2>
          <p className="text-muted-foreground text-sm">
            last {Math.round(HISTORY_DAYS / 30)} months
          </p>
        </div>

        {donationRows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No donation readings for this member yet. They arrive hourly with{" "}
            <code className="text-xs">sync:clans</code>, so this fills in on its
            own — and only ever covers months the sync was running for, because
            the game keeps no history of its own.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead className="text-right">Given</TableHead>
                  <TableHead className="text-right">Received</TableHead>
                  <TableHead className="text-right">Ratio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {donationRows.map((season) => {
                  const ratio = donationRatio(season.given, season.received);
                  return (
                    <TableRow key={season.from}>
                      <TableCell className="font-medium">
                        {monthLabel(season.to)}
                        {!season.complete && (
                          <span className="text-muted-foreground ml-2 text-xs">
                            in progress
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{season.given}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {season.received}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {ratio === null ? "—" : ratio.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* T3B.4 — clan movement. The one place this report deliberately looks
          across clans, because "where has this player been" is the question.
          RLS still limits the answer to clans the reader belongs to. */}
      {movementRows.length > 1 && (
        <section className="cb-panel space-y-4 rounded-lg border p-6">
          <h2 className="font-medium">Clan movement</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Clan</TableHead>
                <TableHead className="text-right">First seen</TableHead>
                <TableHead className="text-right">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movementRows.map((row) => (
                <TableRow key={row.clanId}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground text-right text-sm">
                    {dayLabel(row.firstSeen)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right text-sm">
                    {dayLabel(row.lastSeen)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground text-xs">
            History follows the player, not the clan (T3.9) — moving between our
            clans never detaches what they did before.
          </p>
        </section>
      )}

      {/* ── T6.9 — clan war ──────────────────────────────────────────────
          The aggregate lives on /war/report, which reads every recent war at
          once. Repeating that work per profile would make O4's thirty seconds a
          promise this page could not keep, so the headline numbers are computed
          from one pass and the detail is a link. */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Clan war</h2>
          <Link className="text-sm underline" href={`/${clanTag}/war/report`}>
            full report
          </Link>
        </div>

        {!war ? (
          <p className="text-muted-foreground text-sm">
            No war record for this member in {clanName} yet. They have either not
            been in a war here, or the war sync has not run since one.
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {war.attacksUsed}
                <span className="text-muted-foreground text-base">
                  {" "}
                  of {war.attacksAvailable}
                </span>
              </p>
              <p className="text-muted-foreground text-xs">
                attacks used across {war.warsPlayed} war
                {war.warsPlayed === 1 ? "" : "s"}
              </p>
            </div>
            <div>
              <p
                className={`text-lg font-medium tabular-nums ${
                  war.attacksMissed >= 3 ? "text-destructive" : ""
                }`}
              >
                {war.attacksMissed}
              </p>
              <p className="text-muted-foreground text-xs">
                missed
                {war.warsMissedEntirely > 0 &&
                  `, ${war.warsMissedEntirely} war${
                    war.warsMissedEntirely === 1 ? "" : "s"
                  } skipped entirely`}
              </p>
            </div>
            <div>
              <p className="text-lg font-medium tabular-nums">{war.stars}</p>
              <p className="text-muted-foreground text-xs">stars</p>
            </div>
            {war.targetsJudged > 0 && (
              <div>
                <p className="text-lg font-medium tabular-nums">
                  {war.targetsFollowed} of {war.targetsJudged}
                </p>
                {/* Only the wars where it could be judged. A member who was
                    never assigned a target has not ignored one. */}
                <p className="text-muted-foreground text-xs">hit the base they were given</p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── T7.3 — Raid Weekends ─────────────────────────────────────────────
          This section and the one below it replaced a dashed "Not built yet"
          box naming T7.3 and T7.5. Both were built in Phase 7 and both were
          tested; playerRaidSummary and playerGamesSummary simply had no caller,
          so the page went on saying they did not exist. The box was the last
          thing a leader read on the profile.

          `weekendsAvailable` is the denominator that makes the rest mean
          anything — see playerRaidSummary, which counts the weekends they sat
          out ON PURPOSE. "3 raids" is a different conversation depending on
          whether there have been four weekends or fourteen. */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Raid weekends</h2>
          <Link className="text-sm underline" href={`/${clanTag}/raids`}>
            all weekends
          </Link>
        </div>

        {raids.weekendsAvailable === 0 ? (
          <p className="text-muted-foreground text-sm">
            No raid weekends recorded for {clanName} yet. The first one appears
            after a weekend has been and the sync has run.
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {raids.weekendsRaided}
                <span className="text-muted-foreground text-base">
                  {" "}
                  of {raids.weekendsAvailable}
                </span>
              </p>
              <p className="text-muted-foreground text-xs">
                weekends they took part in
              </p>
            </div>
            <div>
              <p className="text-lg font-medium tabular-nums">{raids.attacksUsed}</p>
              <p className="text-muted-foreground text-xs">attacks used</p>
            </div>
            <div>
              <p className="text-lg font-medium tabular-nums">
                {raids.totalLoot.toLocaleString("en-GB")}
              </p>
              <p className="text-muted-foreground text-xs">capital loot</p>
            </div>
          </div>
        )}
      </section>

      {/* ── T7.5 — Clan Games ────────────────────────────────────────────────
          The average divides by months MEASURED, never by months available —
          see playerGamesSummary. A member who joined last month must not be
          scored against a year they were not here for. Both numbers are shown
          so the gap between them stays visible. */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Clan Games</h2>
          <Link className="text-sm underline" href={`/${clanTag}/games`}>
            every month
          </Link>
        </div>

        {games.monthsAvailable === 0 ? (
          <p className="text-muted-foreground text-sm">
            No Clan Games months recorded for {clanName} yet. The game publishes
            nothing about Clan Games, so a month only appears once the sync has
            taken both its snapshots — the 22nd and the 28th.
          </p>
        ) : games.monthsScored === 0 ? (
          <p className="text-muted-foreground text-sm">
            Nothing scored across {games.monthsAvailable} month
            {games.monthsAvailable === 1 ? "" : "s"}. That can mean they earned no
            points, or that they were not snapshotted at the start of a period —
            the months page keeps the two apart.
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {games.totalPoints.toLocaleString("en-GB")}
              </p>
              <p className="text-muted-foreground text-xs">
                points across {games.monthsScored} measured month
                {games.monthsScored === 1 ? "" : "s"}
                {games.monthsAvailable !== games.monthsScored &&
                  ` of ${games.monthsAvailable}`}
              </p>
            </div>
            <div>
              <p className="text-lg font-medium tabular-nums">
                {games.averagePoints?.toLocaleString("en-GB") ?? "—"}
              </p>
              <p className="text-muted-foreground text-xs">average a month</p>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
