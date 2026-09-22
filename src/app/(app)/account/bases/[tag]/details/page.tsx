// T11B.10 — Base details for one of your own villages.
//
// AUTHORISED BY OWNERSHIP, EXACTLY AS THE REPORT BESIDE IT IS (T11.12). The gate
// is basesForUser(): a tag that is not in the caller's own list is notFound(),
// with 404 rather than 403 for the reason that page records.
//
// UNLIKE THE REPORT, THERE IS NO DEGRADED BRANCH. The report reads clan-filtered
// history, so a village outside the member's clans has nothing to show there.
// Progress is different: 036's owner policy admits every reading of a village the
// member owns, and scripts/sync/players.ts reads owned villages wherever they
// are. So this page works for every base on /account, which is why its button
// there is shown for all of them.
//
// T11B.12 — the owner, and only the owner, can also paste their in-game village
// export for buildings, walls and timers. Parsed in the browser and never stored;
// see components/village-export-paste.tsx. Not on the leader's page: it is the
// member's own game data, and nothing about it passes through this server.
//
// R1 — every read is PostgreSQL.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { BaseDetails, villageParam } from "@/components/base-details";
import { VillageExportPaste } from "@/components/village-export-paste";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentUserId } from "@/lib/auth";
import { baseLabel } from "@/lib/nickname";
import { createClient } from "@/lib/supabase/server";
import { decodeTag, encodeTag, InvalidTagError } from "@/lib/tags";
import { basesForUser } from "@/repositories/account-bases";
import { baseProgress } from "@/repositories/player-progress";

export const dynamic = "force-dynamic";

export default async function OwnBaseDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tag: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ tag: rawTag }, query] = await Promise.all([params, searchParams]);
  const supabase = await createClient();

  const userId = await currentUserId(supabase);
  if (!userId) notFound();

  let playerTag: string;
  try {
    playerTag = decodeTag(rawTag);
  } catch (error) {
    if (error instanceof InvalidTagError) notFound();
    throw error;
  }

  // The gate. Ownership, not clan — see the header.
  const bases = await basesForUser(supabase, userId);
  const base = bases.find((b) => b.tag === playerTag);
  if (!base) notFound();

  // "owner" scope: every reading of this village, whichever clan it was in.
  const progress = await baseProgress(supabase, "owner", base.playerId);

  const label = baseLabel(base.nickname, base.name);
  const named = label !== base.name;
  const encoded = encodeTag(base.tag);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost" size="xs" className="-ml-2">
            <Link href="/account">
              <ArrowLeft aria-hidden className="size-4" />
              Your bases
            </Link>
          </Button>
          <Button asChild variant="ghost" size="xs">
            <Link href={`/account/bases/${encoded}`}>Report for this base</Link>
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="cb-title text-3xl">{label}</h1>
            <Badge variant="secondary">Base details</Badge>
            {base.verified && <Badge variant="outline">verified</Badge>}
          </div>
          <p className="text-muted-foreground text-sm">
            {named && <>{base.name} · </>}
            <span className="font-mono text-xs">{base.tag}</span>
          </p>
        </div>
      </div>

      <VillageExportPaste tag={base.tag} label={label} />

      <BaseDetails
        progress={progress}
        village={villageParam(query.village)}
        path={`/account/bases/${encoded}/details`}
      />
    </main>
  );
}
