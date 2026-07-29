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
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    // T9.9 — timestamps are stored UTC and converted for display only. Pinning the
    // suite to UTC keeps results identical on a Sri Lanka laptop and a CI runner;
    // the Asia/Colombo conversions are asserted explicitly inside the tests.
    env: { TZ: "UTC" },
  },
});
