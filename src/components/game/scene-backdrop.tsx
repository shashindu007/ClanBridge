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
// did on a plain card. Each page's summary card — the clan banner, the base
// card on Home, the war score — carries the siege in flames instead, a little
// less blurred, so the card that says what the page is about stands apart
// from the lists under it.
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
  /** Siege machines and a wrecking ball breaking a wall, in a sea of fire. */
  siege: { src: "/scenes/siege-fire.webp", width: 1094, height: 629 },
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
        // A card's scene loads straight away, not lazily: a lazy picture behind
        // a panel can be skipped and leave the card plain. Low priority, so it
        // never holds up the page's own picture or data. It is the sign-in
        // screen's file, so most visitors already have it cached.
        {...(fade === "card" ? { loading: "eager" as const, fetchPriority: "low" as const } : { priority: true })}
        className="cb-scene-img"
      />
    </div>
  );
}

/**
 * A scene inside a panel. The sign-in screen's for a big panel — a members
 * list, a war board. `banner` is the page's summary card: the clan banner, the
 * base card on Home, the war score.
 *
 * The panel needs `isolate` (Panel's `scene` prop adds it) so the picture's
 * z-index:-1 stays inside the panel, above its background and below its text.
 * In a <details>, put this in the <summary>: it is positioned against the
 * details itself, so it covers the panel folded or open, where a child of the
 * body would vanish with it when folded.
 */
export function CardScene({ banner = false, className }: { banner?: boolean; className?: string }) {
  return banner ? (
    <SceneBackdrop scene="siege" blur="lg" fade="card" className={className} />
  ) : (
    <SceneBackdrop scene="skeleton" blur="xl" fade="card" className={className} />
  );
}
