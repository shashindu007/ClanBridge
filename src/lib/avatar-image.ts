// T11.7 — getting a profile picture small enough and square enough to keep.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS A SEPARATE MODULE AND NOT PARAMETERS ON layout-image.ts
//
// The primitives ARE shared — sniffImageType, fitWithin and ImageRejected are
// imported below, not copied. Two copies of a magic-byte allow-list is one copy
// that gets a new format added and one that does not, and that copy is the
// security-relevant half.
//
// What is NOT shared is the tuning. MAX_EDGE and TARGET_BYTES are exported
// constants that layouts/upload/upload-form.tsx reads and test/layout-image.test.ts
// asserts against, and 029's 600 KB bucket limit is derived from TARGET_BYTES.
// Threading them through an options bag moves the numbers to the call site, where
// the next caller invents a third pair and no file owns the answer any more. The
// numbers are the design, so each pipeline states its own.
//
// The numbers differ because the pictures differ. A base layout has to stay
// legible enough to copy a building placement off, so 1280px and 300 KB. An
// avatar is rendered at 32px in the rail and maybe 96px on /account, so 256px and
// 40 KB — and it is SQUARE, which layouts never are.
//
// EXIF IS STRIPPED AS A CONSEQUENCE, NOT AS A STEP, exactly as layout-image.ts
// says. It matters more here, not less: these are photographs of people, taken on
// phones, and a phone photograph carries where it was taken. Re-encoding is what
// removes it, and there is no separate call that could be forgotten.
// ─────────────────────────────────────────────────────────────────────────────

import { ImageRejected, fitWithin, sniffImageType, type CompressedImage } from "@/lib/layout-image";

/**
 * The stored edge length, in pixels. Square, so this is both dimensions.
 *
 * T12.7 — 128, down from 256. The largest place a picture is drawn is /account
 * at 96px, and the rail draws it at 20px. 128 is sharp at 96 on an ordinary
 * screen and acceptable on a 2x one; 256 bought retina crispness at the one
 * size that matters least, for roughly four times the bytes. The storage plan
 * is small, and every account carries a picture.
 */
export const AVATAR_EDGE = 128;

/**
 * The fallback edge when no quality step at AVATAR_EDGE comes in under target.
 * A very busy photo — confetti, foliage, a crowd — can defeat JPEG at 128px;
 * 96px is exactly the largest display size, so it loses nothing anyone sees.
 */
export const AVATAR_FALLBACK_EDGE = 96;

/** What this pipeline aims for: about 5 KB for a typical face. */
export const AVATAR_TARGET_BYTES = 6 * 1024;

/**
 * The hard ceiling. Above this the picture is REFUSED, not stored.
 *
 * The bucket enforces the same number (043's file_size_limit), because uploads
 * go straight from the browser to Storage and this file is the only thing a
 * modified browser could skip.
 */
export const AVATAR_MAX_BYTES = 15 * 1024;

/**
 * Quality steps tried in order, at each edge.
 *
 * Reaching lower than it used to (0.5) because the picture is smaller: JPEG
 * artefacts are 8px blocks, and at 128px shown at 96 they are sub-pixel long
 * before they are visible. A face at 0.4 and 128px looks better than a face at
 * 0.85 and 256px scaled down in the browser, which is what the old pipeline
 * was paying four times the storage for.
 */
export const AVATAR_QUALITY_STEPS = [0.8, 0.7, 0.6, 0.5, 0.4, 0.3];

/**
 * The square to take out of a rectangular picture, in source pixels.
 *
 * CENTRED, and the alternative is worth naming: a top-anchored crop is what most
 * naive implementations do because it usually catches a face in a portrait
 * photograph. It also cuts the head off every landscape one. Centre is the only
 * choice that is never badly wrong, and there is no face detection in this
 * project and should not be.
 *
 * Returns the offset and size to read FROM the source. The destination is always
 * AVATAR_EDGE square.
 */
export function squareCrop(
  width: number,
  height: number,
): { x: number; y: number; size: number } {
  const size = Math.min(width, height);
  return {
    x: Math.round((width - size) / 2),
    y: Math.round((height - size) / 2),
    size,
  };
}

