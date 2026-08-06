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

    // ── Why forks, and why the cap ────────────────────────────────────────
    // Fifteen of these files call createHarness(), and each one boots a
    // SEPARATE Postgres compiled to WASM and applies every migration to it.
    // Vitest defaults to one worker per core; on a 12-core machine that is
    // twelve concurrent Postgres instances competing for memory.
    //
    // FORKS, NOT THREADS. Worker threads share one process address space, and
    // WebAssembly.Memory only ever grows — a WASM heap is not returned when the
    // PGlite that owns it is closed. Across fifteen files the shared space
    // therefore climbs until the process dies with "Fatal process out of
    // memory: Zone", which arrives as an unhandled ERR_IPC_CHANNEL_CLOSED and
    // reads like a broken test rather than exhaustion. A fork is a real OS
    // process, so its address space goes away with it.
    //
    // Two, not four: with forks the memory ceiling is per-process, so the cap
    // bounds how many Postgres instances exist at once. CI runners have 2-4
    // cores, which this also matches — the suite should not behave differently
    // there than it does locally.
    //
    // The cost is startup, paid once per fork rather than per file, and the
    // suite is dominated by migration application either way.
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    // T9.9 — timestamps are stored UTC and converted for display only. Pinning the
    // suite to UTC keeps results identical on a Sri Lanka laptop and a CI runner;
    // the Asia/Colombo conversions are asserted explicitly inside the tests.
    env: { TZ: "UTC" },
  },
});
