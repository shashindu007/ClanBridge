// The colour a clan wears. Colocated with lib/tags.test.ts's convention.
//
// The property that matters is DETERMINISM. Everything else here is cosmetic
// and a wrong answer is merely ugly; a colour that changes between renders is a
// clan the leader has to re-learn every time they open the page, which is worse
// than three grey links.

import { describe, expect, it } from "vitest";
import { CLAN_ACCENT_COUNT, clanAccent } from "@/lib/clan-accent";

// Real-shaped ids: the clans table is uuid.
const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";
const CLAN_C = "cccccccc-0000-4000-8000-0000000000cc";

describe("clanAccent", () => {
  it("gives the same clan the same colour every time", () => {
    expect(clanAccent(CLAN_A)).toEqual(clanAccent(CLAN_A));
    expect(clanAccent(CLAN_A).slot).toBe(clanAccent(CLAN_A).slot);
  });

  it("stays inside the slots globals.css actually defines", () => {
    for (const id of [CLAN_A, CLAN_B, CLAN_C, "", "x", "#2PP0JCCL"]) {
      const { slot } = clanAccent(id);
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThanOrEqual(CLAN_ACCENT_COUNT);
    }
  });

  it("points at a token rather than a literal colour", () => {
    // The hue lives in globals.css where it can be re-measured. A hex here
    // would be a second copy of a validated value, free to drift from it.
    expect(clanAccent(CLAN_A).color).toMatch(/^var\(--clan-[123]\)$/);
  });

  // Not a guarantee the function can make for arbitrary ids — three slots and
  // an unbounded id space collide by the pigeonhole principle. It is a check
  // that the hash spreads at all: an implementation returning a constant, or
  // keying off something every uuid shares, passes every test above and fails
  // this one.
  it("spreads ids across all three slots", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      seen.add(clanAccent(`clan-${i}`).slot);
    }
    expect(seen.size).toBe(CLAN_ACCENT_COUNT);
  });

  it("does not throw on an empty id", () => {
    expect(() => clanAccent("")).not.toThrow();
  });
});
