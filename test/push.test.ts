// T5.6 / T5.8 — the sending path and the watchdog, without a push service.
//
// web-push is mocked. What is being tested here is the decision-making around
// the send, which is where the bugs that matter live:
//
//   * a dead endpoint must not take the other twenty-nine down with it
//   * 410 Gone must retire the row rather than be retried every two hours
//   * a member who opted out must not be reachable via notifyUsers
//   * "stale" must mean the same thing here as it does on the page indicator
//
// The delivery itself is somebody else's library and is not re-tested.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
const setVapidDetails = vi.fn();

vi.mock("web-push", () => ({
  default: {
    sendNotification: (...args: unknown[]) => sendNotification(...args),
    setVapidDetails: (...args: unknown[]) => setVapidDetails(...args),
  },
}));

import {
  notifyUsers,
  pushConfigured,
  retireExpired,
  sendPush,
  type PushTarget,
} from "@/lib/push";
import { alertStaleJobs, staleJobs } from "../scripts/sync/alerts";

const PAYLOAD = { title: "t", body: "b", url: "/" };

function target(n: number): PushTarget {
  return {
    user_id: `user-${n}`,
    endpoint: `https://push.example/${n}`,
    p256dh: "key",
    auth_key: "auth",
  };
}

/** A push service rejection, which web-push reports via statusCode. */
function rejection(statusCode: number) {
  return Object.assign(new Error(`push failed ${statusCode}`), { statusCode });
}

describe("T5.6 — sendPush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VAPID_PRIVATE_KEY = "private";
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
  });

  afterEach(() => {
    delete process.env.VAPID_PRIVATE_KEY;
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_SUBJECT;
  });

  it("sends one notification per target", async () => {
    sendNotification.mockResolvedValue({});

    const result = await sendPush([target(1), target(2), target(3)], PAYLOAD);

    expect(sendNotification).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ sent: 3, expired: [], failed: 0 });
  });

  it("does nothing, and does not throw, with no targets", async () => {
    const result = await sendPush([], PAYLOAD);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  // The failure this prevents: an announcement that 500s because one member's
  // browser rotated an endpoint last Tuesday.
  it("delivers to the rest when one endpoint fails", async () => {
    sendNotification
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(rejection(500))
      .mockResolvedValueOnce({});

    const result = await sendPush([target(1), target(2), target(3)], PAYLOAD);

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);
  });

  it.each([404, 410])("treats %i as permanently gone, not as a failure", async (status) => {
    sendNotification.mockRejectedValue(rejection(status));

    const result = await sendPush([target(1)], PAYLOAD);

    expect(result.expired).toEqual(["https://push.example/1"]);
    expect(result.failed).toBe(0);
  });

  // A transient 500 must NOT retire the row. Doing so would quietly unsubscribe
  // a member because a push service had a bad minute, and nothing would tell
  // them: they would simply stop receiving notifications.
  it("does not retire an endpoint that failed transiently", async () => {
    sendNotification.mockRejectedValue(rejection(500));

    const result = await sendPush([target(1)], PAYLOAD);

    expect(result.expired).toEqual([]);
    expect(result.failed).toBe(1);
  });

  it("sends nothing when VAPID keys are absent (before T0.10)", async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    expect(pushConfigured()).toBe(false);

    const result = await sendPush([target(1)], PAYLOAD);

    expect(sendNotification).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it("carries the payload as JSON the service worker can parse", async () => {
    sendNotification.mockResolvedValue({});

    await sendPush([target(1)], { title: "T", body: "B", url: "/x", tag: "k" });

    const body = sendNotification.mock.calls[0]![1] as string;
    expect(JSON.parse(body)).toEqual({ title: "T", body: "B", url: "/x", tag: "k" });
  });
});

describe("T5.6 — notifyUsers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.VAPID_PRIVATE_KEY = "private";
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "public";
    process.env.VAPID_SUBJECT = "mailto:test@example.com";
  });

  /** Minimal stand-in: only .rpc() and the update chain are exercised. */
  function fakeSupabase(targets: PushTarget[]) {
    return {
      rpc: vi.fn().mockResolvedValue({ data: targets, error: null }),
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          in: vi.fn(() => ({ is: vi.fn().mockResolvedValue({ error: null }) })),
        })),
      })),
    } as never;
  }

  it("sends only to the users asked for", async () => {
    sendNotification.mockResolvedValue({});
    const supabase = fakeSupabase([target(1), target(2), target(3)]);

    const result = await notifyUsers(supabase, "clan", "poll_reminders", ["user-2"], PAYLOAD);

    expect(result.sent).toBe(1);
    expect(sendNotification.mock.calls[0]![0]).toMatchObject({
      endpoint: "https://push.example/2",
    });
  });

  // push_targets() has already applied the clan filter and the opt-out. A user
  // id that is not in its result must not be reachable by naming it — otherwise
  // the authority check could be bypassed by guessing.
  it("cannot reach a user push_targets did not return", async () => {
    sendNotification.mockResolvedValue({});
    const supabase = fakeSupabase([target(1)]);

    const result = await notifyUsers(
      supabase,
      "clan",
      "poll_reminders",
      ["user-999"],
      PAYLOAD,
    );

    expect(sendNotification).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it("skips the round trip entirely for an empty list", async () => {
    const supabase = fakeSupabase([target(1)]);

    const result = await notifyUsers(supabase, "clan", "poll_reminders", [], PAYLOAD);

    expect(result.sent).toBe(0);
    expect(sendNotification).not.toHaveBeenCalled();
  });
});

