"use client";

// The freshness badge, made live — and the "Refresh now" button beside it.
//
// THE PROBLEM IT SOLVES. DataFreshness was computed once, on the server, when
// the page rendered. A member who opened the war board and left it open, or
// brought the installed app back from the background an hour later, read a
// green "updated 3 minutes ago" beside an attack list that had since changed —
// and had no way to know it without a reload, and no way to ask for newer data
// at all short of waiting for :17.
//
// Three things, all cheap:
//
//   1. The label ticks. freshness() is pure over (run, now), so the client
//      recomputes it every 30 s. The first client render uses the server's
//      clock (`renderedAt`) so hydration matches, then switches to the real one.
//   2. The page watches for new data. One tiny read of /api/sync-status a
//      minute while the tab is visible, at once when it becomes visible again,
//      and every 15 s while an update someone asked for is on its way. Only
//      when a newer run has finished does it router.refresh() — the page is
//      not re-rendered on a timer to produce the same board.
//   3. Anyone can ask for an update now. services/sync-now.ts decides whether
//      that is worth an Actions run; this only shows the answer.

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { DataFreshness } from "@/components/data-freshness";
import { Button } from "@/components/ui/button";
import { requestSync } from "@/app/(app)/[clanTag]/sync-actions";
import type { SyncStatus } from "@/app/api/sync-status/route";
import type { SyncRun } from "@/repositories/sync-log";
import { freshness } from "@/services/freshness";
import type { SyncNowState, SyncTarget } from "@/services/sync-now";

const TICK_MS = 30_000;
const POLL_MS = 60_000;
const POLL_EAGER_MS = 15_000;
/** How long to watch closely after asking — a run takes one to two minutes. */
const EAGER_FOR_MS = 5 * 60_000;

export function LiveSync({
  run,
  renderedAt,
  clanTag,
  target,
  canRefresh,
  canAdmin = false,
}: {
  /** The last finished run of the job this page shows, as the server read it. */
  run: SyncRun | null;
  /** The server's clock at render, so the first client paint matches it. */
  renderedAt: string;
  clanTag: string;
  target: SyncTarget;
  /** False when GitHub dispatch is not configured — then no button at all. */
  canRefresh: boolean;
  canAdmin?: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState(() => new Date(renderedAt));
  const [running, setRunning] = useState(false);
  const [eagerUntil, setEagerUntil] = useState(0);
  const [state, action, pending] = useActionState<SyncNowState | null, FormData>(
    requestSync,
    null,
  );

  // What this render shows. A poll that sees anything newer refreshes the page,
  // and the refreshed page arrives with a new `run` prop.
  const shownFinishedAt = run?.finishedAt ?? null;
  const shownRef = useRef(shownFinishedAt);
  shownRef.current = shownFinishedAt;

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // New data arrived with the refreshed page: the wait is over.
  useEffect(() => {
    setEagerUntil(0);
    setRunning(false);
  }, [shownFinishedAt]);

  useEffect(() => {
    if (state?.status === "dispatched" || state?.status === "running") {
      setEagerUntil(Date.now() + EAGER_FOR_MS);
    }
  }, [state]);

  const check = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const query = new URLSearchParams({ target, clan: clanTag });
      const response = await fetch(`/api/sync-status?${query}`, { cache: "no-store" });
      if (!response.ok) return;
      const status = (await response.json()) as SyncStatus;

      setRunning(status.runningSince !== null);
      const shown = shownRef.current;
      if (status.finishedAt && (!shown || status.finishedAt > shown)) {
        router.refresh();
      }
    } catch {
      // Offline, or the tab was suspended mid-request. The next tick retries.
    }
  }, [clanTag, router, target]);

  useEffect(() => {
    const eager = eagerUntil > Date.now();
    const id = setInterval(() => {
      void check();
      if (eager && Date.now() > eagerUntil) setEagerUntil(0);
    }, eager ? POLL_EAGER_MS : POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setNow(new Date());
        void check();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check, eagerUntil]);

  const updating = running || eagerUntil > now.getTime();
  const note =
    state && state.status !== "dispatched" && state.status !== "running" ? state.message : null;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <DataFreshness freshness={freshness(run, now)} canAdmin={canAdmin} />
      {canRefresh && (
        <form action={action} className="inline-flex">
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="clanTag" value={clanTag} />
          <Button
            type="submit"
            variant="outline"
            size="xs"
            disabled={pending || updating}
            aria-live="polite"
          >
            {pending || updating ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : (
              <RefreshCw aria-hidden />
            )}
            {updating ? "Updating…" : "Refresh now"}
          </Button>
        </form>
      )}
      {note && (
        <span className="text-muted-foreground text-xs" role="status">
          {note}
        </span>
      )}
    </span>
  );
}
