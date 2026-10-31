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
import { Castle, Hash, History, UserRoundX } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { PlayerCareer } from "@/components/player-career";
import { EmptyState, FactRow, Panel } from "@/components/kit";
import { TownHall } from "@/components/game/town-hall";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  PlayerReportSections,
  dayLabel,
} from "@/components/player-report-sections";
import { requireClanByTag, visibleClans } from "@/lib/clans";
import { canSeeBaseDetails } from "@/lib/visibility";
import { currentUserId } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assertRead } from "@/lib/errors";
import { decodeTag, encodeTag, InvalidTagError } from "@/lib/tags";
import { playerReport } from "@/repositories/player-report";
import { playerProfile } from "@/repositories/profiles";

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

  // By tag, NOT by clan, and the report below is what stays scoped (R3). A player
  // has one row, and sync:clans moves its clan_id when they move. The family moves
  // players between clans for CWL, so filtering here turned every link to a moved
  // player, from this clan's CWL, war, raid and rating pages, into a 404.
  //
  // RLS decides whether the row comes back: this viewer's clans, and their own.
  const { data, error } = await supabase
    .from("players")
    .select("id, tag, name, th_level, verified, clan_role, left_at, league_tier, clan_id")
    .eq("tag", playerTag)
    .is("deleted_at", null);
  assertRead(error, "players");

  const player = (data ?? [])[0] as
    | {
        id: string;
        tag: string;
        name: string;
        th_level: number | null;
        verified: boolean;
        clan_role: string | null;
        left_at: string | null;
        league_tier: string | null;
        clan_id: string;
      }
    | undefined;

  if (!player) {
    return (
      <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
        <PageHeader
          back={{ href: `/${encodeURIComponent(clan.tag)}/members`, label: "Members" }}
          eyebrow={clan.name}
          title="Player not in this clan"
        />
        <Panel>
          <EmptyState
            icon={UserRoundX}
            title="This player has moved on"
            body="They are not in this clan now, and not in another clan of yours. Their part in past wars and CWL seasons stays on those pages."
          />
        </Panel>
      </main>
    );
  }

  // Their history here is still theirs, so the page stays. It just says so.
  const moved = player.clan_id !== clan.id;

  // The report's own seven reads, plus the one this page needs to turn clan ids
  // into names. Issued together: the name lookup does not depend on the report.
  const [report, userId, profile] = await Promise.all([
    playerReport(supabase, clan.id, player.id),
    currentUserId(supabase),
    // 065 — clan-scoped like everything else here (R3).
    playerProfile(supabase, player.id, { clanId: clan.id }),
  ]);

  // Only clans this user may see resolve, which is the same restriction RLS
  // already applied to the movement query — an unresolved id is dropped by the
  // sections component rather than shown as a bare uuid.
  const clanNames = new Map(
    (userId ? await visibleClans(supabase, userId) : []).map((c) => [c.id, c.name]),
  );

  const encodedTag = encodeURIComponent(clan.tag);

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      {/* The player at a glance: their Town Hall as the picture, then who they
          are in a line of facts. There used to be no summary at all — the Town
          Hall was a clause in a sentence — and a "{clan} CWL" link sat in the
          middle of it, which is the CWL tab one row up. */}
      <PageHeader
        back={{ href: `/${encodedTag}/members`, label: "Members" }}
        eyebrow={clan.name}
        title={player.name}
        art={<TownHall level={player.th_level} size="lg" />}
        ribbons={
          player.clan_role || player.verified || player.left_at ? (
            <>
              {moved && !player.left_at && (
                <Badge variant="secondary">now in {clanNames.get(player.clan_id) ?? "another clan"}</Badge>
              )}
              {player.clan_role && !moved && <Badge variant="secondary">{player.clan_role}</Badge>}
              {player.league_tier && <Badge variant="outline">{player.league_tier}</Badge>}
              {player.verified && <Badge variant="outline">verified</Badge>}
              {player.left_at && <Badge variant="destructive">left the clan</Badge>}
            </>
          ) : undefined
        }
        actions={
          // T11B.10 — leadership only, matching the details page's own gate, so
          // nobody is shown a button that leads to a 404.
          canSeeBaseDetails(clan.role) && !moved ? (
            <Button asChild variant="outline">
              <Link href={`/${encodedTag}/player/${encodeTag(player.tag)}/details`}>
                <Castle aria-hidden />
                Base details
              </Link>
            </Button>
          ) : undefined
        }
      />

      <FactRow
        items={[
          { label: "tag", value: <span className="font-mono text-xs">{player.tag}</span>, icon: Hash },
          ...(report.lastSeen
            ? [{ label: "last activity seen", value: dayLabel(report.lastSeen), icon: History }]
            : []),
        ]}
      />

      <PlayerReportSections
        report={report}
        clanTag={encodedTag}
        clanName={clan.name}
        clanNames={clanNames}
      />

      <PlayerCareer profile={profile} departed={moved || player.left_at !== null} />
    </main>
  );
}
