// T8.2/T8.3 — getting a screenshot small enough to keep, and safe enough to store.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE COMPRESSION IS IN THE BROWSER AND NOT ON THE SERVER
//
// Section 3 rejects `sharp`, and this is the task that would otherwise pull it
// in. A phone screenshot is 2-4 MB; the free Storage tier is 1 GB. Two hundred
// layouts at 3 MB is 600 MB — most of the tier gone on a feature nobody would
// call important. At 250 KB the same two hundred cost 50 MB.
//
// Doing it server-side also means uploading the full 3 MB first, over a mobile
// connection, to then throw most of it away. The canvas is already on the device
// that took the picture.
//
// EXIF IS STRIPPED AS A CONSEQUENCE, NOT AS A STEP. Drawing an image onto a
// canvas and re-encoding produces a new file containing pixels and nothing else
// — no camera model, no timestamp, and no GPS coordinates. That last one is the
// reason it matters: a screenshot usually carries none, but a photograph OF a
// screen taken on a phone carries where it was taken, and members will do that.
// There is no separate "strip EXIF" call anywhere because re-encoding is what
// strips it, and a stripper that could be forgotten would eventually be.
// ─────────────────────────────────────────────────────────────────────────────

/** Longest edge after resizing. A base layout is legible well below this. */
export const MAX_EDGE = 1280;

/** What T8.2 aims for. The bucket refuses at 600 KB (029) as a backstop. */
export const TARGET_BYTES = 300 * 1024;

/** Quality steps tried in order until one comes in under target. */
const QUALITY_STEPS = [0.82, 0.7, 0.6, 0.5, 0.4];

/**
 * What the file is, read from its CONTENT rather than its name.
 *
 * T8.3 says "validate real file type, not the filename", and the reason is that
 * a filename is a string the client chose. `evil.exe` renamed to `base.png`
 * passes every extension check ever written. These are the magic bytes each
 * format actually starts with.
 *
 * Returns null for anything unrecognised, which the caller treats as a refusal
 * — an allow-list, never a deny-list, because a deny-list is a promise to have
 * thought of everything.
 */
export function sniffImageType(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) {
    return "image/png";
  }

  // WebP: "RIFF" .... "WEBP" — the size field sits between the two, so both
  // halves have to be checked or any RIFF container (a .wav, say) matches.
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

/**
 * Dimensions to draw at, preserving aspect ratio.
 *
 * Never enlarges. An image already under the limit is re-encoded at its own
 * size, because scaling a 600px screenshot up to 1280 makes a bigger file out
 * of the same information.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
  /** The quality step that got under target, or the last one tried. */
  quality: number;
}

export class ImageRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageRejected";
  }
}

/**
 * Resize and re-encode a picked file, in the browser.
 *
 * Always emits JPEG. A PNG screenshot of a base is a photograph as far as the
 * encoder is concerned — large flat areas are rare — and PNG's lossless
 * encoding of it runs several times the size for no visible gain.
 *
 * Steps down through QUALITY_STEPS until the result fits, rather than computing
 * a quality from the input size: the relationship between the two depends
 * entirely on the picture's content, so measuring is the only honest way.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    throw new ImageRejected(
      "That file is not a JPEG, PNG or WebP image. Take a screenshot in game and pick that.",
    );
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new ImageRejected("This browser could not process the image.");

  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let last: Blob | null = null;
  for (const quality of QUALITY_STEPS) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) continue;
    last = blob;
    if (blob.size <= TARGET_BYTES) return { blob, width, height, quality };
  }

  if (!last) throw new ImageRejected("This browser could not process the image.");

  // Every step tried and still over. Returned rather than thrown: the bucket's
  // own 600 KB limit (029) is the real boundary, and refusing here would reject
  // a legitimate 320 KB image for missing a target that was only ever a goal.
  return { blob: last, width, height, quality: QUALITY_STEPS[QUALITY_STEPS.length - 1]! };
}

/**
 * Where the image lives in the bucket.
 *
 * The clan id LEADS the path, and 029's policies depend on that:
 * `storage.foldername(name)[1]` is the clan, checked against auth_clan_ids().
 * A flat `<layout_id>.jpg` would leave nothing to filter on and push the check
 * into the application, where forgetting it fails open.
 */
export function layoutImagePath(clanId: string, layoutId: string): string {
  return `${clanId}/${layoutId}.jpg`;
}

/**
 * Whether a copy link looks like one.
 *
 * Supercell's share links are `https://link.clashofclans.com/...`. Checked as a
 * parsed URL host rather than a substring, so `https://evil.example/?x=link.clashofclans.com`
 * does not pass — a member clicking a "copy link" in a clan library has every
 * reason to expect it opens the game.
 */
export function isCopyLink(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") return false;
    return url.hostname === "link.clashofclans.com";
  } catch {
    return false;
  }
}
