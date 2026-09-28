// A Clash scene behind a surface: blurred, dimmed into the theme, and never
// in the way of the words on top of it.
//
// WHERE IT GOES: the landing page's hero, the sign-in screen, and behind every
// signed-in page (app/(app)/layout.tsx). Inside the app it sits under opaque
// panels and a heavy veil, so a war board or a table stays as legible as on
// the plain theme.
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
  /** How far the picture recedes: `sm` for a hero, `lg` behind a form. */
  blur?: "sm" | "md" | "lg";
  /**
   * Where the words sit, so the scrim is heaviest there. `page` is the whole
   * screen behind the signed-in app: clearest at the top, fading into the theme below,
   * where the dense panels are.
   */
  fade?: "left" | "even" | "page";
  /** Pinned to the viewport — the sign-in screen's whole-page backdrop. */
  fixed?: boolean;
  className?: string;
}) {
  const art = SCENES[scene];
  return (
    <div
      aria-hidden
      className={cn("cb-scene", fixed ? "fixed" : "absolute", className)}
      data-blur={blur}
      data-fade={fade}
    >
      <Image
        src={art.src}
        width={art.width}
        height={art.height}
        alt=""
        unoptimized
        priority
        className="cb-scene-img"
      />
    </div>
  );
}
