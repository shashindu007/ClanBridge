// T11B.10 — Base details for a member, as their clan's leadership sees it.
//
// LEADER AND CO-LEADER ONLY. A member's progress is theirs to share; leadership
// sees it because planning a war lineup is part of leading a clan. Anyone else in
// the clan gets notFound() rather than a "forbidden" page, matching
// requireClanByTag()'s reasoning: a distinguishable refusal confirms that the
// page exists for that player.
//
// R3 — the clan scope. Readings are confined to those taken while the village
// was in THIS clan, by the explicit filter in repositories/player-progress.ts
// and by 036's clan policy underneath it. A member who moved here from another
// clan shows only what has been read since they arrived.
//
// The member's own copy of this page is /account/bases/[tag]/details, and both
// render components/base-details.tsx, so the numbers cannot disagree.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BaseDetails, villageParam } from "@/components/base-details";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireClanByTag } from "@/lib/clans";
import { canSeeBaseDetails } from "@/lib/visibility";
import { createClient } from "@/lib/supabase/server";
import { decodeTag, encodeTag, InvalidTagError } from "@/lib/tags";
import { baseProgress } from "@/repositories/player-progress";

export const dynamic = "force-dynamic";

export default async function MemberBaseDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ clanTag: string; tag: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ clanTag, tag: rawTag }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const clan = await requireClanByTag(supabase, clanTag);
  if (!canSeeBaseDetails(clan.role)) notFound();

  let playerTag: string;
  try {
    playerTag = decodeTag(rawTag);
  } catch (error) {
    if (error instanceof InvalidTagError) notFound();
    throw error;
  }

  // The same clan-scoped lookup the profile page uses (R3).
  const { data } = await supabase
    .from("players")
    .select("id, tag, name, clan_role, left_at")
    .eq("clan_id", clan.id)
    .eq("tag", playerTag)
    .is("deleted_at", null);

  const player = (data ?? [])[0] as
    | { id: string; tag: string; name: string; clan_role: string | null; left_at: string | null }
    | undefined;
  if (!player) notFound();

  const progress = await baseProgress(supabase, { clanId: clan.id }, player.id);

  const encodedClan = encodeURIComponent(clan.tag);
  const encodedPlayer = encodeTag(player.tag);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="xs" className="-ml-2">
          <Link href={`/${encodedClan}/player/${encodedPlayer}`}>
            <ArrowLeft aria-hidden className="size-4" />
            {player.name}&apos;s profile
          </Link>
        </Button>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{player.name}</h1>
            <Badge variant="secondary">Base details</Badge>
            {player.clan_role && <Badge variant="outline">{player.clan_role}</Badge>}
            {player.left_at && <Badge variant="destructive">left the clan</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            <span className="font-mono text-xs">{player.tag}</span> · {clan.name}
          </p>
        </div>
      </div>

      <BaseDetails
        progress={progress}
        village={villageParam(query.village)}
        path={`/${encodedClan}/player/${encodedPlayer}/details`}
      />
    </main>
  );
}
