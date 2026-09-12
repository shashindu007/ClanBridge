// T5.3 — generate the PWA icons named in public/manifest.json.
//
//   npm run icons
//
// WHY A SCRIPT AND NOT THREE COMMITTED PNGs
//
// Section 3 rejects `sharp`: "compress in the browser before upload instead".
// That rules out the usual way to rasterise an icon at build time, and pulling in
// an image library for three files that change once a year would be worse.
//
// So this writes the PNGs directly. Node's zlib is the only thing it needs, which
// is why it has no dependencies and runs in CI if it ever needs to. The upside
// over committing binaries is that the icon is READABLE: when the branding
// changes, the change is a colour constant here, not an opaque blob nobody can
// diff.
//
// THE REAL MARK IS NOW public/icons/dh-logo.png — the clan's own DH monogram.
// Save it there and this builds every icon from it. The bridge below (three
// pillars carrying one deck: three clans, one platform) stays as the fallback
// for when that file is absent, so `npm run icons` never fails and a fresh
// checkout still has icons.
//
// The header used to say "REPLACE THIS WHEN THERE IS A REAL DESIGN. It is a
// competent placeholder, not a brand." There is one now.
//
// ON THE FAN CONTENT POLICY (T0.12): the warning that used to sit here was
// against an icon "lifted from the game", which is the thing that gets an API
// key revoked. A clan's own monogram is not that — it is the members' own
// artwork, drawn by them for their own group, and Supercell has no claim on it.
// The warning still holds for anything taken out of the game itself.

import { deflateSync, inflateSync } from "node:zlib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "public", "icons");
/** The clan's own artwork. Absent on a fresh checkout; see loadLogo(). */
const SOURCE_LOGO = join(OUT_DIR, "dh-logo.png");
/** Served before routing happens — see the comment in app/layout.tsx on why that matters. */
const FAVICON = join(process.cwd(), "public", "favicon.ico");

/** Matches manifest.json's background_color, so the splash screen has no seam. */
const BACKGROUND: RGB = [0x0f, 0x17, 0x2a];
const DECK: RGB = [0xe2, 0xe8, 0xf0];
const PILLAR: RGB = [0x38, 0xbd, 0xf8];

type RGB = [number, number, number];

// ---------------------------------------------------------------------------
// PNG encoding
//
// A PNG is a signature followed by length-prefixed, CRC-checked chunks. Three
// are required: IHDR, IDAT (the zlib-compressed pixels), IEND.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);

  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));

  return Buffer.concat([length, typed, crc]);
}

/** `pixels` is RGBA, row-major, 4 bytes per pixel. */
function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // colour type 6 = RGBA
  ihdr.writeUInt8(0, 10); // deflate
  ihdr.writeUInt8(0, 11); // adaptive filtering
  ihdr.writeUInt8(0, 12); // no interlace

  // Every scanline carries a leading filter byte. 0 = None: the rows are flat
  // colour, so a predictor would not help and this keeps the encoder honest.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Reading a PNG back in
//
// The icon is no longer drawn from geometry — it is the clan's own DH monogram,
// supplied as public/icons/dh-logo.png. Turning one source image into the four
// files a PWA needs means decoding it, which needs the inverse of everything
// above.
//
// STILL NO DEPENDENCY. Architecture.md section 2.3 rejects `sharp` on purpose
// ("compression happens in the browser before upload"), and pulling an image
// library in for four files that change once a year would be worse than the
// lines below. node:zlib does the only genuinely hard part.
//
// Scope is deliberately narrow: 8-bit, non-interlaced, greyscale / RGB /
// palette / with-alpha. That is what every export tool produces by default.
// Anything else throws WITH THE FIX IN THE MESSAGE rather than writing a
// corrupt icon, because a silently wrong favicon is the kind of thing nobody
// notices until it is already on every device.
// ---------------------------------------------------------------------------

interface Bitmap {
  width: number;
  height: number;
  /** RGBA, four bytes per pixel. */
  px: Uint8Array;
}