/**
 * Where the picture lives in the bucket.
 *
 * The USER ID LEADS the path, and 035's policies depend on it:
 * `storage.foldername(name)[1]` is the account, checked against auth.uid(). The
 * same mechanism layoutImagePath() uses with a clan id, and the same argument — a
 * flat `<uuid>.jpg` leaves nothing to filter on and pushes the check into the
 * application, where forgetting it fails open.
 *
 * The second segment is a FRESH uuid per upload, never a fixed name. 035's header
 * explains why: no object is ever overwritten, so the bucket needs no UPDATE
 * policy and an already-signed URL can never serve the wrong bytes.
 *
 * Always .jpg, because compressAvatar always emits JPEG and 035 allows only that.
 * The check constraint on users.avatar_path (034) asserts the same shape.
 */
export function avatarPath(userId: string, imageId: string): string {
  return `${userId}/${imageId}.jpg`;
}

/**
 * Resize, centre-crop and re-encode a picked file, in the browser.
 *
 * Always emits JPEG, for the reason layout-image.ts gives and one more: 035's
 * bucket allows image/jpeg alone, so any other output would be refused at upload
 * with an error about a mime type rather than one about a picture.
 *
 * The crop happens in the drawImage call rather than as a second canvas pass —
 * the nine-argument form reads a rectangle out of the source and scales it into
 * the destination in one step, so there is no intermediate bitmap and no second
 * lossy encode.
 *
 * NOT UNIT TESTED, and it cannot be: vitest runs in `environment: "node"` with no
 * jsdom and no canvas. Everything decidable without a browser — the allow-list,
 * the crop arithmetic, the path shape — is a pure function above or in
 * layout-image.ts, and those are tested. This is the repo's stated rule for
 * upload-form.tsx and it applies here unchanged.
 */
export async function compressAvatar(file: File): Promise<CompressedImage> {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    throw new ImageRejected(
      "That file is not a JPEG, PNG or WebP image. Pick a photo or a screenshot.",
    );
  }

  const bitmap = await createImageBitmap(file);
  const crop = squareCrop(bitmap.width, bitmap.height);

  try {
    // T12.7 — two edges, and the smaller one only if the larger cannot reach
    // target. The first result under target wins; failing that, the smallest
    // result under the hard ceiling; failing THAT, a refusal. Never an
    // oversized file: the old pipeline returned whatever q=0.5 produced, which
    // is how "a 40 KB target" became no ceiling at all.
    let bestUnderMax: CompressedImage | null = null;

    for (const target of [AVATAR_EDGE, AVATAR_FALLBACK_EDGE]) {
      // fitWithin never enlarges, so a picture already smaller than the target
      // is kept at its own size rather than blown up.
      const { width: edge } = fitWithin(crop.size, crop.size, target);
      const canvas = drawSquare(bitmap, crop, edge);

      for (const quality of AVATAR_QUALITY_STEPS) {
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, "image/jpeg", quality),
        );
        if (!blob) continue;
        const result = { blob, width: edge, height: edge, quality };
        if (blob.size <= AVATAR_TARGET_BYTES) return result;
        if (blob.size <= AVATAR_MAX_BYTES && (!bestUnderMax || blob.size < bestUnderMax.blob.size)) {
          bestUnderMax = result;
        }
      }
    }

    if (bestUnderMax) return bestUnderMax;

    throw new ImageRejected(
      "That picture has too much fine detail to shrink small enough. Try a simpler photo, or crop closer to your face.",
    );
  } finally {
    bitmap.close();
  }
}

/**
 * One square draw of the crop at `edge`, on a white ground.
 *
 * White first because JPEG has no transparency: a transparent PNG avatar would
 * otherwise encode its empty pixels as black, and a flat light ground also
 * compresses smaller than noise would.
 */
function drawSquare(
  bitmap: ImageBitmap,
  crop: { x: number; y: number; size: number },
  edge: number,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;

  const context = canvas.getContext("2d");
  if (!context) throw new ImageRejected("This browser could not process the image.");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, edge, edge);
  // A large downscale with the default smoothing aliases fine detail into
  // high-frequency noise, which is the most expensive thing JPEG can be asked
  // to encode. "high" costs a few milliseconds once, in the browser.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, edge, edge);
  return canvas;
}
