// One picture from the game, or its stand-in.
//
// Every piece of Clash art in the product goes through this, so the rule in
// lib/game-art.ts — art is optional, and its absence is drawn rather than broken
// — is kept in one place. A caller passes the key it wants and the fallback it
// would draw without it; this decides which one renders.
//
// next/image with `unoptimized`, deliberately. The files are already the right
// size and format (the script writes 128-160px webp), so the optimiser would
// spend the host's image quota re-encoding a file into itself. What next/image
// still buys is lazy loading, async decoding and the width/height that stop
// the layout jumping when the picture arrives.

import Image from "next/image";
import { cn } from "@/lib/utils";
import { resolveArt, type ArtManifest } from "@/lib/game-art";

export function GameArt({
  art,
  size,
  alt,
  fallback = null,
  className,
  priority = false,
  manifest,
}: {
  /** A key from lib/game-art.ts: `th-17`, `hero-archer-queen`, `league-crystal-1`. */
  art: string | null;
  /** Rendered box, in px. The image is contained inside it, never cropped. */
  size: number;
  /** Empty when a word beside it already says what it is. */
  alt: string;
  /** What to draw when this deployment has no such art. */
  fallback?: React.ReactNode;
  className?: string;
  /** Above the fold on the page it sits on: load it eagerly. */
  priority?: boolean;
  /** For tests. Pages use the committed manifest. */
  manifest?: ArtManifest;
}) {
  const entry = resolveArt(art, manifest);
  if (!entry) return <>{fallback}</>;

  return (
    <Image
      src={entry.src}
      width={entry.width}
      height={entry.height}
      alt={alt}
      unoptimized
      priority={priority}
      className={cn("cb-art shrink-0 object-contain", className)}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The picture on a water-bubble plate: an aqua well with a rim and a shine,
 * the art inset so it never touches the edge. Fan Kit portraits are opaque
 * squares and buildings are cutouts; on the plate both read as the same kind
 * of game piece. Gold rim when maxed. No art → the caller's fallback, bare —
 * the stand-in token is already a filled tile of the same shape.
 */
export function PlatedArt({
  art,
  size,
  fallback = null,
  maxed = false,
  manifest,
}: {
  art: string | null;
  /** The plate, in px. The art is drawn at 80% of it. */
  size: number;
  fallback?: React.ReactNode;
  maxed?: boolean;
  manifest?: ArtManifest;
}) {
  if (!resolveArt(art, manifest)) return <>{fallback}</>;
  return (
    <span className="cb-icon-plate" data-maxed={maxed || undefined} style={{ width: size, height: size }}>
      <GameArt art={art} size={Math.round(size * 0.8)} alt="" manifest={manifest} />
    </span>
  );
}
