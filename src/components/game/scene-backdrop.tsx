// A Clash scene behind a surface: blurred, dimmed into the theme, and never
// in the way of the words on top of it.
//
// WHERE IT GOES: the landing page's hero, the sign-in screen, and behind every
// signed-in page (app/(app)/layout.tsx). Inside the app it sits under opaque
// panels and a heavy veil, so a war board or a table stays as legible as on
// the plain theme.
//
// The big panels carry the sign-in screen's scene inside them as well
// (CardScene below): blurred further than the page behind, and veiled in the
// card's own colour, so a members list or a war board reads as clearly as it
// did on a plain card.
//
// THE FILES ARE UNTOUCHED. public/scenes/ holds the Fan Kit pictures resized
// and re-encoded, and nothing else (public/game/README.md). The blur and the
// scrim are CSS applied when the page is drawn, so the art itself is never
// recoloured, cropped or combined.
//
// DECORATION ONLY: aria-hidden, empty alt, and the scrim is the theme's own
// background colour, so text on top keeps the contrast globals.css measured
// for it in both themes.

import Image from "next/image";
import { cn } from "@/lib/utils";

export const SCENES = {
  /** A crystal cavern: Golem, Electro Titan, Baby Dragon, Archer, Barbarian. */
  crystal: { src: "/scenes/crystal-cave.webp", width: 1370, height: 630 },
  /** The Skeleton Kingdom: Archer Queen against the skeleton army. */
  skeleton: { src: "/scenes/skeleton-kingdom.webp", width: 1920, height: 1105 },
} as const;

export type SceneName = keyof typeof SCENES;

export function SceneBackdrop({
  scene,
  blur = "md",
  fade = "left",
  fixed = false,
  className,
}: {
  scene: SceneName;
  /** How far the picture recedes: `sm` for a hero, `lg` behind a form, `xl` inside a card. */
  blur?: "sm" | "md" | "lg" | "xl";
  /**
   * Where the words sit, so the scrim is heaviest there. `page` is the whole
   * screen behind the signed-in app: clearest at the top, fading into the theme below,
   * where the dense panels are. `card` is an even veil in the card's colour,
   * heavy enough that a table on top reads as on a plain card.
   */
  fade?: "left" | "even" | "page" | "card";
  /** Pinned to the viewport — the sign-in screen's whole-page backdrop. */
  fixed?: boolean;
  className?: string;
}) {
  const art = SCENES[scene];
  return (
    <div
      aria-hidden
      className={cn("cb-scene print:hidden", fixed ? "fixed" : "absolute", className)}
      data-blur={blur}
      data-fade={fade}
    >
      <Image
        src={art.src}
        width={art.width}
        height={art.height}
        alt=""
        unoptimized
        // A card's scene is often below the fold; the page's own is not.
        priority={fade !== "card"}
        className="cb-scene-img"
      />
    </div>
  );
}

/**
 * The sign-in screen's scene inside a big panel — a members list, a war board.
 *
 * The panel needs `isolate` (Panel's `scene` prop adds it) so the picture's
 * z-index:-1 stays inside the panel, above its background and below its text.
 * In a <details>, put this in the <summary>: it is positioned against the
 * details itself, so it covers the panel folded or open, where a child of the
 * body would vanish with it when folded.
 */
export function CardScene({ className }: { className?: string }) {
  return <SceneBackdrop scene="skeleton" blur="xl" fade="card" className={className} />;
}
