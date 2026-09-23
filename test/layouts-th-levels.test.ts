// The Town Hall levels the base library offers.
//
// TH_LEVELS is written out by hand rather than derived from HOME_HALLS, because
// the upload form is a client component and deriving it would ship the whole
// game-data file to the browser. This test is what keeps the two together: the
// library stopped at TH17 for a season after TH18 was released, and nothing
// failed. Now the next Town Hall does.

import { describe, expect, it } from "vitest";
import { HOME_HALLS } from "@/data/game";
import { TH_LEVELS } from "@/repositories/layouts";

describe("TH_LEVELS", () => {
  it("starts at the highest Town Hall in the game data", () => {
    expect(TH_LEVELS[0]).toBe(HOME_HALLS);
  });

  it("runs down one level at a time to TH9", () => {
    const expected = Array.from({ length: HOME_HALLS - 8 }, (_, i) => HOME_HALLS - i);
    expect([...TH_LEVELS]).toEqual(expected);
  });
});
