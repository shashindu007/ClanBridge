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
 * 256 rather than 128: the rail draws it at 32px and /account at 96px, but a
 * retina screen asks for twice that, and re-uploading is the only way to fix a
 * picture that was stored too small. 256 covers 2x at every size the product uses
 * and costs nothing at this file size.
 */
export const AVATAR_EDGE = 256;

/** What this pipeline aims for. The bucket refuses at 100 KB (035) as a backstop. */
export const AVATAR_TARGET_BYTES = 40 * 1024;

/**
 * Quality steps tried in order until one comes in under target.
 *
 * Starts higher than the layout pipeline's 0.82 and stops shorter. A 256px square
 * is small enough that even 0.85 is usually well under 40 KB, and a face at 0.4
 * looks damaged in a way a base layout does not — below 0.5 the artefacts are the
 * first thing a member notices about their own picture.
 */
const AVATAR_QUALITY_STEPS = [0.85, 0.75, 0.65, 0.5];

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

  // fitWithin never enlarges, so a picture already smaller than 256px square is
  // kept at its own size rather than blown up into a bigger file holding the same
  // information. Passing the crop as a square means both returned edges agree.
  const { width: edge } = fitWithin(crop.size, crop.size, AVATAR_EDGE);

  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;

  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new ImageRejected("This browser could not process the image.");
  }

  context.drawImage(bitmap, crop.x, crop.y, crop.size, crop.size, 0, 0, edge, edge);
  bitmap.close();

  let last: Blob | null = null;
  for (const quality of AVATAR_QUALITY_STEPS) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) continue;
    last = blob;
    if (blob.size <= AVATAR_TARGET_BYTES) return { blob, width: edge, height: edge, quality };
  }

  if (!last) throw new ImageRejected("This browser could not process the image.");

  // Every step tried and still over. Returned rather than thrown, for the reason
  // compressImage() gives: the bucket's own 100 KB limit (035) is the real
  // boundary, and refusing here would reject a legitimate 45 KB picture for
  // missing a target that was only ever a goal.
  return {
    blob: last,
    width: edge,
    height: edge,
    quality: AVATAR_QUALITY_STEPS[AVATAR_QUALITY_STEPS.length - 1]!,
  };
}
