// The open-redirect guard.
//
// It lived inside auth/callback/route.ts with no direct test for eight phases,
// which is a long time for the one function standing between a genuine
// ClanBridge magic link and a page on somebody else's domain. T10.4 gave it a
// second caller, so it moved to lib/ and got these.
//
// The attack it prevents: a link that really does come from ClanBridge, really
// does sign the member in, and then drops them somewhere that asks for their
// password again.

import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("safeNext", () => {
  it("keeps an ordinary in-app destination", () => {
    expect(safeNext("/roster")).toBe("/roster");
    expect(safeNext("/roster/2026-08")).toBe("/roster/2026-08");
    expect(safeNext("/%232PP0JCCL/cwl")).toBe("/%232PP0JCCL/cwl");
    expect(safeNext("/search?q=shashi")).toBe("/search?q=shashi");
  });

  // The one that matters. `//evil.com` passes a plain startsWith("/") and a
  // browser reads it as an absolute URL to another host.
  it("refuses a protocol-relative URL", () => {
    expect(safeNext("//evil.com")).toBe("/");
    expect(safeNext("//evil.com/login")).toBe("/");
  });

  // The same trick with the other slash: browsers normalise a backslash to a
  // forward slash in the authority position, so /\evil.com is //evil.com.
  it("refuses a backslash authority", () => {
    expect(safeNext("/\\evil.com")).toBe("/");
  });

  // The browser strips tabs and newlines BEFORE parsing, so each of these
  // arrives as //evil.com despite starting with a single slash.
  it("refuses control characters the browser would strip into //", () => {
    expect(safeNext("/\t/evil.com")).toBe("/");
    expect(safeNext("/\n/evil.com")).toBe("/");
    expect(safeNext("/\r/evil.com")).toBe("/");
    expect(safeNext(decodeURIComponent("/%09/evil.com"))).toBe("/");
  });

  it("refuses a backslash anywhere, not only straight after the first slash", () => {
    expect(safeNext("/\t\\evil.com")).toBe("/");
    expect(safeNext("/a\\b")).toBe("/");
  });

  it("refuses an absolute URL", () => {
    expect(safeNext("https://evil.com")).toBe("/");
    expect(safeNext("http://evil.com")).toBe("/");
    expect(safeNext("javascript:alert(1)")).toBe("/");
  });

  it("refuses anything that is not a rooted path", () => {
    expect(safeNext("roster")).toBe("/");
    expect(safeNext("../admin")).toBe("/");
    expect(safeNext("")).toBe("/");
  });

  it("treats absent as the front page", () => {
    expect(safeNext(null)).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });
});
