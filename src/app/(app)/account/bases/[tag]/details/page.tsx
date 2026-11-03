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
// T11B.12 — the owner, and only the owner, can also upload their in-game village
// export for buildings, walls and timers. Since 076 it is SAVED, owner-only,
// and shown here and on Home until they upload a newer one; 076's header says
// what is kept and why. Not on the leader's page: it is the member's own game
// data, and no leader can read it.
//
// R1 — every read is PostgreSQL.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { BaseDetails, villageParam } from "@/components/base-details";
import { SavedVillageExport } from "@/components/village-export-saved";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { currentUserId } from "@/lib/auth";
import { baseLabel } from "@/lib/nickname";
import { createClient } from "@/lib/supabase/server";
import { decodeTag, encodeTag, InvalidTagError } from "@/lib/tags";
import { basesForUser } from "@/repositories/account-bases";
import { baseProgress } from "@/repositories/player-progress";
import { villageExportsFor, type SavedExport } from "@/repositories/village-exports";
import { safeMessage } from "@/lib/errors";

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
  const [progress, exports] = await Promise.all([
    baseProgress(supabase, "owner", base.playerId),
    // Losing it shows the upload form, not an error page.
    villageExportsFor(supabase, [base.playerId]).catch((error: unknown) => {
      safeMessage("base-details-export", { message: String(error) }, "");
      return new Map<string, SavedExport>();
    }),
  ]);
  const saved = exports.get(base.playerId) ?? null;

  const label = baseLabel(base.nickname, base.name);
  const named = label !== base.name;
  const encoded = encodeTag(base.tag);

  return (
    <main className="mx-auto max-w-narrow space-y-6 p-4 sm:p-6">
      <PageHeader
        back={{ href: "/account", label: "Profile" }}
        eyebrow="Base details"
        title={label}
        ribbons={base.verified ? <Badge variant="outline">verified</Badge> : undefined}
        description={
          <>
            {named && <>{base.name} · </>}
            <span className="font-mono text-xs">{base.tag}</span>
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/account/bases/${encoded}`}>
              <ScrollText aria-hidden />
              Report
            </Link>
          </Button>
        }
      />

      <SavedVillageExport
        tag={base.tag}
        label={label}
        village={saved?.village ?? null}
        now={new Date().toISOString()}
      />

      <BaseDetails
        progress={progress}
        village={villageParam(query.village)}
        path={`/account/bases/${encoded}/details`}
      />
    </main>
  );
}
