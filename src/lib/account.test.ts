// T10 — what a valid username and password are.
//
// These rules exist in two places by necessity: here, and as a check constraint
// in migration 030. This file is the half that produces a sentence; the
// constraint is the half that is actually enforced. They have to agree, and the
// pattern test below is what notices when they stop.

import { describe, expect, it } from "vitest";
import {
  normaliseUsername,
  passwordProblem,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  usernameProblem,
  USERNAME_PATTERN,
} from "@/lib/account";

describe("normaliseUsername", () => {
  // The unique index in 030 is on lower(username), so folding has to happen
  // before the write or a collision arrives as a database error rather than a
  // sentence — and "Shashi" and "shashi" become two accounts with one handle.
  it("folds case and trims, because the index does", () => {
    expect(normaliseUsername("Shashi")).toBe("shashi");
    expect(normaliseUsername("  SHASHI  ")).toBe("shashi");
  });
});

describe("usernameProblem", () => {
  it("accepts the ordinary shapes", () => {
    for (const name of ["abc", "shashi", "shashi_007", "a_1", "x".repeat(20)]) {
      expect(usernameProblem(name), name).toBeNull();
    }
  });

  it("refuses too short and too long", () => {
    expect(usernameProblem("ab")).toMatch(/at least 3/);
    expect(usernameProblem("x".repeat(21))).toMatch(/at most 20/);
  });

  it("refuses characters the check constraint would reject", () => {
    for (const name of ["Shashi", "sha shi", "sha-shi", "sha.shi", "shashi!", "shashí"]) {
      expect(usernameProblem(name), name).not.toBeNull();
    }
  });

  // Uppercase is the interesting one: it is rejected here rather than silently
  // folded, because the caller is expected to have run normaliseUsername first.
  // A helper that quietly repaired its input would make the two paths disagree
  // about what was saved.
  it("expects its input already folded", () => {
    expect(usernameProblem("Shashi")).not.toBeNull();
    expect(usernameProblem(normaliseUsername("Shashi"))).toBeNull();
  });

  // If this fails, 030's check constraint and this file have drifted apart and
  // the member gets a raw Postgres error instead of a sentence.
  it("uses the same pattern the migration writes", () => {
    expect(USERNAME_PATTERN.source).toBe("^[a-z0-9_]{3,20}$");
  });
});

describe("passwordProblem", () => {
  const good = "correct-horse-battery";

  it("accepts a password at the minimum and above", () => {
    expect(passwordProblem("x".repeat(PASSWORD_MIN_LENGTH), "x".repeat(PASSWORD_MIN_LENGTH)))
      .toBeNull();
    expect(passwordProblem(good, good)).toBeNull();
  });

  it("refuses one character short", () => {
    const short = "x".repeat(PASSWORD_MIN_LENGTH - 1);
    expect(passwordProblem(short, short)).toMatch(/at least/);
  });

  it("refuses a mismatched confirmation", () => {
    expect(passwordProblem(good, `${good}!`)).toMatch(/do not match/);
  });

  // Length is checked before the match, so somebody who typed a short password
  // twice is told the real problem rather than being sent hunting for a typo.
  it("reports the length problem before the mismatch", () => {
    expect(passwordProblem("short", "different")).toMatch(/at least/);
  });

  // bcrypt truncates at 72 BYTES. Counting characters would accept a password
  // that is silently cut in half, which is worse than refusing it: the member
  // believes they have a 40-character password and has rather less.
  it("counts bytes, not characters, at the bcrypt ceiling", () => {
    const ok = "x".repeat(PASSWORD_MAX_LENGTH);
    expect(passwordProblem(ok, ok)).toBeNull();

    const tooLong = "x".repeat(PASSWORD_MAX_LENGTH + 1);
    expect(passwordProblem(tooLong, tooLong)).toMatch(/at most/);

    // 20 emoji is 20 characters and 80 bytes.
    const emoji = "🙂".repeat(20);
    expect(emoji.length).toBeLessThan(PASSWORD_MAX_LENGTH);
    expect(passwordProblem(emoji, emoji)).toMatch(/at most/);
  });
});
