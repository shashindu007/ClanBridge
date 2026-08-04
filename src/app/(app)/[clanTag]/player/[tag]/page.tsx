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
import { playerSeasonHistory } from "@/repositories/cwl";
import { clanMovement, snapshotHistory } from "@/repositories/members";
import { donationRatio, donationSeasons, lastActivityAt } from "@/services/members";

export const dynamic = "force-dynamic";

/** Six months, because that is the window objective O4 names. */
const HISTORY_DAYS = 182;

function monthLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
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

  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
  const [history, snapshots, movement, userId] = await Promise.all([
    playerSeasonHistory(supabase, clan.id, player.id),
    snapshotHistory(supabase, clan.id, player.id, since),
    clanMovement(supabase, player.id),
    currentUserId(supabase),
  ]);

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

      <section className="space-y-4 rounded-lg border p-6">
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
      <section className="space-y-4 rounded-lg border p-6">
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
        <section className="space-y-4 rounded-lg border p-6">
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

      {/* Named rather than omitted, so the page states what it does not yet know
          instead of implying this is the member's whole record. */}
      <section className="space-y-2 rounded-lg border border-dashed p-6">
        <h2 className="text-muted-foreground font-medium">Not built yet</h2>
        <ul className="text-muted-foreground list-inside list-disc text-sm">
          <li>Clan war attacks and target adherence (T6.9)</li>
          <li>Raid Weekend participation (T7.3)</li>
          <li>Clan Games points (T7.5)</li>
        </ul>
      </section>
    </main>
  );
}
