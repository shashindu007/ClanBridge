// T11.7 — the decidable half of the avatar pipeline.
//
// compressAvatar() itself is absent from this file on purpose: vitest runs in
// `environment: "node"` with no jsdom and no canvas, so createImageBitmap and
// canvas.toBlob cannot be exercised. Everything that CAN be decided without a
// browser is a pure function, and this is where the line is drawn — the same
// division test/layout-image.test.ts draws for the layout pipeline.
//
// The last test is the one that would otherwise rot: it asserts the magic-byte
// allow-list is the SHARED one rather than a second copy. Two copies is one copy
// that gets a new format added and one that does not.

import { describe, expect, it } from "vitest";
import { AVATAR_EDGE, avatarPath, squareCrop } from "@/lib/avatar-image";
import * as avatar from "@/lib/avatar-image";
import * as layout from "@/lib/layout-image";

describe("squareCrop", () => {
  it("takes the middle of a landscape picture", () => {
    // 400 wide, 200 tall -> a 200 square starting 100 in from the left.
    expect(squareCrop(400, 200)).toEqual({ x: 100, y: 0, size: 200 });
  });

  it("takes the middle of a portrait picture", () => {
    // The case a top-anchored crop gets right and the one below gets wrong; centre
    // is the only rule that is never badly wrong on both.
    expect(squareCrop(200, 400)).toEqual({ x: 0, y: 100, size: 200 });
  });

  it("leaves an already-square picture alone", () => {
    expect(squareCrop(256, 256)).toEqual({ x: 0, y: 0, size: 256 });
  });

  it("handles a 1x1 picture without producing a zero-size crop", () => {
    // A zero size would make canvas.drawImage throw, and the browser half is the
    // part no test can reach — so the arithmetic has to be right here.
    expect(squareCrop(1, 1)).toEqual({ x: 0, y: 0, size: 1 });
  });

  it("never produces a crop larger than the source", () => {
    for (const [w, h] of [
      [1, 9999],
      [9999, 1],
      [3, 4],
      [1001, 1000],
    ] as const) {
      const crop = squareCrop(w, h);
      expect(crop.size).toBeLessThanOrEqual(Math.min(w, h));
      expect(crop.x + crop.size).toBeLessThanOrEqual(w);
      expect(crop.y + crop.size).toBeLessThanOrEqual(h);
    }
  });

  it("rounds an odd remainder rather than leaving a fraction", () => {
    // 401 x 200 leaves 201 to split. A fractional x would be a subpixel read.
    const crop = squareCrop(401, 200);
    expect(Number.isInteger(crop.x)).toBe(true);
    expect(crop.x).toBe(101);
  });
});

describe("avatarPath", () => {
  const USER = "11111111-2222-4333-8444-555555555555";
  const IMAGE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  it("puts the user id first, which 035's policy depends on", () => {
    // (storage.foldername(name))[1] must equal auth.uid()::text. If this ever
    // changes shape, every upload starts failing RLS.
    expect(avatarPath(USER, IMAGE)).toBe(`${USER}/${IMAGE}.jpg`);
    expect(avatarPath(USER, IMAGE).split("/")[0]).toBe(USER);
  });

  it("always ends .jpg, because 035 allows image/jpeg alone", () => {
    expect(avatarPath(USER, IMAGE).endsWith(".jpg")).toBe(true);
  });

  // 034's check constraint is:
  //   avatar_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
  // A path this function builds has to satisfy it, or the column refuses the very
  // value the upload just stored in the bucket — and the failure would surface as
  // a constraint error after a successful upload, which is the confusing order.
  it("satisfies the check constraint on users.avatar_path", () => {
    expect(avatarPath(USER, IMAGE)).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
  });
});

describe("the shared primitives are shared", () => {
  it("reuses layout-image's magic-byte allow-list rather than copying it", () => {
    // Not a style point. sniffImageType is the security-relevant function in both
    // pipelines — it is what stops a renamed .exe being stored — and a second copy
    // is a second thing to remember when a format is added.
    expect(avatar).not.toHaveProperty("sniffImageType");

    // And it still behaves, so the import is load-bearing rather than decorative.
    expect(layout.sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(layout.sniffImageType(new Uint8Array([0x4d, 0x5a, 0x90]))).toBeNull(); // a Windows .exe
  });

  it("reuses fitWithin, and it does not enlarge a small picture", () => {
    // The no-enlarge rule is what keeps a 64px avatar at 64px instead of making a
    // bigger file out of the same information.
    expect(layout.fitWithin(64, 64, AVATAR_EDGE)).toEqual({ width: 64, height: 64 });
    expect(layout.fitWithin(1024, 1024, AVATAR_EDGE)).toEqual({
      width: AVATAR_EDGE,
      height: AVATAR_EDGE,
    });
  });

  it("keeps its own tuning, distinct from the layout pipeline's", () => {
    // The point of the split: shared primitives, separate numbers. If these ever
    // become equal, one of the two pipelines has lost its reason to exist.
    expect(AVATAR_EDGE).toBeLessThan(layout.MAX_EDGE);
    expect(avatar.AVATAR_TARGET_BYTES).toBeLessThan(layout.TARGET_BYTES);
  });

  // T12.7 — the numbers the small storage plan depends on.
  it("stores about 5 KB at 128px, and never more than 15 KB", () => {
    expect(AVATAR_EDGE).toBe(128);
    // Never smaller than the largest place the picture is drawn (/account, 96px).
    expect(avatar.AVATAR_FALLBACK_EDGE).toBeGreaterThanOrEqual(96);
    expect(avatar.AVATAR_FALLBACK_EDGE).toBeLessThan(AVATAR_EDGE);
    expect(avatar.AVATAR_TARGET_BYTES).toBeLessThanOrEqual(6 * 1024);
    expect(avatar.AVATAR_TARGET_BYTES).toBeLessThan(avatar.AVATAR_MAX_BYTES);
    // 043's bucket file_size_limit is 15360 — the two must agree, or the
    // browser accepts a picture Storage then refuses with an unexplained error.
    expect(avatar.AVATAR_MAX_BYTES).toBe(15360);
  });

  it("tries qualities from best to worst", () => {
    const steps = avatar.AVATAR_QUALITY_STEPS;
    expect([...steps].sort((a, b) => b - a)).toEqual(steps);
    expect(steps.every((q) => q > 0 && q <= 1)).toBe(true);
  });
});
