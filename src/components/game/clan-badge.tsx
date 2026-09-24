// A clan's badge: the one the game gives it, or a shield in its colour.
//
// The badge comes from the official API (clans.badge_url, and for an opponent
// wars.opponent_badge_url), served from api-assets.clashofclans.com — the second
// of the two sources globals.css allows art from. It is the single most
// recognisable thing about a clan, which is why the clan tiles on Home and the
// banner on a clan's page lead with it.
//
// THE FALLBACK IS OURS. A clan synced before badges were stored, an opponent
// from a war that ended before migration 045, a network that drops the image:
// each gets the product's own shield outline (the same bezier as the page's
// backdrop, not an asset) filled with the clan's accent, and the clan's initial
// in it. Recognisably "a clan", never a broken-image icon.
//
// DECORATIVE BY DEFAULT: alt="" and aria-hidden, because every place that shows
// a badge also prints the clan's name beside it. A caller that shows a badge
// alone passes `label`.

import Image from "next/image";
import { cn } from "@/lib/utils";

type Size = "sm" | "md" | "lg" | "xl";

const PX: Record<Size, number> = { sm: 24, md: 40, lg: 56, xl: 80 };

export function ClanBadge({
  src,
  name,
  size = "md",
  tone,
  label,
  priority = false,
  className,
}: {
  src: string | null | undefined;
  name: string;
  size?: Size;
  /** The shield's fill when there is no badge — a clan accent, or var(--foe). */
  tone?: string;
  /** The accessible name, when no text beside the badge already names the clan. */
  label?: string;
  priority?: boolean;
  className?: string;
}) {
  const px = PX[size];
  const a11y = label ? { role: "img" as const, "aria-label": label } : { "aria-hidden": true };

  if (src) {
    return (
      <span {...a11y} className={cn("inline-flex shrink-0", className)}>
        <Image
          src={src}
          alt=""
          width={px}
          height={px}
          unoptimized
          priority={priority}
          className="cb-art object-contain"
          style={{ width: px, height: px }}
        />
      </span>
    );
  }

  const initial = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span {...a11y} className={cn("inline-flex shrink-0", className)}>
      <svg
        viewBox="30 16 72 94"
        width={px}
        height={px}
        className="cb-art"
        style={{ color: tone ?? "var(--primary)" }}
      >
        <path
          d="M66 20 L98 33 v27 c0 21-15 36-32 45-17-9-32-24-32-45V33z"
          fill="currentColor"
          stroke="oklch(0 0 0 / 0.35)"
          strokeWidth="2"
        />
        <path
          d="M66 26 L92 37 v23 c0 17-12 29-26 37-14-8-26-20-26-37V37z"
          fill="none"
          stroke="oklch(1 0 0 / 0.35)"
          strokeWidth="1.5"
        />
        <text
          x="66"
          y="70"
          textAnchor="middle"
          fill="white"
          fontSize="30"
          fontFamily="var(--font-display)"
          style={{ paintOrder: "stroke" }}
          stroke="oklch(0 0 0 / 0.3)"
          strokeWidth="2"
        >
          {initial}
        </text>
      </svg>
    </span>
  );
}
