// T4.6 — one member's CWL record across every season.
//
// This page is eventually T3B.4, the full player profile, and objective O4: six
// months of a member's history in under thirty seconds. Only the CWL section is
// built here — war attacks, raids, Clan Games and donation trends arrive with
// their own phases, and each is marked below so the gaps are visible rather than
// quietly absent.
//
// R3 — scoped to ONE clan on purpose. A player who has moved between the three
// clans has a separate record in each, and merging them would show a leader of
// clan A a history built partly from clan B.

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
import { requireClanByTag } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import { decodeTag, InvalidTagError } from "@/lib/tags";
import { playerSeasonHistory } from "@/repositories/cwl";

export const dynamic = "force-dynamic";

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

  const history = await playerSeasonHistory(supabase, clan.id, player.id);
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

      {/* Named rather than omitted, so the page states what it does not yet know
          instead of implying this is the member's whole record. */}
      <section className="space-y-2 rounded-lg border border-dashed p-6">
        <h2 className="text-muted-foreground font-medium">Not built yet</h2>
        <ul className="text-muted-foreground list-inside list-disc text-sm">
          <li>Clan war attacks and target adherence (T6.9)</li>
          <li>Raid Weekend participation (T7.3)</li>
          <li>Clan Games points (T7.5)</li>
          <li>Donation trend and activity score (T3B.3, T3B.5)</li>
        </ul>
      </section>
    </main>
  );
}
