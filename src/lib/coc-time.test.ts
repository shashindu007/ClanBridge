// T1.13 — Unit tests for the Supercell timestamp parser.

import { describe, expect, it } from "vitest";
import {
  InvalidCocTimeError,
  clanGamesPhase,
  clanGamesWindow,
  formatCocTime,
  gamesSeason,
  isDuringClanGames,
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

// ---------------------------------------------------------------------------
// T7.4 — the Clan Games window.
//
// The API publishes nothing about Clan Games: no score, no dates, no endpoint.
// The window is derived from the calendar, and getting it wrong is expensive in
// exactly one direction — see the long note in coc-time.ts. These tests pin the
// boundaries, because a start snapshot taken late loses that month's scores
// permanently and no error is raised when it happens.
// ---------------------------------------------------------------------------

const at = (iso: string) => new Date(iso);

describe("clanGamesWindow", () => {
  it("runs 22nd 08:00 UTC to 28th 08:00 UTC", () => {
    const w = clanGamesWindow(at("2026-08-15T00:00:00Z"));
    expect(w.start.toISOString()).toBe("2026-08-22T08:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-08-28T08:00:00.000Z");
    expect(w.season).toBe("2026-08");
  });

  // The 22nd and 28th exist in every month, so no month is a special case —
  // which is the reason those dates are safe to derive from at all.
  it.each(["2026-02", "2026-12", "2028-02"])("has a window in %s", (month) => {
    const w = clanGamesWindow(at(`${month}-15T00:00:00Z`));
    expect(w.start.toISOString()).toBe(`${month}-22T08:00:00.000Z`);
    expect(w.end.toISOString()).toBe(`${month}-28T08:00:00.000Z`);
  });

  // The season is the month the points belong to, and it is the natural key of
  // clan_games. Deriving it in UTC keeps it stable regardless of where the
  // runner happens to be.
  it("names the season in UTC, not local time", () => {
    expect(gamesSeason(at("2026-08-31T23:30:00Z"))).toBe("2026-08");
    expect(gamesSeason(at("2026-09-01T00:30:00Z"))).toBe("2026-09");
  });
});

describe("isDuringClanGames", () => {
  it.each([
    ["2026-08-22T08:00:00Z", true], // the instant it opens
    ["2026-08-25T12:00:00Z", true],
    ["2026-08-28T07:59:00Z", true], // the last minute
    ["2026-08-22T07:59:00Z", false], // a minute before
    ["2026-08-28T08:00:00Z", false], // the instant it closes
    ["2026-08-01T12:00:00Z", false],
  ])("at %s is %s", (iso, expected) => {
    expect(isDuringClanGames(at(iso))).toBe(expected);
  });

  // Three weeks in four this is false. R10 — that is the normal state, not an
  // edge case, and the page and the sync both have to treat it as ordinary.
  it("is false for most of the month", () => {
    const days = Array.from({ length: 28 }, (_, i) =>
      at(`2026-08-${String(i + 1).padStart(2, "0")}T12:00:00Z`),
    );
    expect(days.filter(isDuringClanGames)).toHaveLength(6);
  });
});

describe("clanGamesPhase", () => {
  it("says start on the opening day", () => {
    expect(clanGamesPhase(at("2026-08-22T08:00:00Z"))).toBe("start");
    expect(clanGamesPhase(at("2026-08-22T23:00:00Z"))).toBe("start");
  });

  // A day wide, not an instant. The job runs once daily and GitHub delays
  // scheduled runs by up to twenty minutes; an exact-time check would miss the
  // boundary on any busy day, and missing THIS boundary costs the month.
  it("keeps the start window open for a full day", () => {
    expect(clanGamesPhase(at("2026-08-23T07:59:00Z"))).toBe("start");
    expect(clanGamesPhase(at("2026-08-23T08:01:00Z"))).toBeNull();
  });

  // Not before the period opens. A run on the 21st would read a value that
  // belongs to last month's state and is indistinguishable from this month's.
  it("does not take a start snapshot before the period opens", () => {
    expect(clanGamesPhase(at("2026-08-21T12:00:00Z"))).toBeNull();
    expect(clanGamesPhase(at("2026-08-22T07:59:00Z"))).toBeNull();
  });

  it("says nothing at all mid-period", () => {
    expect(clanGamesPhase(at("2026-08-25T12:00:00Z"))).toBeNull();
  });

  // Deliberately wide. The achievement value stops moving when the games close,
  // so a late end snapshot reads the same number a punctual one would — unlike
  // the start, where lateness is unrecoverable.
  it("says end from the moment it closes until the month runs out", () => {
    expect(clanGamesPhase(at("2026-08-28T08:00:00Z"))).toBe("end");
    expect(clanGamesPhase(at("2026-08-29T12:00:00Z"))).toBe("end");
    expect(clanGamesPhase(at("2026-08-31T23:00:00Z"))).toBe("end");
  });

  // Rolling into a new month resets to nothing-to-do, under the new season.
  it("starts the next month clean", () => {
    expect(clanGamesPhase(at("2026-09-01T12:00:00Z"))).toBeNull();
    expect(clanGamesWindow(at("2026-09-01T12:00:00Z")).season).toBe("2026-09");
  });

  // Every day of a month must resolve to exactly one of the three states, and
  // the two snapshot windows must not overlap — an overlap would let one run
  // take both snapshots and record a score of zero for everybody.
  it("never reports both phases on the same day", () => {
    for (let day = 1; day <= 31; day++) {
      const iso = `2026-08-${String(day).padStart(2, "0")}T12:00:00Z`;
      const phase = clanGamesPhase(at(iso));
      expect(["start", "end", null]).toContain(phase);
    }
    // The opening day is 'start' and never 'end'.
    expect(clanGamesPhase(at("2026-08-22T12:00:00Z"))).toBe("start");
  });
});