function fail(reason: string): never {
  throw new Error(
    `public/icons/dh-logo.png ${reason}. Re-save it as an 8-bit, non-interlaced ` +
      `PNG — in most tools that is plain "Export as PNG", not "PNG-8" and not ` +
      `"interlaced".`,
  );
}

function decodePng(buf: Buffer): Bitmap {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (SIGNATURE.some((b, i) => buf[i] !== b)) fail("is not a PNG");

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colourType = 0;
  let palette: Buffer | null = null;
  let paletteAlpha: Buffer | null = null;
  const idat: Buffer[] = [];

  let at = 8;
  while (at + 8 <= buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString("ascii", at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + length);
    at += 12 + length; // length + type + data + crc

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8]!;
      colourType = data[9]!;
      if (data[12] !== 0) fail("is interlaced");
    } else if (type === "PLTE") palette = Buffer.from(data);
    else if (type === "tRNS") paletteAlpha = Buffer.from(data);
    else if (type === "IDAT") idat.push(Buffer.from(data));
    else if (type === "IEND") break;
  }

  if (bitDepth !== 8) fail(`is ${bitDepth}-bit`);
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colourType];
  if (!channels) fail(`uses colour type ${colourType}`);
  if (colourType === 3 && !palette) fail("is indexed but carries no palette");

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filter = raw[rowStart]!;
    raw.copy(line, 0, rowStart + 1, rowStart + 1 + stride);

    // The five filters from the spec, undone. `a` is the byte one pixel to the
    // left, `b` the byte above, `c` the byte above-left.
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      let value = line[i]!;
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        // Paeth: take whichever neighbour the local gradient predicts best.
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) {
        fail(`uses row filter ${filter}, which is not one of the five in the spec`);
      }
      line[i] = value & 0xff;
    }
    line.copy(prev);

    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const src = x * channels;
      if (colourType === 0 || colourType === 4) {
        const grey = line[src]!;
        out[i] = grey;
        out[i + 1] = grey;
        out[i + 2] = grey;
        out[i + 3] = colourType === 4 ? line[src + 1]! : 255;
      } else if (colourType === 2 || colourType === 6) {
        out[i] = line[src]!;
        out[i + 1] = line[src + 1]!;
        out[i + 2] = line[src + 2]!;
        out[i + 3] = colourType === 6 ? line[src + 3]! : 255;
      } else {
        const index = line[src]!;
        out[i] = palette![index * 3]!;
        out[i + 1] = palette![index * 3 + 1]!;
        out[i + 2] = palette![index * 3 + 2]!;
        out[i + 3] = paletteAlpha?.[index] ?? 255;
      }
    }
  }

  return { width, height, px: out };
}

/**
 * Scale into a square of `size`, averaging every source pixel that lands in
 * each destination one.
 *
 * A box filter rather than nearest-neighbour, because the whole job is shrinking
 * a 512px mark down to 32px for a favicon: nearest-neighbour throws away
 * nine-tenths of the pixels and turns every clean diagonal into a staircase.
 *
 * Letterboxed, never stretched — a logo that is not square keeps its proportions
 * instead of being squashed to fit, and the margin stays transparent so the
 * caller decides what sits behind it.
 */
function fitSquare(src: Bitmap, size: number): Bitmap {
  const out = new Uint8Array(size * size * 4);
  const scale = Math.max(src.width, src.height) / size;
  const padX = (size - src.width / scale) / 2;
  const padY = (size - src.height / scale) / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx0 = Math.floor((x - padX) * scale);
      const sy0 = Math.floor((y - padY) * scale);
      const sx1 = Math.min(src.width, Math.ceil((x + 1 - padX) * scale));
      const sy1 = Math.min(src.height, Math.ceil((y + 1 - padY) * scale));

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let sy = Math.max(0, sy0); sy < sy1; sy++) {
        for (let sx = Math.max(0, sx0); sx < sx1; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.px[i]!;
          g += src.px[i + 1]!;
          b += src.px[i + 2]!;
          a += src.px[i + 3]!;
          n++;
        }
      }
      if (n === 0) continue; // outside the letterboxed area; stays transparent

      const i = (y * size + x) * 4;
      out[i] = Math.round(r / n);
      out[i + 1] = Math.round(g / n);
      out[i + 2] = Math.round(b / n);
      out[i + 3] = Math.round(a / n);
    }
  }
  return { width: size, height: size, px: out };
}

