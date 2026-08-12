// T8.2/T8.3 — the parts of the upload path that are decisions rather than DOM.
//
// compressImage() itself needs a canvas and is exercised by using the app; what
// is tested here is everything it depends on being right, because each of these
// fails silently rather than loudly:
//
//   sniffImageType   a filename is a string the client chose. Trusting it is
//                    how `evil.exe` renamed to `base.png` gets stored.
//   fitWithin        enlarging a small image makes a BIGGER file out of the
//                    same information, which is the opposite of the point.
//   isCopyLink       a "copy link" a member taps expects to open the game.

import { describe, expect, it } from "vitest";
import {
  MAX_EDGE,
  fitWithin,
  isCopyLink,
  layoutImagePath,
  sniffImageType,
} from "@/lib/layout-image";

/** Bytes for a header, padded so length checks are not what passes the test. */
function header(...bytes: number[]): Uint8Array {
  const out = new Uint8Array(32);
  out.set(bytes);
  return out;
}

const JPEG = header(0xff, 0xd8, 0xff, 0xe0);
const PNG = header(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const WEBP = header(
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x24, 0x00, 0x00, 0x00, // size
  0x57, 0x45, 0x42, 0x50, // WEBP
);

describe("sniffImageType — content, never the filename (T8.3)", () => {
  it("recognises the three formats the bucket accepts", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
    expect(sniffImageType(WEBP)).toBe("image/webp");
  });

  // The whole reason this function exists rather than an extension check.
  it("rejects a Windows executable however it is named", () => {
    expect(sniffImageType(header(0x4d, 0x5a, 0x90, 0x00))).toBeNull();
  });

  it("rejects a PDF, a ZIP and a GIF", () => {
    expect(sniffImageType(header(0x25, 0x50, 0x44, 0x46))).toBeNull(); // %PDF
    expect(sniffImageType(header(0x50, 0x4b, 0x03, 0x04))).toBeNull(); // PK
    expect(sniffImageType(header(0x47, 0x49, 0x46, 0x38))).toBeNull(); // GIF8
  });

  // RIFF is a container, not a format. Checking only the first four bytes would
  // let a .wav through as an image.
  it("does not mistake another RIFF container for WebP", () => {
    const wav = header(
      0x52, 0x49, 0x46, 0x46,
      0x24, 0x00, 0x00, 0x00,
      0x57, 0x41, 0x56, 0x45, // WAVE, not WEBP
    );
    expect(sniffImageType(wav)).toBeNull();
  });

  it("rejects a truncated header rather than reading past the end", () => {
    expect(sniffImageType(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImageType(new Uint8Array([]))).toBeNull();
  });

  // A real PNG's first three bytes are 89 50 4E; a JPEG's are FF D8 FF. Neither
  // prefix should satisfy the other's check.
  it("does not confuse the two most common formats", () => {
    expect(sniffImageType(header(0x89, 0x50, 0x4e))).toBeNull();
  });
});

describe("fitWithin — resize down, never up", () => {
  it("scales a large landscape screenshot to the long edge", () => {
    expect(fitWithin(2400, 1080)).toEqual({ width: MAX_EDGE, height: 576 });
  });

  it("scales a portrait screenshot by its height", () => {
    expect(fitWithin(1080, 2400)).toEqual({ width: 576, height: MAX_EDGE });
  });

  // Enlarging produces a bigger file carrying no more information — the exact
  // opposite of what this task is for.
  it("leaves an already-small image alone", () => {
    expect(fitWithin(600, 400)).toEqual({ width: 600, height: 400 });
  });

  it("leaves an image exactly at the limit alone", () => {
    expect(fitWithin(MAX_EDGE, 720)).toEqual({ width: MAX_EDGE, height: 720 });
  });

  it("never rounds an edge down to zero", () => {
    const { width, height } = fitWithin(4000, 1, 100);
    expect(width).toBe(100);
    expect(height).toBeGreaterThanOrEqual(1);
  });

  it("honours a caller-supplied limit", () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ width: 100, height: 50 });
  });
});

describe("isCopyLink — it should open the game", () => {
  it("accepts Supercell's share host", () => {
    expect(isCopyLink("https://link.clashofclans.com/en?action=OpenLayout&id=TH15")).toBe(true);
  });

  it("tolerates surrounding whitespace, which paste leaves behind", () => {
    expect(isCopyLink("  https://link.clashofclans.com/x  ")).toBe(true);
  });

  // Checked as a parsed hostname rather than a substring. This is the case a
  // substring match gets wrong, and a member tapping it has every reason to
  // expect the game rather than somebody's site.
  it("rejects a lookalike that only mentions the host", () => {
    expect(isCopyLink("https://evil.example/?x=link.clashofclans.com")).toBe(false);
    expect(isCopyLink("https://link.clashofclans.com.evil.example/x")).toBe(false);
  });

  it("rejects a subdomain of the real host", () => {
    expect(isCopyLink("https://a.link.clashofclans.com/x")).toBe(false);
  });

  it("rejects http, javascript: and data:", () => {
    expect(isCopyLink("http://link.clashofclans.com/x")).toBe(false);
    expect(isCopyLink("javascript:alert(1)")).toBe(false);
    expect(isCopyLink("data:text/html,<script>")).toBe(false);
  });

  it("rejects anything that is not a URL", () => {
    expect(isCopyLink("")).toBe(false);
    expect(isCopyLink("just some text")).toBe(false);
  });
});

describe("layoutImagePath — the clan id has to lead", () => {
  // 029's storage policies read storage.foldername(name)[1] as the clan and
  // check it against auth_clan_ids(). Change this shape and those policies stop
  // matching anything, silently.
  it("puts the clan first so the storage policy can filter on it", () => {
    const path = layoutImagePath("clan-1", "layout-9");
    expect(path).toBe("clan-1/layout-9.jpg");
    expect(path.split("/")[0]).toBe("clan-1");
  });
});
