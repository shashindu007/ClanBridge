import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// T1.12, T1.13 — unit tests for the tag and timestamp parsers.
//
// Node environment, not jsdom: everything tested here is pure logic. Nothing in
// Phase 1 touches the DOM, and jsdom would only slow the suite down.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "test/**/*.test.ts"],
    // Booting Postgres in WASM and applying every migration takes longer than
    // the 5s default, especially on the first run while the wasm is compiled.
    // The cost grows with the migration count, so this has headroom.
    testTimeout: 120_000,
    hookTimeout: 120_000,

    // ── Why the worker cap ────────────────────────────────────────────────
    // Ten of these files call createHarness(), and each one boots a SEPARATE
    // Postgres compiled to WASM and applies every migration to it. Vitest
    // defaults to one worker per core; on a 12-core machine that is eleven
    // concurrent Postgres instances competing for memory, and the symptom is
    // not a slow suite but "Hook timed out in 60000ms" on a rotating subset of
    // files — a failure that looks like flaky logic and is not.
    //
    // Four is enough to keep the pure-logic files parallel while bounding the
    // heavy ones. CI runners have 2-4 cores, so this also stops the suite
    // behaving differently there than it does locally.
    poolOptions: { threads: { maxThreads: 4, minThreads: 1 } },
    // T9.9 — timestamps are stored UTC and converted for display only. Pinning the
    // suite to UTC keeps results identical on a Sri Lanka laptop and a CI runner;
    // the Asia/Colombo conversions are asserted explicitly inside the tests.
    env: { TZ: "UTC" },
  },
});
