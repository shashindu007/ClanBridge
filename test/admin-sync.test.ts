// T9.2 — the sync history behind /admin, and T9.7's dispatch guard.
//
// R9 says every sync job writes to sync_log. This is the half that makes the
// record visible: a log nobody reads catches nothing, which is the whole reason
// T4.8 and T5.8 exist. The cases worth testing are the two that fail silently.
//
//   ORDER. `recentRuns()` must return the NEWEST runs. Ascending plus a limit
//   returns the OLDEST — still rows, still a table on the page, and completely
//   wrong. Nothing errors.
//
//   SKIPPED IS NOT FAILED (R10). For three weeks of every month "no CWL group"
//   is the correct outcome. A history that files those under failures makes the
//   failed panel permanently red, and a panel that is always red is one nobody
//   reads on the day it means something.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import { failedRuns, recentRuns } from "@/repositories/sync-log";
import { DISPATCHABLE, isDispatchable } from "@/lib/github";

describe("isDispatchable — narrowing an untrusted form field", () => {
  it("accepts exactly the jobs a leader may start", () => {
    for (const job of Object.keys(DISPATCHABLE)) {
      expect(isDispatchable(job), job).toBe(true);
    }
  });

  // The form field is a string from the client. `backup` and `health` are real
  // workflows that are deliberately NOT in the map, and neither is anything
  // else somebody might type.
  it("rejects anything else, including real workflows left off the list", () => {
    for (const value of ["backup", "health", "ci", "", "../../etc", "clans.yml"]) {
      expect(isDispatchable(value), value).toBe(false);
    }
  });

  // Object.hasOwn, not `value in DISPATCHABLE`, so inherited names do not slip
  // through and become a fetch to a workflow file called "constructor".
  it("is not fooled by inherited Object properties", () => {
    for (const value of ["toString", "constructor", "hasOwnProperty", "__proto__"]) {
      expect(isDispatchable(value), value).toBe(false);
    }
  });
});

describe("sync history (T9.2)", () => {
  let h: Harness;
  let client: SupabaseClient;

  const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000a1";
  const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000b1";

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
    await h.asSuperuser();
  });

  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.db.exec(`delete from sync_log; delete from clans;`);
    await h.db.exec(`
      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#20PP0JCC', 'Clan B');

      insert into sync_log (job_type, clan_id, status, started_at, finished_at,
                            skip_reason, error, records_written) values
        ('clans', '${CLAN_A}', 'success', '2026-08-01T00:00:00Z', '2026-08-01T00:01:00Z',
         null, null, 30),
        ('cwl',   null,        'skipped', '2026-08-02T00:00:00Z', '2026-08-02T00:00:10Z',
         'noCwlGroup', null, 0),
        ('war',   '${CLAN_B}', 'failed',  '2026-08-03T00:00:00Z', '2026-08-03T00:00:05Z',
         null, 'war log is private', null),
        ('raids', null,        'running', '2026-08-04T00:00:00Z', null,
         null, null, null);
    `);
  });

  // The bug this exists to catch returns rows either way.
  it("returns the newest run first", async () => {
    const runs = await recentRuns(client);
    expect(runs.map((r) => r.jobType)).toEqual(["raids", "war", "cwl", "clans"]);
  });

  it("honours the limit, keeping the newest rather than the oldest", async () => {
    const runs = await recentRuns(client, 2);
    expect(runs.map((r) => r.jobType)).toEqual(["raids", "war"]);
  });

  it("carries the fields the history table renders", async () => {
    const [, war] = await recentRuns(client);
    expect(war).toMatchObject({
      jobType: "war",
      status: "failed",
      clanId: CLAN_B,
      error: "war log is private",
    });
    expect(war!.id).toBeTruthy();
  });

  it("keeps a family-wide run's null clan rather than inventing one", async () => {
    const cwl = (await recentRuns(client)).find((r) => r.jobType === "cwl");
    // sync:cwl covers every clan in one pass and writes clan_id = null. The page
    // renders that as "all clans"; a placeholder id here would attribute the run
    // to one clan and quietly make the history wrong.
    expect(cwl?.clanId).toBeNull();
  });

  describe("failedRuns", () => {
    it("finds the failure", async () => {
      const failed = failedRuns(await recentRuns(client));
      expect(failed).toHaveLength(1);
      expect(failed[0]!.jobType).toBe("war");
    });

    // R10, as an assertion. This is the one that keeps the panel meaningful.
    it("does not treat a skip as a failure", async () => {
      const failed = failedRuns(await recentRuns(client));
      expect(failed.map((r) => r.jobType)).not.toContain("cwl");
    });

    // A job still running has not failed. It becomes a problem by being OLD,
    // which is staleJobs() in alerts.ts — a check that runs from outside and
    // does not wait to be looked at.
    it("does not treat a still-running job as a failure", async () => {
      const failed = failedRuns(await recentRuns(client));
      expect(failed.map((r) => r.jobType)).not.toContain("raids");
    });

    it("returns nothing when every run went fine", async () => {
      await h.db.exec(`delete from sync_log where status = 'failed';`);
      expect(failedRuns(await recentRuns(client))).toEqual([]);
    });
  });

  it("reports an empty history rather than throwing on a fresh install", async () => {
    await h.db.exec(`delete from sync_log;`);
    expect(await recentRuns(client)).toEqual([]);
  });
});
