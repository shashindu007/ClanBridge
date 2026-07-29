// T1.12 — Unit tests for tag handling.

import { describe, expect, it } from "vitest";
import {
  InvalidTagError,
  decodeTag,
  encodeTag,
  isValidTag,
  normaliseTag,
} from "./tags";

describe("normaliseTag", () => {
  it("leaves an already-canonical tag alone", () => {
    expect(normaliseTag("#2PP0JCCL")).toBe("#2PP0JCCL");
  });

  it("uppercases", () => {
    expect(normaliseTag("#2pp0jccl")).toBe("#2PP0JCCL");
  });

  it("adds a missing hash", () => {
    expect(normaliseTag("2PP0JCCL")).toBe("#2PP0JCCL");
  });

  it("strips surrounding and internal whitespace", () => {
    expect(normaliseTag("  #2PP0JCCL  ")).toBe("#2PP0JCCL");
    expect(normaliseTag("#2PP0 JCCL")).toBe("#2PP0JCCL");
  });

  it("accepts an already percent-encoded tag", () => {
    expect(normaliseTag("%232PP0JCCL")).toBe("#2PP0JCCL");
  });

  // The single most common typo. The letter O does not exist in the tag
  // alphabet, so this correction is unambiguous.
  it("corrects the letter O to zero", () => {
    expect(normaliseTag("#2PPOJCCL")).toBe("#2PP0JCCL");
    expect(normaliseTag("#2ppojccl")).toBe("#2PP0JCCL");
  });

  it("rejects empty input", () => {
    expect(() => normaliseTag("")).toThrow(InvalidTagError);
    expect(() => normaliseTag("   ")).toThrow(InvalidTagError);
  });

  it("rejects characters outside the tag alphabet", () => {
    // I, S and the digit 1 are not in Supercell's alphabet.
    expect(() => normaliseTag("#2PP0JCCI")).toThrow(InvalidTagError);
    expect(() => normaliseTag("#2PP0JCCS")).toThrow(InvalidTagError);
    expect(() => normaliseTag("#2PP0JCC1")).toThrow(InvalidTagError);
  });

  it("rejects two tags concatenated", () => {
    expect(() => normaliseTag("#2PP0JCCL#2PP0JCCL")).toThrow(InvalidTagError);
  });

  it("accepts the shortest and longest plausible tags", () => {
    expect(normaliseTag("#2PP")).toBe("#2PP");
    expect(normaliseTag("#220022002200")).toBe("#220022002200"); // 12 characters
  });

  it("rejects lengths outside 3-12", () => {
    expect(() => normaliseTag("#2")).toThrow(InvalidTagError);
    expect(() => normaliseTag("#22222222222222")).toThrow(InvalidTagError);
  });

  it("carries the original input on the error, for a useful message", () => {
    try {
      normaliseTag("#nope!");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidTagError);
      expect((error as InvalidTagError).input).toBe("#nope!");
    }
  });
});

describe("encodeTag", () => {
  it("replaces the hash with %23", () => {
    expect(encodeTag("#2PP0JCCL")).toBe("%232PP0JCCL");
  });

  it("normalises before encoding", () => {
    expect(encodeTag("2pp0jccl")).toBe("%232PP0JCCL");
  });

  // The whole reason this module exists: an unencoded '#' truncates the URL and
  // the API answers 404 on a tag that is perfectly valid.
  it("never emits a bare hash", () => {
    expect(encodeTag("#2PP0JCCL")).not.toContain("#");
  });
});

describe("decodeTag", () => {
  it("round-trips with encodeTag", () => {
    const tag = "#2PP0JCCL";
    expect(decodeTag(encodeTag(tag))).toBe(tag);
  });

  it("reads a Next.js route segment", () => {
    expect(decodeTag("%232PP0JCCL")).toBe("#2PP0JCCL");
  });

  it("throws on a malformed segment rather than passing it to a query", () => {
    expect(() => decodeTag("%23not-a-tag")).toThrow(InvalidTagError);
  });
});

describe("isValidTag", () => {
  it("reports validity without throwing", () => {
    expect(isValidTag("#2PP0JCCL")).toBe(true);
    expect(isValidTag("2pp0jccl")).toBe(true);
    expect(isValidTag("")).toBe(false);
    expect(isValidTag("#nope!")).toBe(false);
  });
});
