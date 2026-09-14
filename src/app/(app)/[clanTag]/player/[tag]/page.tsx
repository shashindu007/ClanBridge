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
//
// T11.11 — the six panels and the batch behind them now live in
// components/player-report-sections.tsx and repositories/player-report.ts, because
// /account/bases/[tag] renders the same report for a member looking at their own
// village. What stays HERE is everything that is specific to a leader arriving
// from the member directory: the clan-scoped lookup, and the header naming the
// player. Nothing about what this page renders changed in that move.

import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  PlayerReportSections,
  dayLabel,
} from "@/components/player-report-sections";
import { requireClanByTag, visibleClans } from "@/lib/clans";
import { currentUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { decodeTag, InvalidTagError } from "@/lib/tags";
import { playerReport } from "@/repositories/player-report";

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
  //
  // Note this stays a clan-scoped lookup even though 031 added an owner-scoped
  // policy to `players`. A leader reaching a member through the directory must see
  // the same thing whether or not that member happens to be themselves.
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

  // The report's own seven reads, plus the one this page needs to turn clan ids
  // into names. Issued together: the name lookup does not depend on the report.
  const [report, userId] = await Promise.all([
    playerReport(supabase, clan.id, player.id),
    currentUserId(supabase),
  ]);

  // Only clans this user may see resolve, which is the same restriction RLS
  // already applied to the movement query — an unresolved id is dropped by the
  // sections component rather than shown as a bare uuid.
  const clanNames = new Map(
    (userId ? await visibleClans(supabase, userId) : []).map((c) => [c.id, c.name]),
  );

  const encodedTag = encodeURIComponent(clan.tag);

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
          <Link className="underline" href={`/${encodedTag}/cwl`}>
            {clan.name} CWL
          </Link>
          {report.lastSeen && ` · last activity seen ${dayLabel(report.lastSeen)}`}
        </p>
      </div>

      <PlayerReportSections
        report={report}
        clanTag={encodedTag}
        clanName={clan.name}
        clanNames={clanNames}
      />
    </main>
  );
}