/** Lay a bitmap over an opaque background, inset by a fraction on every side. */
function compose(logo: Bitmap, size: number, inset: number, background: RGB): Canvas {
  const c = canvas(size, background);
  const inner = Math.max(1, Math.round(size * (1 - inset * 2)));
  const scaled = fitSquare(logo, inner);
  const offset = Math.round((size - inner) / 2);

  for (let y = 0; y < inner; y++) {
    for (let x = 0; x < inner; x++) {
      const s = (y * inner + x) * 4;
      const alpha = scaled.px[s + 3]! / 255;
      if (alpha === 0) continue;
      const d = ((y + offset) * size + (x + offset)) * 4;
      for (let ch = 0; ch < 3; ch++) {
        c.px[d + ch] = Math.round(
          c.px[d + ch]! * (1 - alpha) + scaled.px[s + ch]! * alpha,
        );
      }
    }
  }
  return c;
}

/**
 * An .ico wrapping a single PNG.
 *
 * ICO predates PNG and its original body is a BMP, but every browser in use
 * accepts a PNG inside the container — so this is a 22-byte header around a file
 * the encoder above already produces, rather than a second encoder.
 */
function encodeIco(png: Buffer, size: number): Buffer {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(1, 4); // one image in the file
  // A dimension byte of 0 means 256; nothing larger is representable.
  header.writeUInt8(size >= 256 ? 0 : size, 6);
  header.writeUInt8(size >= 256 ? 0 : size, 7);
  header.writeUInt8(0, 8); // not paletted
  header.writeUInt8(0, 9); // reserved
  header.writeUInt16LE(1, 10); // colour planes
  header.writeUInt16LE(32, 12); // bits per pixel
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18); // the image begins straight after this header
  return Buffer.concat([header, png]);
}

// ---------------------------------------------------------------------------
// The mark
// ---------------------------------------------------------------------------

interface Canvas {
  size: number;
  px: Uint8Array;
}

function canvas(size: number, fill: RGB): Canvas {
  const px = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = fill[0];
    px[i * 4 + 1] = fill[1];
    px[i * 4 + 2] = fill[2];
    px[i * 4 + 3] = 255;
  }
  return { size, px };
}

/**
 * Fill a rounded rectangle, in coordinates normalised to 0..1.
 *
 * Anti-aliased by sampling a 3x3 grid inside each pixel and blending by how much
 * of it landed inside the shape. Without this the pillars alias badly at 192 px,
 * which is the size almost every launcher actually shows.
 */
function roundedRect(
  c: Canvas,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  colour: RGB,
): void {
  const s = c.size;
  const px0 = Math.floor(x0 * s);
  const py0 = Math.floor(y0 * s);
  const px1 = Math.ceil(x1 * s);
  const py1 = Math.ceil(y1 * s);

  const inside = (px: number, py: number): boolean => {
    const x = px / s;
    const y = py / s;
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;

    // Only the corner regions need the distance test.
    const cx = x < x0 + radius ? x0 + radius : x > x1 - radius ? x1 - radius : x;
    const cy = y < y0 + radius ? y0 + radius : y > y1 - radius ? y1 - radius : y;
    if (cx === x || cy === y) return true;

    return Math.hypot(x - cx, y - cy) <= radius;
  };

  const SAMPLES = 3;
  for (let py = Math.max(0, py0); py < Math.min(s, py1); py++) {
    for (let px = Math.max(0, px0); px < Math.min(s, px1); px++) {
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          if (inside(px + (sx + 0.5) / SAMPLES, py + (sy + 0.5) / SAMPLES)) hits++;
        }
      }
      if (hits === 0) continue;

      const alpha = hits / (SAMPLES * SAMPLES);
      const i = (py * s + px) * 4;
      for (let ch = 0; ch < 3; ch++) {
        c.px[i + ch] = Math.round(c.px[i + ch]! * (1 - alpha) + colour[ch]! * alpha);
      }
    }
  }
}

