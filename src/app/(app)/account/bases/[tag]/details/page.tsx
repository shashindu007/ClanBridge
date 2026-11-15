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
// 079 — the upgrade tracker. The timers a member started here are read beside
// the export and laid over it (services/village-overlay.ts), so a level that
// finished a minute ago shows as done without anything being written. What is
// left, with prices, is worked out HERE from the server-only price table, and
// only the handful of rows this village needs reach the browser.
//
// R1 — every read is PostgreSQL.

import Link from "next/link";
import { notFound } from "next/navigation";
import { ScrollText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { BaseDetails, VillageSwitch, villageParam } from "@/components/base-details";
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
import { trackedUpgradesFor } from "@/repositories/tracked-upgrades";
import { safeMessage } from "@/lib/errors";
import { remainingUpgrades, runningLoads } from "@/services/upgrades";
import { applyTracked, type TrackedUpgrade } from "@/services/village-overlay";

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
  const [progress, exports, tracked] = await Promise.all([
    baseProgress(supabase, "owner", base.playerId),
    // Losing it shows the upload form, not an error page.
    villageExportsFor(supabase, [base.playerId]).catch((error: unknown) => {
      safeMessage("base-details-export", { message: String(error) }, "");
      return new Map<string, SavedExport>();
    }),
    // Losing the timers shows the export as the game took it, not an error page.
    trackedUpgradesFor(supabase, [base.playerId]).catch((error: unknown) => {
      safeMessage("base-details-tracked", { message: String(error) }, "");
      return new Map<string, TrackedUpgrade[]>();
    }),
  ]);
  const saved = exports.get(base.playerId) ?? null;

  const label = baseLabel(base.nickname, base.name);
  const named = label !== base.name;
  const encoded = encodeTag(base.tag);
  const path = `/account/bases/${encoded}/details`;
  const which = villageParam(query.village);

  const now = new Date();
  const current = saved ? applyTracked(saved.village, tracked.get(base.playerId) ?? [], now, progress.latest).village : null;
  const tracker = current
    ? { items: remainingUpgrades(current, which, now), running: runningLoads(current, which, now) }
    : undefined;

  return (
    <main className="mx-auto max-w-page space-y-6 p-4 sm:p-6">
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

      {/* One switch for the whole page: the export and the API grid below it
          always show the same village. */}
      <VillageSwitch
        path={path}
        current={which}
        thLevel={saved?.village.thLevel ?? progress.latest?.thLevel ?? null}
        bhLevel={saved?.village.bhLevel ?? progress.latest?.bhLevel ?? null}
      />

      <SavedVillageExport
        tag={base.tag}
        label={label}
        village={current}
        now={now.toISOString()}
        which={which}
        tracker={tracker}
      />

      <BaseDetails progress={progress} village={which} path={path} switcher={false} banner={!saved} />
    </main>
  );
}
