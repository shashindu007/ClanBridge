// groupFailures(): the Admin page's failures as problems, not as runs.

import { describe, expect, it } from "vitest";
import type { SyncRunRecord } from "@/repositories/sync-log";
import { failureFix, groupFailures } from "@/services/sync-failures";

let n = 0;
function run(over: Partial<SyncRunRecord>): SyncRunRecord {
  n += 1;
  return {
    id: `r${n}`,
    jobType: "war",
    clanId: null,
    status: "failed",
    startedAt: "2026-09-23T10:00:00Z",
    finishedAt: null,
    skipReason: null,
    error: "#2CU2V0GV9: war log is private (T0.1), war unreadable",
    recordsWritten: null,
    ...over,
  };
}

describe("groupFailures", () => {
  // The reported screen: the same hourly failure, fifteen lines.
  it("collapses the same failure into one problem with a count and the latest time", () => {
    const runs = Array.from({ length: 15 }, (_, i) =>
      run({ startedAt: `2026-09-23T${String(20 - i).padStart(2, "0")}:00:00Z` }),
    );
    const problems = groupFailures(runs);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ jobType: "war", count: 15, lastAt: "2026-09-23T20:00:00Z" });
    expect(problems[0]!.fix).toMatch(/War log to Public/);
  });

  it("keeps different jobs, clans and messages apart, newest first", () => {
    const problems = groupFailures([
      run({ startedAt: "2026-09-23T09:00:00Z" }),
      run({ jobType: "cwl", startedAt: "2026-09-23T11:00:00Z", error: "#X: war log is private (T0.1), CWL unreadable" }),
      run({ jobType: "clans", clanId: "c1", startedAt: "2026-09-23T10:00:00Z", error: "players upsert failed" }),
      run({ jobType: "clans", clanId: "c2", startedAt: "2026-09-23T08:00:00Z", error: "players upsert failed" }),
    ]);
    expect(problems.map((p) => [p.jobType, p.clanId])).toEqual([
      ["cwl", null],
      ["clans", "c1"],
      ["war", null],
      ["clans", "c2"],
    ]);
  });

  it("ignores runs that did not fail", () => {
    expect(
      groupFailures([run({ status: "succeeded" }), run({ status: "skipped" }), run({ status: "running" })]),
    ).toEqual([]);
  });

  it("treats whitespace differences as the same message", () => {
    const problems = groupFailures([run({ error: "boom  \n here" }), run({ error: "boom here" })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]!.error).toBe("boom here");
  });
});

describe("failureFix", () => {
  it("knows nothing about an error it has not been taught", () => {
    expect(failureFix("players upsert failed for #ABC: duplicate key")).toBeNull();
  });
});
