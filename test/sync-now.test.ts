// "Refresh now" — when a member's request becomes a GitHub Actions run.
//
// Every run is paid from one shared budget of Actions minutes, and any approved
// member can press the button, so the refusals are the feature. The cases below
// are the ways it could quietly cost too much, or quietly do nothing.

import { describe, expect, it, vi } from "vitest";
import {
  SYNC_NOW_DAILY_LIMIT,
  SYNC_NOW_JOB_LIMIT,
  SYNC_NOW_USER_LIMIT,
  createMemoryRateLimiter,
  type RateLimitConfig,
  type RateLimiter,
} from "@/lib/rate-limit";
import type { DispatchOutcome, DispatchableJob } from "@/lib/github";
import {
  SYNC_TARGETS,
  isSyncTarget,
  requestSyncNow,
  type SyncNowDeps,
} from "@/services/sync-now";

type Deps = SyncNowDeps & { dispatch: ReturnType<typeof vi.fn> };

function deps(overrides: Partial<SyncNowDeps> = {}): Deps {
  const limiters = new Map<RateLimitConfig, RateLimiter>();
  const dispatch = vi.fn(
    async (_job: DispatchableJob): Promise<DispatchOutcome> => ({ ok: true }),
  );
  return {
    configured: true,
    runningSince: async () => null,
    limit: (config, key) => {
      let limiter = limiters.get(config);
      if (!limiter) {
        limiter = createMemoryRateLimiter(config);
        limiters.set(config, limiter);
      }
      return limiter.limit(key);
    },
    dispatch,
    ...overrides,
  } as Deps;
}

describe("requestSyncNow", () => {
  it("dispatches the workflow behind the page", async () => {
    const d = deps();
    const state = await requestSyncNow("cwl", "user-1", d);
    expect(state.status).toBe("dispatched");
    expect(d.dispatch).toHaveBeenCalledWith("cwl");
  });

  // sync-clans reads members AND the current war — one run answers both.
  it("refreshes the war board through the clans workflow", async () => {
    const d = deps();
    await requestSyncNow("war", "user-1", d);
    expect(d.dispatch).toHaveBeenCalledWith("clans");
  });

  it("says so, and dispatches nothing, when manual runs are not configured", async () => {
    const d = deps({ configured: false });
    expect((await requestSyncNow("war", "user-1", d)).status).toBe("unconfigured");
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it("does not queue a second run behind one already under way", async () => {
    const d = deps({
      runningSince: async (job) => (job === "war" ? "2026-09-26T10:00:00Z" : null),
    });
    expect((await requestSyncNow("war", "user-1", d)).status).toBe("running");
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  // Every workflow covers all three clans, so the cooldown is per workflow, not
  // per member and not per clan: a second member asking a minute later is told
  // the answer is already on its way.
  it("allows one run per workflow per cooldown, whoever asks", async () => {
    const d = deps();
    expect((await requestSyncNow("war", "user-1", d)).status).toBe("dispatched");
    expect((await requestSyncNow("clans", "user-2", d)).status).toBe("cooldown");
    expect(d.dispatch).toHaveBeenCalledTimes(1);
    // A different workflow has its own cooldown.
    expect((await requestSyncNow("raids", "user-2", d)).status).toBe("dispatched");
  });

  it("caps one member, even across different workflows", async () => {
    const keys: string[] = [];
    const d = deps({
      limit: async (config, key) => {
        keys.push(key);
        const blocked = config === SYNC_NOW_USER_LIMIT;
        return { success: !blocked, limit: 1, remaining: 0, reset: Date.now() + 60_000 };
      },
    });
    expect((await requestSyncNow("war", "user-1", d)).status).toBe("cooldown");
    expect(keys).toEqual(["sync-now:clans", "sync-now-user:user-1"]);
    expect(d.dispatch).not.toHaveBeenCalled();
  });

  it("stops at the daily ceiling", async () => {
    const d = deps({
      limit: async (config) => ({
        success: config !== SYNC_NOW_DAILY_LIMIT,
        limit: 1,
        remaining: 0,
        reset: Date.now() + 60_000,
      }),
    });
    const state = await requestSyncNow("war", "user-1", d);
    expect(state.status).toBe("cooldown");
    expect(state.message).toMatch(/allowance/);
  });

  // During a cooldown the answer is "someone already asked": that must cost the
  // member none of their own allowance.
  it("spends no personal allowance while the workflow is cooling down", async () => {
    const keys: string[] = [];
    const d = deps({
      limit: async (config, key) => {
        keys.push(key);
        return {
          success: config !== SYNC_NOW_JOB_LIMIT,
          limit: 1,
          remaining: 0,
          reset: Date.now() + 60_000,
        };
      },
    });
    await requestSyncNow("war", "user-1", d);
    expect(keys).toEqual(["sync-now:clans"]);
  });

  // A member cannot fix a GitHub token; the detail belongs in the log, not the page.
  it("reports a failed dispatch without leaking GitHub's detail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const d = deps({
      dispatch: vi.fn(
        async (): Promise<DispatchOutcome> => ({
          ok: false,
          reason: "unauthorised",
          detail: "GitHub rejected the token.",
        }),
      ),
    });
    const state = await requestSyncNow("war", "user-1", d);
    expect(state.status).toBe("error");
    expect(state.message).not.toMatch(/token/i);
  });
});

describe("isSyncTarget", () => {
  it("accepts exactly the page targets", () => {
    for (const target of Object.keys(SYNC_TARGETS)) expect(isSyncTarget(target)).toBe(true);
    for (const value of ["players", "backup", "", "toString", "__proto__"]) {
      expect(isSyncTarget(value), value).toBe(false);
    }
  });
});
