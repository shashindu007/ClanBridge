// T2.5 — sync_log plumbing, tested against a real Postgres.
//
// R9 is the rule under test: every job writes to sync_log at start and finish.
// The case that matters is the one nobody writes by hand — a job that throws
// must STILL close its row, because a row left in `running` forever is
// indistinguishable from a job that is still working, and that is how a CWL
// season gets lost without anyone noticing.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import {
  activeClans,
  assertNotFixtureSync,
  main,
  runSyncJob,
  skip,
  SyncSkipped,
} from "../scripts/sync/shared";

// runSyncJob reports to the console on purpose — that output is what you read in
// an Actions log. Several tests here fail jobs deliberately, so the reporting is
// silenced to keep the test output readable.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * The slice of supabase-js that shared.ts actually uses, backed by PGlite.
 *
 * shared.ts takes a client by injection precisely so this is possible without a
 * Supabase project. It is a stand-in for the query builder, not a reimplementation
 * of it — every method here exists because shared.ts calls it.
 */
function pgliteClient(h: Harness): SupabaseClient {
  const from = (table: string) => ({
    insert(values: Record<string, unknown>) {
      const keys = Object.keys(values);
      const cols = keys.join(", ");
      const params = keys.map((_, i) => `$${i + 1}`).join(", ");
      const vals = keys.map((k) => values[k]);
      return {
        select() {
          return {
            async single() {
              try {
                const res = await h.db.query<Record<string, unknown>>(
                  `insert into ${table} (${cols}) values (${params}) returning *`,
                  vals,
                );
                return { data: res.rows[0], error: null };
              } catch (error) {
                return { data: null, error: { message: String(error) } };
              }
            },
          };
        },
      };
    },

    update(values: Record<string, unknown>) {
      const keys = Object.keys(values);
      const sets = keys.map((k, i) => `${k} = $${i + 1}`).join(", ");
      const vals = keys.map((k) => values[k]);
      return {
        async eq(column: string, value: unknown) {
          try {
            await h.db.query(
              `update ${table} set ${sets} where ${column} = $${keys.length + 1}`,
              [...vals, value],
            );
            return { error: null };
          } catch (error) {
            return { error: { message: String(error) } };
          }
        },
      };
    },

    select(columns: string) {
      const filters: string[] = [];
      const builder = {
        is(column: string, _value: null) {
          filters.push(`${column} is null`);
          return builder;
        },
        eq(column: string, value: unknown) {
          filters.push(`${column} = ${typeof value === "string" ? `'${value}'` : value}`);
          return builder;
        },
        async order(column: string) {
          const where = filters.length ? `where ${filters.join(" and ")}` : "";
          try {
            const res = await h.db.query<Record<string, unknown>>(
              `select ${columns} from ${table} ${where} order by ${column}`,
            );
            return { data: res.rows, error: null };
          } catch (error) {
            return { data: null, error: { message: String(error) } };
          }
        },
      };
      return builder;
    },
  });

  return { from } as unknown as SupabaseClient;
}

async function syncLogRows(h: Harness) {
  await h.asSuperuser();
  const res = await h.db.query<{
    job_type: string;
    status: string;
    error: string | null;
    skip_reason: string | null;
    finished_at: string | null;
    records_written: number | null;
  }>(`select job_type, status, error, skip_reason, finished_at, records_written
      from sync_log order by started_at`);
  return res.rows;
}

