// A builder's hut, drawn here because the Fan Kit has no building art at all:
// not the kit in Downloads, not the asset zips. Until one does, every hut in
// the app (the Builder Base tile, "Builders busy", a Worker in the export
// grid) is this one glyph, so a builder never reads as a generic hammer.
//
// An original line icon in lucide's grid (24px, 2px stroke, round joins) so
// it sits beside lucide icons without looking borrowed: a hut with an arched
// door and a hammer leaning on its wall. currentColor, like every icon here.
//
// Server-safe: no hooks.

import { cn } from "@/lib/utils";

/** The props this file's glyphs share with a lucide icon, so either fits a slot. */
export type GlyphProps = {
  className?: string;
  style?: React.CSSProperties;
  "aria-hidden"?: boolean | "true" | "false";
};

/** Anything drawn as an icon: a lucide icon or one of this file's. */
export type Glyph = React.ComponentType<GlyphProps>;

export function BuilderHutIcon({ className, style, ...rest }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon="builder-hut"
      className={cn("size-6", className)}
      style={style}
      {...rest}
    >
      {/* Roof, with a little overhang. */}
      <path d="M2 11.5 10.5 4 19 11.5" />
      {/* Walls and floor. */}
      <path d="M4.5 10v10.5h12.5V10" />
      {/* Arched door. */}
      <path d="M8.5 20.5v-4a2 2 0 0 1 4 0v4" />
      {/* The hammer, leaning on the right wall. */}
      <path d="M17.6 21 21 14.2" />
      <path d="M18.9 12.6 22.6 14.4" strokeWidth={2.6} />
    </svg>
  );
}

/**
 * The village's builders as a row of huts: lit while working, dashed while
 * free. Says the count in words for a screen reader; the "3/6" beside it is for
 * everyone else.
 */
export function BuilderSlots({
  busy,
  total,
  className,
}: {
  busy: number;
  total: number;
  className?: string;
}) {
  // Six is the most a village has, plus the Builder Base's apprentice and
  // B.O.B: eight huts at most, which still fits a third of the card.
  const shown = Math.max(0, Math.min(total, 8));
  return (
    <span
      role="img"
      aria-label={`${busy} of ${total} builders busy`}
      className={cn("flex flex-wrap gap-1", className)}
    >
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className="cb-builder-slot"
          data-busy={i < busy || undefined}
          style={{ "--i": i } as React.CSSProperties}
        >
          <BuilderHutIcon aria-hidden className="size-3.5" />
        </span>
      ))}
    </span>
  );
}
