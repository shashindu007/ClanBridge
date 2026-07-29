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
    // Booting Postgres in WASM and applying six migrations takes longer than the
    // 5s default, especially on the first run while the wasm is compiled.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // T9.9 — timestamps are stored UTC and converted for display only. Pinning the
    // suite to UTC keeps results identical on a Sri Lanka laptop and a CI runner;
    // the Asia/Colombo conversions are asserted explicitly inside the tests.
    env: { TZ: "UTC" },
  },
});