describe("T2.5 — runSyncJob and sync_log (R9)", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = pgliteClient(h);
  });
  afterAll(async () => {
    await h?.close();
  });
  beforeEach(async () => {
    await h.asSuperuser();
    await h.db.exec(`truncate sync_log`);
  });

  it("writes one row and marks it success", async () => {
    const result = await runSyncJob("clans", async () => {}, { client });

    expect(result).toBe("success");
    const rows = await syncLogRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ job_type: "clans", status: "success" });
    expect(rows[0]!.finished_at).not.toBeNull();
  });

  it("records how many rows the job actually wrote", async () => {
    await runSyncJob(
      "clans",
      async (ctx) => {
        ctx.recorded(12);
        ctx.recorded(3);
      },
      { client },
    );

    const rows = await syncLogRows(h);
    expect(rows[0]!.records_written).toBe(15);
  });

  // The whole point of R9. Without the finally, this row stays `running` forever.
  it("still closes the row when the job throws", async () => {
    const result = await runSyncJob(
      "cwl",
      async () => {
        throw new Error("Supercell returned nonsense");
      },
      { client },
    );

    expect(result).toBe("failed");
    const rows = await syncLogRows(h);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.finished_at).not.toBeNull();
    expect(rows[0]!.error).toMatch(/nonsense/);
  });

  it("never leaves a row in running", async () => {
    await runSyncJob("clans", async () => {}, { client });
    await runSyncJob("cwl", async () => skip("notInWar"), { client });
    await runSyncJob("war", async () => {
      throw new Error("boom");
    }, { client });

    const rows = await syncLogRows(h);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.status)).not.toContain("running");
  });

  // R10 — notInWar and a missing CWL group are ordinary for most of the month.
  // Recording them as failures is how you learn to ignore your own alerts.
  describe("R10 — a skip is not a failure", () => {
    it("records skipped with a reason, not failed", async () => {
      const result = await runSyncJob("cwl", async () => skip("noCwlGroup", "404"), {
        client,
      });

      expect(result).toBe("skipped");
      const rows = await syncLogRows(h);
      expect(rows[0]!.status).toBe("skipped");
      expect(rows[0]!.skip_reason).toBe("noCwlGroup");
      expect(rows[0]!.error).toBeNull();
    });

    it("counts work done before the skip", async () => {
      await runSyncJob(
        "war",
        async (ctx) => {
          ctx.recorded(4);
          skip("notInWar");
        },
        { client },
      );
      const rows = await syncLogRows(h);
      expect(rows[0]!.records_written).toBe(4);
    });

    it("skip() throws SyncSkipped and carries the reason", () => {
      expect(() => skip("notInWar")).toThrow(SyncSkipped);
      try {
        skip("noCwlGroup", "the group 404s outside CWL week");
      } catch (error) {
        expect((error as SyncSkipped).reason).toBe("noCwlGroup");
      }
    });
  });

  it("truncates a very long error rather than failing the update", async () => {
    await runSyncJob(
      "clans",
      async () => {
        throw new Error("x".repeat(5000));
      },
      { client },
    );
    const rows = await syncLogRows(h);
    expect(rows[0]!.error!.length).toBeLessThanOrEqual(2000);
  });

  it("accepts every job_type the check constraint allows", async () => {
    for (const job of ["clans", "cwl", "war", "raids", "clan-games", "players", "backup"] as const) {
      const result = await runSyncJob(job, async () => {}, { client });
      expect(result, job).toBe("success");
    }
  });

  // GitHub Actions decides a run's status from the exit code, and T5.8's alert
  // hangs off that. A skip must NOT fail the run — R10 again: three weeks of
  // every month the CWL job legitimately has nothing to do.
  describe("main() sets the process exit code", () => {
    const original = process.exitCode;
    afterEach(() => {
      process.exitCode = original;
    });

    it("exits 0 on success", async () => {
      await main("clans", async () => {}, { client });
      expect(process.exitCode).toBe(0);
    });

    it("exits 0 on skip, so a normal no-op does not look like a failure", async () => {
      await main("cwl", async () => skip("noCwlGroup"), { client });
      expect(process.exitCode).toBe(0);
    });

    it("exits 1 on failure, so the workflow goes red", async () => {
      await main("war", async () => {
        throw new Error("boom");
      }, { client });
      expect(process.exitCode).toBe(1);
    });
  });
});

