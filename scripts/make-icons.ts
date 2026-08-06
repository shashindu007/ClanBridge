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
// The mark is a bridge — three pillars carrying one deck, which is the whole
// product in one shape: three clans, one platform. Deliberately geometric, and
// deliberately not a Clash of Clans asset. Supercell's Fan Content Policy (T0.12)
// allows fan projects to exist; it does not license their artwork, and an icon
// lifted from the game is the kind of thing that gets an API key revoked.
//
// REPLACE THIS WHEN THERE IS A REAL DESIGN. It is a competent placeholder, not a
// brand. Nothing else depends on its appearance.

import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT_DIR = join(process.cwd(), "public", "icons");

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

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });

  const icons: Array<{ file: string; size: number; inset: number }> = [
    { file: "icon-192.png", size: 192, inset: 0.18 },
    { file: "icon-512.png", size: 512, inset: 0.18 },
    // Wider margin: a maskable icon is cropped to whatever shape the launcher
    // prefers, and a mark drawn to the edge loses its corners on every Android
    // that rounds them.
    { file: "icon-512-maskable.png", size: 512, inset: 0.26 },
  ];

  for (const { file, size, inset } of icons) {
    const c = canvas(size, BACKGROUND);
    drawMark(c, inset);
    const png = encodePng(size, size, c.px);
    await writeFile(join(OUT_DIR, file), png);
    console.log(`  ${file}  ${size}x${size}  ${(png.length / 1024).toFixed(1)} KB`);
  }

  console.log("\nWrote 3 icons to public/icons/.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