/**
 * Three pillars carrying one deck.
 *
 * `inset` is the fraction of the canvas kept clear on every side. A maskable icon
 * may be cropped to a circle of 80% diameter by the launcher, so everything that
 * must survive has to sit inside the middle ~60%. The "any" variant can afford a
 * tighter inset and therefore a larger mark.
 */
function drawMark(c: Canvas, inset: number): void {
  const left = inset;
  const right = 1 - inset;
  const width = right - left;

  const deckH = width * 0.12;
  const pillarSpan = width * 0.46;

  // Centred on the canvas as a whole, not on the inset box: the mark is the only
  // thing here, and an icon whose contents sit even slightly low reads as broken
  // in a launcher grid next to icons that do not.
  const top = 0.5 - (deckH + pillarSpan) / 2;
  const deckBottom = top + deckH;

  roundedRect(c, left, top, right, deckBottom, deckH / 2, DECK);

  // All three hang FROM the deck — they carry it, so they meet it. Uneven
  // lengths because it is three clans, not three copies of one clan, and the
  // longest is centred so the shape still reads as balanced at 48 px.
  const lengths = [0.62, 1.0, 0.78];
  const pillarW = width * 0.16;
  const gap = (width - pillarW * 3) / 2;

  lengths.forEach((length, i) => {
    const x = left + i * (pillarW + gap);
    // Started slightly under the deck's lower edge so the two shapes overlap
    // rather than merely touching; a hairline seam appears at 192 px otherwise.
    const y = deckBottom - deckH * 0.25;
    roundedRect(c, x, y, x + pillarW, deckBottom + pillarSpan * length, pillarW / 2, PILLAR);
  });
}

/** The clan's own mark, if it has been saved. Null falls back to the drawn one. */
async function loadLogo(): Promise<Bitmap | null> {
  try {
    return decodePng(await readFile(SOURCE_LOGO));
  } catch (error) {
    // Absent is the ordinary case on a fresh checkout and must not fail the
    // script. A file that IS there but cannot be read is a different matter —
    // silently drawing the placeholder instead would look like the logo simply
    // did not take effect, which is the most confusing possible outcome.
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
    throw error;
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const logo = await loadLogo();
  console.log(
    logo
      ? `  source: ${SOURCE_LOGO} (${logo.width}x${logo.height})`
      : `  source: none at ${SOURCE_LOGO} — drawing the fallback mark`,
  );

  const icons: Array<{ file: string; size: number; inset: number }> = [
    { file: "icon-192.png", size: 192, inset: 0.18 },
    { file: "icon-512.png", size: 512, inset: 0.18 },
    // Wider margin: a maskable icon is cropped to whatever shape the launcher
    // prefers, and a mark drawn to the edge loses its corners on every Android
    // that rounds them.
    { file: "icon-512-maskable.png", size: 512, inset: 0.26 },
  ];

  for (const { file, size, inset } of icons) {
    const c = logo ? compose(logo, size, inset, BACKGROUND) : canvas(size, BACKGROUND);
    if (!logo) drawMark(c, inset);
    const png = encodePng(size, size, c.px);
    await writeFile(join(OUT_DIR, file), png);
    console.log(`  ${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
  }

  // The favicon, which was a committed binary nobody could diff.
  //
  // 32px, and a tighter inset than the app icons: a favicon is shown at 16px in
  // most tabs, so the generous margin that keeps a launcher icon off its own
  // edge here just throws away half the pixels the mark has to work with.
  const faviconSize = 32;
  const fc = logo
    ? compose(logo, faviconSize, 0.06, BACKGROUND)
    : canvas(faviconSize, BACKGROUND);
  if (!logo) drawMark(fc, 0.12);
  const ico = encodeIco(encodePng(faviconSize, faviconSize, fc.px), faviconSize);
  await writeFile(FAVICON, ico);
  console.log(`  favicon.ico  ${faviconSize}x${faviconSize}  ${(ico.length / 1024).toFixed(1)} KB`);

  console.log("\nWrote 3 icons to public/icons/ and public/favicon.ico.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
