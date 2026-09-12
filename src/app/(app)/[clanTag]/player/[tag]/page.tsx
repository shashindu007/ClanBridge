// T3B.4 / T4.6 — the player profile. Objective O4: six months of a member's
// history in under thirty seconds.
//
// Judge this page against that sentence rather than against completeness. A
// leader arrives here asking one question — has this person been pulling their
// weight — and every section is a different way of answering it. War attacks,
// raids and Clan Games arrive with their own phases and are named below rather
// than omitted, so the page states what it does not know.
//
// R3 — scoped to ONE clan on purpose. A player who has moved between the three
// clans has a separate record in each, and merging them would show a leader of
// clan A a history built partly from clan B. Clan movement is the deliberate
// exception: see clanMovement() in repositories/members.ts, where RLS still
// restricts the answer to clans the caller belongs to.

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { requireClanByTag, visibleClans } from "@/lib/clans";
import { currentUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { decodeTag, InvalidTagError } from "@/lib/tags";
import { gamesForPlayer } from "@/repositories/clan-games";
import { playerSeasonHistory } from "@/repositories/cwl";
import { clanMovement, snapshotHistory } from "@/repositories/members";
import { seasonsForPlayer } from "@/repositories/raids";
import {
  attacksForWar,
  membersOfWar,
  targetsForWar,
  warsForClan,
} from "@/repositories/war";
import { playerGamesSummary } from "@/services/clan-games";
import { donationRatio, donationSeasons, lastActivityAt } from "@/services/members";
import { playerRaidSummary } from "@/services/raids";
import { warContribution } from "@/services/war";
import { DISPLAY_ZONE } from "@/lib/display-time";

export const dynamic = "force-dynamic";

/** Six months, because that is the window objective O4 names. */
const HISTORY_DAYS = 182;

/** The same window /war/report uses, so the two pages never show different totals. */
const WAR_WINDOW = 10;

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
function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DISPLAY_ZONE,
  });
}

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ clanTag: string; tag: string }>;
}) {
  const { clanTag, tag: rawTag } = await params;
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);

  let playerTag: string;
  try {
    playerTag = decodeTag(rawTag);
  } catch (error) {
    if (error instanceof InvalidTagError) notFound();
    throw error;
  }

  // R3 — found within this clan. RLS would deny another clan's player anyway;
  // the explicit filter is the mechanism, the policy is the net.
  const { data } = await supabase
    .from("players")
    .select("id, tag, name, th_level, verified, clan_role, left_at")
    .eq("clan_id", clan.id)
    .eq("tag", playerTag)
    .is("deleted_at", null);

  const player = (data ?? [])[0] as
    | {
        id: string;
        tag: string;
        name: string;
        th_level: number | null;
        verified: boolean;
        clan_role: string | null;
        left_at: string | null;
      }
    | undefined;

  if (!player) notFound();

  // T7.3 and T7.5 join the same batch rather than adding round trips of their
  // own. Both read the clan's own season list first and then one filtered query,
  // so they are two more reads in a batch that already issues four.
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
  const [history, snapshots, movement, userId, raidHistory, gamesHistory] =
    await Promise.all([
      playerSeasonHistory(supabase, clan.id, player.id),
      snapshotHistory(supabase, clan.id, player.id, since),
      clanMovement(supabase, player.id),
      currentUserId(supabase),
      seasonsForPlayer(supabase, clan.id, player.id),
      gamesForPlayer(supabase, clan.id, player.id),
    ]);

  const raids = playerRaidSummary(raidHistory);
  const games = playerGamesSummary(gamesHistory);

  const seasons = donationSeasons(snapshots);
  const lastSeen = lastActivityAt(snapshots);
  // Newest first — a leader reads the current month, then looks back.
  const donationRows = seasons.slice().reverse();

  // Movement returns clan ids; turn them into names the reader recognises. Only
  // clans this user may see resolve, which is the same restriction RLS already
  // applied to the query — an unresolved id is simply dropped rather than shown
  // as a bare uuid.
  const names = new Map(
    (userId ? await visibleClans(supabase, userId) : []).map((c) => [c.id, c.name]),
  );
  const movementRows = movement
    .map((m) => ({ ...m, name: names.get(m.clanId) }))
    .filter((m): m is typeof m & { name: string } => Boolean(m.name));

  // T6.9 — this member's war record, from the same recent window /war/report
  // uses. Computed with the shared derivation rather than a second query, so
  // the two pages cannot disagree about what "missed" means.
  const recentWars = await warsForClan(supabase, clan.id, WAR_WINDOW);
  // Ten wars at three sequential reads each was thirty round trips to a database
  // in another region, on a page whose whole objective (O4) is thirty seconds.
  // All of them now go at once.
  const perWar = await Promise.all(
    recentWars.map(async (war) => {
      const [members, attacks, targets] = await Promise.all([
        membersOfWar(supabase, war.id),
        attacksForWar(supabase, war.id),
        targetsForWar(supabase, war.id),
      ]);
      return { members, attacks, targets };
    }),
  );
  const warRecordForPlayer =
    warContribution(perWar).find((c) => c.playerId === player.id) ?? null;

  const totals = history.reduce(
    (sum, s) => ({
      warsRostered: sum.warsRostered + s.warsRostered,
      attacksUsed: sum.attacksUsed + s.attacksUsed,
      stars: sum.stars + s.stars,
    }),
    { warsRostered: 0, attacksUsed: 0, stars: 0 },
  );

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{player.name}</h1>
          {player.clan_role && <Badge variant="secondary">{player.clan_role}</Badge>}
          {player.verified && <Badge variant="outline">verified</Badge>}
          {player.left_at && <Badge variant="destructive">left the clan</Badge>}
        </div>
        <p className="text-muted-foreground text-sm">
          <span className="font-mono text-xs">{player.tag}</span>
          {player.th_level ? ` · Town Hall ${player.th_level}` : ""} ·{" "}
          <Link className="underline" href={`/${encodeURIComponent(clan.tag)}/cwl`}>
            {clan.name} CWL
          </Link>
          {lastSeen && ` · last activity seen ${dayLabel(lastSeen)}`}
        </p>
      </div>

      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Clan War League</h2>
          {history.length > 0 && (
            <p className="text-muted-foreground text-sm tabular-nums">
              {totals.attacksUsed} of {totals.warsRostered} attacks used ·{" "}
              {totals.stars} stars
            </p>
          )}
        </div>

        {history.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No CWL record for this member in {clan.name} yet. They have either not
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
                {history.map((s) => {
                  const missed = s.warsRostered - s.attacksUsed;
                  return (
                    <TableRow key={s.season}>
                      <TableCell className="font-medium">
                        <Link
                          className="underline-offset-2 hover:underline"
                          href={`/${encodeURIComponent(clan.tag)}/cwl/${encodeURIComponent(s.season)}`}
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

      {/* T3B.4 — clan movement. The one place this page deliberately looks
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
          here from one pass and the detail is a link. */}
      <section className="cb-panel space-y-4 rounded-lg border p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-medium">Clan war</h2>
          <Link
            className="text-sm underline"
            href={`/${encodeURIComponent(clan.tag)}/war/report`}
          >
            full report
          </Link>
        </div>

        {!warRecordForPlayer ? (
          <p className="text-muted-foreground text-sm">
            No war record for this member in {clan.name} yet. They have either not
            been in a war here, or the war sync has not run since one.
          </p>
        ) : (
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <div>
              <p className="text-2xl font-semibold tabular-nums">
                {warRecordForPlayer.attacksUsed}
                <span className="text-muted-foreground text-base">
                  {" "}
                  of {warRecordForPlayer.attacksAvailable}
                </span>
              </p>
              <p className="text-muted-foreground text-xs">
                attacks used across {warRecordForPlayer.warsPlayed} war
                {warRecordForPlayer.warsPlayed === 1 ? "" : "s"}
              </p>
            </div>
            <div>
              <p
                className={`text-lg font-medium tabular-nums ${
                  warRecordForPlayer.attacksMissed >= 3 ? "text-destructive" : ""
                }`}
              >
                {warRecordForPlayer.attacksMissed}
              </p>
              <p className="text-muted-foreground text-xs">
                missed
                {warRecordForPlayer.warsMissedEntirely > 0 &&
                  `, ${warRecordForPlayer.warsMissedEntirely} war${
                    warRecordForPlayer.warsMissedEntirely === 1 ? "" : "s"
                  } skipped entirely`}
              </p>
            </div>
            <div>
              <p className="text-lg font-medium tabular-nums">{warRecordForPlayer.stars}</p>
              <p className="text-muted-foreground text-xs">stars</p>
            </div>
            {warRecordForPlayer.targetsJudged > 0 && (
              <div>
                <p className="text-lg font-medium tabular-nums">
                  {warRecordForPlayer.targetsFollowed} of {warRecordForPlayer.targetsJudged}
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
          <Link
            className="text-sm underline"
            href={`/${encodeURIComponent(clan.tag)}/raids`}
          >
            all weekends
          </Link>
        </div>

        {raids.weekendsAvailable === 0 ? (
          <p className="text-muted-foreground text-sm">
            No raid weekends recorded for {clan.name} yet. The first one appears
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
          <Link
            className="text-sm underline"
            href={`/${encodeURIComponent(clan.tag)}/games`}
          >
            every month
          </Link>
        </div>

        {games.monthsAvailable === 0 ? (
          <p className="text-muted-foreground text-sm">
            No Clan Games months recorded for {clan.name} yet. The game publishes
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
    </main>
  );
}
