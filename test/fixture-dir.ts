// A private copy of fixtures/, for tests that need to change one.
//
// Tests used to rewrite the committed fixture and put it back afterwards. The
// suite runs files in parallel processes, so another file could read the edited
// copy mid-test, and a crash between the two writes left the edit in the
// repository. The copy lives in a temp directory instead, and the API client
// reads it through COC_FIXTURES_DIR (src/integration/coc-client.ts).

import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FixtureDir {
  /** Replace one fixture in the copy, e.g. write("clan.json", {...}). */
  write(name: string, body: unknown): void;
  /** Delete the copy and point the client back at fixtures/. */
  cleanup(): void;
}

export function useFixtureCopy(): FixtureDir {
  const dir = mkdtempSync(join(tmpdir(), "coc-fixtures-"));
  cpSync(join(process.cwd(), "fixtures"), dir, { recursive: true });
  process.env.COC_FIXTURES_DIR = dir;

  return {
    write(name, body) {
      const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
      writeFileSync(join(dir, name), text, "utf8");
    },
    cleanup() {
      delete process.env.COC_FIXTURES_DIR;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
