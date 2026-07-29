// T1.13 — Unit tests for the Supercell timestamp parser.

import { describe, expect, it } from "vitest";
import {
  InvalidCocTimeError,
  formatCocTime,
  parseCocTime,
  parseCocTimeOrNull,
} from "./coc-time";

describe("parseCocTime", () => {
  it("parses the format from the spec", () => {
    const date = parseCocTime("20260729T063000.000Z");
    expect(date.toISOString()).toBe("2026-07-29T06:30:00.000Z");
  });

  it("parses without the fractional part", () => {
    expect(parseCocTime("20260729T063000Z").toISOString()).toBe(
      "2026-07-29T06:30:00.000Z",
    );
  });

  // The reason this module exists at all. If this assertion ever fails, the
  // native parser has changed and the module could be simplified.
  it("handles a string that new Date() cannot", () => {
    expect(Number.isNaN(new Date("20260729T063000.000Z").getTime())).toBe(true);
    expect(Number.isNaN(parseCocTime("20260729T063000.000Z").getTime())).toBe(false);
  });

  it("throws instead of returning Invalid Date", () => {
    expect(() => parseCocTime("not a timestamp")).toThrow(InvalidCocTimeError);
    expect(() => parseCocTime("")).toThrow(InvalidCocTimeError);
    // Extended ISO is NOT what the API sends; reject it so a mapper bug surfaces.
    expect(() => parseCocTime("2026-07-29T06:30:00.000Z")).toThrow(InvalidCocTimeError);
  });

  it("rejects impossible calendar dates instead of rolling them over", () => {
    // Date would quietly turn month 13 into January of the next year.
    expect(() => parseCocTime("20261329T063000.000Z")).toThrow(InvalidCocTimeError);
    expect(() => parseCocTime("20260732T063000.000Z")).toThrow(InvalidCocTimeError);
  });

  it("handles a leap day", () => {
    expect(parseCocTime("20240229T120000.000Z").toISOString()).toBe(
      "2024-02-29T12:00:00.000Z",
    );
    expect(() => parseCocTime("20260229T120000.000Z")).toThrow(InvalidCocTimeError);
  });

  it("carries the original input on the error", () => {
    try {
      parseCocTime("garbage");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCocTimeError);
      expect((error as InvalidCocTimeError).input).toBe("garbage");
    }
  });
});

// T9.9 — stored UTC, displayed local. Off-by-one-day errors here quietly make
// missed-attack lists wrong, so the boundary cases are asserted explicitly.
describe("Asia/Colombo display boundaries", () => {
  const colombo = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Colombo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  it("a war ending late UTC falls on the NEXT day in Sri Lanka", () => {
    // Sri Lanka is UTC+5:30, so 20:00 UTC is 01:30 the following morning.
    const date = parseCocTime("20260729T200000.000Z");
    expect(date.toISOString().slice(0, 10)).toBe("2026-07-29");
    expect(colombo(date)).toBe("2026-07-30");
  });

  it("a war ending just after midnight UTC is the SAME day in Sri Lanka", () => {
    const date = parseCocTime("20260729T003000.000Z");
    expect(colombo(date)).toBe("2026-07-29");
  });

  it("the 18:30 UTC boundary is exactly midnight in Sri Lanka", () => {
    expect(colombo(parseCocTime("20260729T182959.000Z"))).toBe("2026-07-29");
    expect(colombo(parseCocTime("20260729T183000.000Z"))).toBe("2026-07-30");
  });
});

describe("parseCocTimeOrNull", () => {
  it("returns null for absent values rather than throwing", () => {
    expect(parseCocTimeOrNull(null)).toBeNull();
    expect(parseCocTimeOrNull(undefined)).toBeNull();
    expect(parseCocTimeOrNull("")).toBeNull();
    expect(parseCocTimeOrNull("garbage")).toBeNull();
  });

  it("parses a valid value", () => {
    expect(parseCocTimeOrNull("20260729T063000.000Z")?.toISOString()).toBe(
      "2026-07-29T06:30:00.000Z",
    );
  });
});

describe("formatCocTime", () => {
  it("round-trips with parseCocTime", () => {
    const input = "20260729T063000.000Z";
    expect(formatCocTime(parseCocTime(input))).toBe(input);
  });

  it("throws on an Invalid Date", () => {
    expect(() => formatCocTime(new Date("nonsense"))).toThrow(InvalidCocTimeError);
  });
});
