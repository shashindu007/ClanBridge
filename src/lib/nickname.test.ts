import { describe, expect, it } from "vitest";
import {
  NICKNAME_MAX_LENGTH,
  baseLabel,
  nicknameProblem,
  normaliseNickname,
} from "@/lib/nickname";

describe("normaliseNickname", () => {
  it("trims", () => {
    expect(normaliseNickname("  main  ")).toBe("main");
  });

  // NOT lowercased, unlike normaliseUsername. There is no unique index to agree
  // with, and a label is read rather than resolved.
  it("preserves case", () => {
    expect(normaliseNickname("Main Account")).toBe("Main Account");
  });

  it("turns a whitespace-only submission into the empty string", () => {
    // Which the caller reads as "clear it" — see nicknameProblem's contract.
    expect(normaliseNickname("   ")).toBe("");
  });
});

describe("nicknameProblem", () => {
  it("accepts an ordinary label", () => {
    expect(nicknameProblem("main")).toBeNull();
    expect(nicknameProblem("the rushed one")).toBeNull();
  });

  it("accepts exactly the maximum length", () => {
    expect(nicknameProblem("x".repeat(NICKNAME_MAX_LENGTH))).toBeNull();
  });

  it("rejects one character over", () => {
    expect(nicknameProblem("x".repeat(NICKNAME_MAX_LENGTH + 1))).toMatch(/at most 24/);
  });

  it("explains that empty means clear, rather than saying 'too short'", () => {
    // The wording matters: the member may have blanked the box on purpose, and a
    // "too short" error would tell them they did something wrong when they did not.
    expect(nicknameProblem("")).toMatch(/leave the box empty to clear it/);
  });

  it("rejects a label spanning more than one line", () => {
    for (const bad of ["two\nlines", "carriage\rreturn", "a\ttab"]) {
      expect(nicknameProblem(bad), JSON.stringify(bad)).toMatch(/single line/);
    }
  });

  // The pairing this file exists for. 033's constraint is
  //   nickname = btrim(nickname)
  //   and char_length(nickname) between 1 and 24
  //   and nickname !~ '[\n\r\t]'
  // and every clause has to be reachable from here, or a member meets the
  // database's wording instead of ours. The trim clause is covered by
  // normaliseNickname running first, which is why the pipeline is tested as one.
  it("agrees with 033's constraint on everything the constraint refuses", () => {
    const throughTheForm = (raw: string) => nicknameProblem(normaliseNickname(raw));

    expect(throughTheForm("  padded  ")).toBeNull(); // trimmed, so the constraint is satisfied
    expect(throughTheForm("")).not.toBeNull(); // char_length >= 1
    expect(throughTheForm("   ")).not.toBeNull(); // same, after the trim
    expect(throughTheForm("x".repeat(25))).not.toBeNull(); // char_length <= 24
    expect(throughTheForm("a\nb")).not.toBeNull(); // !~ '[\n\r\t]'
  });
});

describe("baseLabel", () => {
  it("prefers the member's own label", () => {
    expect(baseLabel("main", "Shashi")).toBe("main");
  });

  it("falls back to the in-game name when there is no label", () => {
    expect(baseLabel(null, "Shashi")).toBe("Shashi");
  });

  it("falls back when the label is blank rather than absent", () => {
    // Defensive: 033 cannot store one, but a row written before the constraint
    // existed, or a stale client, must not render an empty heading.
    expect(baseLabel("", "Shashi")).toBe("Shashi");
    expect(baseLabel("   ", "Shashi")).toBe("Shashi");
  });
});