// A sync job reading fixtures/ and writing to a real database produces invented
// members that R4 forbids ever removing. `.env.local` ships with
// USE_FIXTURES=true, so this is the default state of a fresh checkout — the one
// mistake in this project that is both easy to make and impossible to undo.
describe("the fixture-sync guard — invented members must not reach a real database", () => {
  const original = {
    use: process.env.USE_FIXTURES,
    allow: process.env.ALLOW_FIXTURE_SYNC,
  };

  afterEach(() => {
    // delete rather than assign undefined: process.env coerces to the string
    // "undefined", which would read as a set variable to every check here.
    if (original.use === undefined) delete process.env.USE_FIXTURES;
    else process.env.USE_FIXTURES = original.use;
    if (original.allow === undefined) delete process.env.ALLOW_FIXTURE_SYNC;
    else process.env.ALLOW_FIXTURE_SYNC = original.allow;
  });

  it("refuses when USE_FIXTURES is on", () => {
    process.env.USE_FIXTURES = "true";
    delete process.env.ALLOW_FIXTURE_SYNC;
    expect(() => assertNotFixtureSync("clans")).toThrow(/USE_FIXTURES=true/);
  });

  it("names the job and the way out, because the message is the whole feature", () => {
    process.env.USE_FIXTURES = "true";
    delete process.env.ALLOW_FIXTURE_SYNC;
    // An operator who cannot tell WHICH job stopped or WHAT to change reaches for
    // the nearest override, which here is the one thing they must not do.
    expect(() => assertNotFixtureSync("cwl")).toThrow(/cwl sync/);
    expect(() => assertNotFixtureSync("cwl")).toThrow(/USE_FIXTURES=false/);
  });

  it("allows a real sync when USE_FIXTURES is off", () => {
    process.env.USE_FIXTURES = "false";
    expect(() => assertNotFixtureSync("clans")).not.toThrow();
  });

  it("allows a real sync when USE_FIXTURES is unset", () => {
    delete process.env.USE_FIXTURES;
    expect(() => assertNotFixtureSync("clans")).not.toThrow();
  });

  it("lets ALLOW_FIXTURE_SYNC through, for deliberately seeding a scratch database", () => {
    process.env.USE_FIXTURES = "true";
    process.env.ALLOW_FIXTURE_SYNC = "true";
    expect(() => assertNotFixtureSync("clans")).not.toThrow();
  });

  // The discriminator is the injected client, not an environment variable. Get
  // this backwards and either the offline suite stops testing the fixture path or
  // the guard stops guarding — and both look like everything is fine.
  it("stops a real run before it builds a client or opens a sync_log row", async () => {
    process.env.USE_FIXTURES = "true";
    delete process.env.ALLOW_FIXTURE_SYNC;

    let jobRan = false;
    await expect(
      runSyncJob("clans", async () => {
        jobRan = true;
      }),
    ).rejects.toThrow(/USE_FIXTURES=true/);

    // No client was injected, so reaching Supabase at all would have needed
    // credentials this test does not have. Nothing ran, and nothing was logged.
    expect(jobRan).toBe(false);
  });

  it("does not touch the offline suite, which injects its own client", async () => {
    const h = await createHarness();
    try {
      process.env.USE_FIXTURES = "true";
      delete process.env.ALLOW_FIXTURE_SYNC;
      await h.asSuperuser();

      const result = await runSyncJob("clans", async () => {}, { client: pgliteClient(h) });
      expect(result).toBe("success");
    } finally {
      await h.close();
    }
  });
});

describe("activeClans — clans come from the database, never hardcoded (R3)", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = pgliteClient(h);
    await h.asSuperuser();
  });
  afterAll(async () => {
    await h?.close();
  });

  it("skips cleanly when the seed has not been run", async () => {
    await expect(activeClans(client)).rejects.toThrow(SyncSkipped);
  });

  it("returns seeded clans in tag order", async () => {
    await h.db.exec(`
      insert into clans (tag, name) values
        ('#8QUCLJY0', 'B'),
        ('#2PP0JCCL', 'A');
    `);

    const clans = await activeClans(client);
    expect(clans.map((c) => c.name)).toEqual(["A", "B"]);
  });

  it("excludes soft-deleted and inactive clans", async () => {
    await h.db.exec(`
      insert into clans (tag, name, deleted_at) values ('#9V2GRJPY', 'Gone', now());
      insert into clans (tag, name, is_active) values ('#PYLQGRJC', 'Paused', false);
    `);

    const clans = await activeClans(client);
    expect(clans.map((c) => c.name)).toEqual(["A", "B"]);
  });
});
