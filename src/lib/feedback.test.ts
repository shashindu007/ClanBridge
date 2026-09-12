// The wording the app uses after an action, and whether every action has some.
//
// The interesting test here is the last one, and it is not about this module at
// all: it reads the app's source, pulls out every `?ok=` code a Server Action
// redirects with, and asserts the map has a sentence for it.
//
// That is the failure this whole module exists to prevent. A code with no entry
// does not throw, does not fail typecheck, and does not look wrong to whoever
// added it — messageFor() falls through to showing the code itself, so the
// member gets a toast reading "roster-unpublshed" and the bug is invisible to
// everyone except the person it happens to. Typos are exactly the case.
//
// The pass-through is still deliberate and still tested below: roster's
// double-booking guard and admin's dispatchWorkflow both send real sentences
// through this path rather than codes.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ERROR_MESSAGES,
  isKnown,
  messageFor,
  OK_MESSAGES,
} from "@/lib/feedback";

describe("messageFor", () => {
  it("turns a code into a sentence", () => {
    expect(messageFor("ok", "roster-added")).toBe("Added to the roster.");
    expect(messageFor("error", "duplicate")).toBe("That clan has already been added.");
  });

  // The deliberate escape hatch. Two callers depend on it: the roster
  // double-booking guard, whose message names the clashing clan, and
  // dispatchWorkflow's detail. Both are sentences this project wrote.
  it("passes an unrecognised code through as itself", () => {
    const sentence = "Already in the DH v2 roster.";
    expect(messageFor("error", sentence)).toBe(sentence);
    expect(messageFor("ok", sentence)).toBe(sentence);
  });

  // The two maps are separate on purpose, so a word meaning one thing on
  // success cannot be read as the failure of the same name.
  it("keeps the two maps apart", () => {
    expect(isKnown("ok", "roster-added")).toBe(true);
    expect(isKnown("error", "roster-added")).toBe(false);
    expect(isKnown("error", "forbidden")).toBe(true);
    expect(isKnown("ok", "forbidden")).toBe(false);
  });
});

describe("the wording itself", () => {
  // These are read by members, not developers. A message that is a fragment or
  // a slug is the thing this module was written to stop.
  it.each([
    ["ok", OK_MESSAGES],
    ["error", ERROR_MESSAGES],
  ] as const)("%s messages read as sentences", (_kind, table) => {
    for (const [code, message] of Object.entries(table)) {
      expect(message[0], `${code} should start with a capital`).toBe(
        message[0]!.toUpperCase(),
      );
      expect(message, `${code} should end in punctuation`).toMatch(/[.!]$/);
      expect(message, `${code} should not be the code itself`).not.toBe(code);
      expect(message, `${code} should not contain a hyphenated slug`).not.toMatch(
        /\b[a-z]+-[a-z]+\b/,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The one that catches real drift.
// ---------------------------------------------------------------------------

/** Every .tsx under src/app, which is where the Server Actions live. */
function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) found.push(path);
  }
  return found;
}

describe("every action's code has wording", () => {
  const sources = sourceFiles(join(process.cwd(), "src", "app")).map((path) => ({
    path,
    text: readFileSync(path, "utf8"),
  }));

  /**
   * Codes redirected with literally — `?ok=roster-started`, `&ok=voted`.
   *
   * Deliberately ignores `${done}` and other interpolations; those are picked
   * up by the second pass below, which reads the variable's assignments.
   */
  const literal = new Set<string>();
  /** Codes assigned to the `done` variable the multi-action handlers use. */
  const viaVariable = new Set<string>();

  for (const { text } of sources) {
    for (const m of text.matchAll(/[?&]ok=([a-z][a-z-]*)/g)) literal.add(m[1]!);
    for (const m of text.matchAll(/\bdone = "([a-z][a-z-]*)"/g)) viaVariable.add(m[1]!);
  }

  it("finds the codes at all, so a passing suite means something", () => {
    // A refactor that changes how actions signal success would otherwise make
    // every assertion below vacuously true.
    expect(literal.size).toBeGreaterThan(4);
    expect(viaVariable.size).toBeGreaterThan(4);
  });

  it("has a sentence for every literal ?ok= code in src/app", () => {
    const missing = [...literal].filter((code) => !isKnown("ok", code));
    expect(missing, `add these to OK_MESSAGES in lib/feedback.ts`).toEqual([]);
  });

  it("has a sentence for every code assigned to `done`", () => {
    const missing = [...viaVariable].filter((code) => !isKnown("ok", code));
    expect(missing, `add these to OK_MESSAGES in lib/feedback.ts`).toEqual([]);
  });

  // The mirror: wording nothing sets is wording nobody has read, and it goes
  // stale silently. Not a failure — some entries are for actions not yet wired
  // — but worth listing so the drift stays visible.
  it("reports wording that no action currently sets", () => {
    const used = new Set([...literal, ...viaVariable]);
    const unused = Object.keys(OK_MESSAGES).filter((code) => !used.has(code)).sort();
    // Two remain on purpose. settings/account redirects a whole SENTENCE rather
    // than a code — the documented pass-through — so its two entries are
    // wording kept for reference and reached by no literal.
    expect(unused).toEqual(["password-saved", "username-saved"]);
  });
});
