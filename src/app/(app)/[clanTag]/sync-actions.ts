"use server";

// "Refresh now", as a Server Action. The rules live in services/sync-now.ts;
// this file is the wiring: who is asking, for which clan, and the real GitHub,
// Upstash and sync_log behind the service's dependencies.
//
// Authority is checked here rather than by RLS because dispatching a workflow
// is not a database write. Any approved member of the clan may ask — the same
// people who can read the page the button sits on. requireClanByTag answers
// that, and 404s for a clan the caller cannot see.

import { createClient } from "@/lib/supabase/server";
import { currentUserId } from "@/lib/auth";
import { requireClanByTag } from "@/lib/clans";
import { dispatchConfig, dispatchWorkflow } from "@/lib/github";
import { sharedRateLimiter } from "@/lib/rate-limit";
import { runningSince } from "@/repositories/sync-log";
import { isSyncTarget, requestSyncNow, type SyncNowState } from "@/services/sync-now";

export async function requestSync(
  _previous: SyncNowState | null,
  formData: FormData,
): Promise<SyncNowState> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { status: "error", message: "Sign in again to refresh." };

  const target = String(formData.get("target") ?? "");
  if (!isSyncTarget(target)) return { status: "error", message: "Unknown page." };

  const clan = await requireClanByTag(supabase, String(formData.get("clanTag") ?? ""));

  try {
    return await requestSyncNow(target, userId, {
      configured: dispatchConfig() !== null,
      runningSince: (jobType) => runningSince(supabase, jobType, clan.id),
      limit: async (config, key) => (await sharedRateLimiter(config)).limit(key),
      dispatch: dispatchWorkflow,
    });
  } catch (error) {
    // Upstash unreachable, most likely. Failing closed: no limiter, no dispatch.
    console.error(`sync-now: ${error instanceof Error ? error.message : error}`);
    return { status: "error", message: "Could not start an update. Try again later." };
  }
}
