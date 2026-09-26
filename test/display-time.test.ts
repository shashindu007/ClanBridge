// T9.9 — stored UTC, displayed in clan-local time.
//
// The bug this guards against does not throw and does not look wrong. Pages
// formatted timestamps inside SERVER components with plain toLocaleString(),
// which uses the SERVER's zone — UTC on Vercel — for every reader. The instant
// was right and the wall-clock wording was five and a half hours out, which is
// enough to move a war onto the wrong DAY.
//
// IMPLEMENTATION.md: "Off-by-one-day errors here are common and quietly make
// missed-attack lists wrong."

import { describe, expect, it } from "vitest";
import { DISPLAY_ZONE, formatDisplay, formatIn, parseDisplayLocal } from "@/lib/display-time";

describe("formatIn — the day boundary that made this task exist", () => {
  // Sri Lanka is UTC+05:30. Anything after 18:30 UTC is already tomorrow there.
  it("puts a late-evening UTC instant on the NEXT day in Colombo", () => {
    const iso = "2026-07-29T20:00:00.000Z";

    expect(formatIn(iso, "date", "UTC")).toBe("29 Jul 2026");
    expect(formatIn(iso, "date", DISPLAY_ZONE)).toBe("30 Jul 2026");
  });

  it("keeps an early-morning UTC instant on the same day", () => {
    const iso = "2026-07-29T04:00:00.000Z";

    expect(formatIn(iso, "date", "UTC")).toBe("29 Jul 2026");
    expect(formatIn(iso, "date", DISPLAY_ZONE)).toBe("29 Jul 2026");
  });

  // The half-hour offset is the part a naive fix gets wrong: Sri Lanka is +5:30,
  // not +5 or +6.
  it("applies the full five and a half hour offset", () => {
    expect(formatIn("2026-07-29T04:00:00.000Z", "time", DISPLAY_ZONE)).toBe("09:30");
  });

  it("crosses the year boundary correctly", () => {
    const iso = "2025-12-31T20:00:00.000Z";
    expect(formatIn(iso, "date", DISPLAY_ZONE)).toBe("1 Jan 2026");
  });
});

describe("formatDisplay — the server-side default", () => {
  it("uses the clan zone without being asked", () => {
    const iso = "2026-07-29T20:00:00.000Z";
    expect(formatDisplay(iso, "date")).toBe(formatIn(iso, "date", DISPLAY_ZONE));
  });

  it("defaults to a full date and time", () => {
    expect(formatDisplay("2026-07-29T04:00:00.000Z")).toBe("29 Jul 2026, 09:30");
  });

  // "—" rather than "Invalid Date", which is what a bare
  // `new Date("nonsense").toLocaleString()` renders straight into the page.
  it("renders an em dash for null, undefined and unparseable input", () => {
    for (const value of [null, undefined, "", "not a date"]) {
      expect(formatDisplay(value), String(value)).toBe("—");
    }
  });

  it("offers the styles the pages actually use", () => {
    const iso = "2026-07-29T04:00:00.000Z";
    expect(formatDisplay(iso, "date")).toBe("29 Jul 2026");
    expect(formatDisplay(iso, "time")).toBe("09:30");
    expect(formatDisplay(iso, "weekday")).toMatch(/^Wed 29 Jul, 09:30$/);
  });
});

describe("parseDisplayLocal — a typed time, read in clan-local time", () => {
  // The poll-close bug: 20:00 typed in Colombo was stored as 20:00 UTC.
  it("reads a datetime-local value as Colombo time, not UTC", () => {
    expect(parseDisplayLocal("2026-09-26T20:00")?.toISOString()).toBe(
      "2026-09-26T14:30:00.000Z",
    );
  });

  it("round-trips through formatDisplay to what was typed", () => {
    const at = parseDisplayLocal("2026-09-26T20:00")!;
    expect(formatDisplay(at.toISOString(), "time")).toBe("20:00");
  });

  it.each(["", "   ", "tomorrow", "2026-09-26", "2026-13-45T99:99"])(
    "returns null rather than an Invalid Date for %j",
    (value) => {
      expect(parseDisplayLocal(value)).toBeNull();
    },
  );
});