describe("T5.6 — retireExpired", () => {
  it("does not issue a statement for an empty list", async () => {
    const rpc = vi.fn();
    await retireExpired({ rpc } as never, []);
    expect(rpc).not.toHaveBeenCalled();
  });

  // Through the 056 definer function: a plain UPDATE under a leader's RLS could
  // retire only the leader's own rows.
  it("retires through retire_push_endpoints", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    await retireExpired({ rpc } as never, ["https://push.example/1"]);
    expect(rpc).toHaveBeenCalledWith("retire_push_endpoints", {
      p_endpoints: ["https://push.example/1"],
    });
  });
});

describe("T5.8 — staleJobs", () => {
  const now = new Date("2026-08-05T12:00:00Z");

  function ago(hours: number): string {
    return new Date(now.getTime() - hours * 3_600_000).toISOString();
  }

  it("passes a job that ran inside its threshold", () => {
    // clans is hourly, stale after two hours.
    const health = staleJobs([{ jobType: "clans", finishedAt: ago(1) }], ["clans"], now);
    expect(health[0]!.stale).toBe(false);
  });

  it("flags a job that has gone past its threshold", () => {
    const health = staleJobs([{ jobType: "clans", finishedAt: ago(5) }], ["clans"], now);
    expect(health[0]!.stale).toBe(true);
  });

  // cwl runs every two hours and is allowed three, so the thresholds are not
  // interchangeable — a shared default would call a healthy CWL sync stale on
  // every other tick, which is the alert-fatigue failure R10 warns about.
  it("uses each job's own threshold", () => {
    const health = staleJobs(
      [
        { jobType: "clans", finishedAt: ago(2.5) },
        { jobType: "cwl", finishedAt: ago(2.5) },
      ],
      ["clans", "cwl"],
      now,
    );

    expect(health.find((h) => h.jobType === "clans")!.stale).toBe(true);
    expect(health.find((h) => h.jobType === "cwl")!.stale).toBe(false);
  });

  // On a fresh install every job has never run. Alerting then would fire on the
  // day the system is installed, and an alert that is wrong on day one is one
  // nobody believes on day ninety.
  it("does not flag a job that has never succeeded", () => {
    const health = staleJobs([], ["clans", "cwl"], now);
    expect(health.every((h) => h.stale)).toBe(false);
    expect(health.every((h) => h.ageMs === null)).toBe(true);
  });

  it("reports only the jobs actually scheduled", () => {
    const health = staleJobs(
      [
        { jobType: "clans", finishedAt: ago(1) },
        { jobType: "war", finishedAt: ago(400) },
      ],
      ["clans"],
      now,
    );

    expect(health.map((h) => h.jobType)).toEqual(["clans"]);
  });
});

describe("T5.8 — alertStaleJobs reads each job's last healthy run", () => {
  const now = new Date("2026-08-05T12:00:00Z");
  const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

  /**
   * sync_log as rows, behind just enough of the query builder for
   * lastHealthyRuns(): eq / in / not / order / limit, then awaited.
   */
  function fakeLog(rows: Array<{ job_type: string; status: string; finished_at: string }>) {
    const queries: string[] = [];
    const from = () => ({
      select: () => {
        let jobType = "";
        let statuses: string[] = [];
        const builder = {
          eq(_c: string, v: string) {
            jobType = v;
            return builder;
          },
          in(_c: string, v: string[]) {
            statuses = v;
            return builder;
          },
          not: () => builder,
          is: () => builder,
          order: () => builder,
          limit: () => builder,
          then<T>(resolve: (r: { data: unknown[]; error: null }) => T) {
            queries.push(jobType);
            const data = rows
              .filter((r) => r.job_type === jobType && statuses.includes(r.status))
              .sort((a, b) => b.finished_at.localeCompare(a.finished_at))
              .slice(0, 1)
              .map((r) => ({ finished_at: r.finished_at }));
            return Promise.resolve({ data, error: null }).then(resolve);
          },
        };
        return builder;
      },
    });
    return { client: { from } as never, queries };
  }

  // The war sync skips whenever no clan is at war. Counting only successes
  // called that "stopped" every time the clans were between wars.
  it("treats a recent skip as healthy", async () => {
    const { client } = fakeLog([
      { job_type: "war", status: "success", finished_at: ago(30) },
      { job_type: "war", status: "skipped", finished_at: ago(1) },
    ]);
    const health = await alertStaleJobs(client, ["war"], now);
    expect(health[0]!.stale).toBe(false);
  });

  it("still flags a job whose recent runs all failed", async () => {
    const { client } = fakeLog([
      { job_type: "war", status: "success", finished_at: ago(30) },
      { job_type: "war", status: "failed", finished_at: ago(1) },
    ]);
    // Nobody to alert in this fake (no admins), so the alert is a no-op and
    // the verdict comes back.
    const health = await alertStaleJobs(client, ["war"], now);
    expect(health[0]!.stale).toBe(true);
  });

  // A frequent job used to fill a shared 500-row window and push a rarer one
  // out of it, which then read as "never succeeded" and was never alerted on.
  it("asks about every watched job separately", async () => {
    const { client, queries } = fakeLog([]);
    await alertStaleJobs(client, ["clans", "raids", "players"], now);
    expect(queries.sort()).toEqual(["clans", "players", "raids"]);
  });
});

