// The server half of LiveSync: the two things only the server knows.
//
// Whether "Refresh now" can work at all (GitHub dispatch configured — an
// environment variable the browser must never see), and the clock at render,
// so the badge's first client paint says exactly what the server said.

import { LiveSync } from "@/components/live-sync";
import { dispatchConfig } from "@/lib/github";
import type { SyncRun } from "@/repositories/sync-log";
import type { SyncTarget } from "@/services/sync-now";

export function SyncBadge({
  run,
  clanTag,
  target,
  canAdmin = false,
}: {
  run: SyncRun | null;
  clanTag: string;
  target: SyncTarget;
  canAdmin?: boolean;
}) {
  return (
    <LiveSync
      run={run}
      renderedAt={new Date().toISOString()}
      clanTag={clanTag}
      target={target}
      canRefresh={dispatchConfig() !== null}
      canAdmin={canAdmin}
    />
  );
}
