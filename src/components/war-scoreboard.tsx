// T12.8 / T12.10 — a war, drawn the way the game draws one.
//
// This clan on the left in its own colour, the opponent on the right, a VS
// medallion between them. Stars are the headline because stars decide a war;
// destruction only breaks a tie, so it is the smaller line and a gauge.
//
// ONE component, used by the clan overview and the home page, so a war looks
// the same wherever a member meets it. It was inline in the clan page; a
// second copy on the home page would have drifted the first time either
// changed.
//
// Each side leads with its clan's badge (ClanBadge: the API's, or a tinted
// shield when a war predates migration 045), so the opponent is a clan you can
// recognise rather than a name in a cell.
//
// ACCESSIBILITY: the star count is said in words as well as digits, and
// destruction is a gauge AND a percentage — never the bar alone.

import { Star } from "lucide-react";
import { ClanBadge } from "@/components/game/clan-badge";

type Size = "compact" | "full";

function ScoreSide({
  name,
  badgeUrl,
  stars,
  destruction,
  tone,
  size,
  align = "start",
}: {
  name: string;
  badgeUrl: string | null | undefined;
  stars: number;
  destruction: number;
  tone: string;
  size: Size;
  align?: "start" | "end";
}) {
  const end = align === "end";
  const full = size === "full";
  const pct = Math.max(0, Math.min(100, destruction));

  return (
    <div className={`min-w-0 space-y-2 ${end ? "text-right" : ""}`}>
      <p className={`flex min-w-0 items-center gap-2 ${end ? "flex-row-reverse" : ""}`}>
        <ClanBadge src={badgeUrl} name={name} size={full ? "md" : "sm"} tone={tone} />
        <span className="truncate text-sm font-semibold" title={name}>
          {name}
        </span>
      </p>
      <p className={`flex items-center gap-1.5 ${end ? "justify-end" : ""}`}>
        <Star
          aria-hidden
          className={`fill-trim text-trim-shade shrink-0 ${full ? "size-6 sm:size-7" : "size-5"}`}
        />
        <span
          className={`cb-title leading-none tabular-nums ${full ? "text-3xl sm:text-4xl" : "text-2xl sm:text-3xl"}`}
        >
          {stars}
        </span>
        <span className="sr-only">stars</span>
      </p>
      <div
        className={`cb-gauge ${full ? "h-2.5" : "h-2"}`}
        role="img"
        aria-label={`${pct.toFixed(1)}% destruction`}
        style={{ "--gauge": tone } as React.CSSProperties}
      >
        <span style={{ width: `${pct}%`, marginLeft: end ? "auto" : undefined }} />
      </div>
      <p className="text-muted-foreground text-xs tabular-nums">{pct.toFixed(1)}% destroyed</p>
    </div>
  );
}

export function WarScoreboard({
  us,
  them,
  accent,
  size = "full",
}: {
  us: { name: string; stars: number | null; destruction: number | null; badgeUrl?: string | null };
  them: {
    name: string | null;
    stars: number | null;
    destruction: number | null;
    badgeUrl?: string | null;
  };
  /** This clan's colour, from clanAccent(). */
  accent: string;
  /** "compact" inside a tile, "full" at the top of the war board. */
  size?: Size;
}) {
  const full = size === "full";
  return (
    <div
      className={`cb-sunken grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-panel ${full ? "gap-3 p-4 sm:gap-6 sm:p-5" : "gap-3 p-3 sm:gap-4 sm:p-4"}`}
    >
      <ScoreSide
        name={us.name}
        badgeUrl={us.badgeUrl}
        stars={us.stars ?? 0}
        destruction={us.destruction ?? 0}
        tone={accent}
        size={size}
      />
      <span
        className={`cb-medal rounded-full ${full ? "size-11 sm:size-14" : "size-10"}`}
        style={{ "--medal": "var(--rail-2)" } as React.CSSProperties}
      >
        <span className={`cb-title ${full ? "text-base sm:text-lg" : "text-sm"}`}>VS</span>
      </span>
      <ScoreSide
        name={them.name ?? "Opponent"}
        badgeUrl={them.badgeUrl}
        stars={them.stars ?? 0}
        destruction={them.destruction ?? 0}
        tone="var(--foe)"
        size={size}
        align="end"
      />
    </div>
  );
}
