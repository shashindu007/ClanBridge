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
// ACCESSIBILITY: the star count is said in words as well as digits, and
// destruction is a gauge AND a percentage — never the bar alone.

import { Star } from "lucide-react";

function ScoreSide({
  name,
  stars,
  destruction,
  tone,
  align = "start",
}: {
  name: string;
  stars: number;
  destruction: number;
  tone: string;
  align?: "start" | "end";
}) {
  const end = align === "end";
  const pct = Math.max(0, Math.min(100, destruction));

  return (
    <div className={`min-w-0 space-y-2 ${end ? "text-right" : ""}`}>
      <p className="truncate text-sm font-semibold" title={name}>
        {name}
      </p>
      <p className={`flex items-center gap-1.5 ${end ? "justify-end" : ""}`}>
        <Star aria-hidden className="fill-trim text-trim-shade size-6 shrink-0 sm:size-7" />
        <span className="cb-title text-3xl leading-none tabular-nums sm:text-4xl">{stars}</span>
        <span className="sr-only">stars</span>
      </p>
      <div
        className="cb-gauge h-2.5"
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
}: {
  us: { name: string; stars: number | null; destruction: number | null };
  them: { name: string | null; stars: number | null; destruction: number | null };
  /** This clan's colour, from clanAccent(). */
  accent: string;
}) {
  return (
    <div className="cb-sunken grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl p-4 sm:gap-6 sm:p-5">
      <ScoreSide
        name={us.name}
        stars={us.stars ?? 0}
        destruction={us.destruction ?? 0}
        tone={accent}
      />
      <span
        className="cb-medal size-11 rounded-full sm:size-14"
        style={{ "--medal": "var(--rail-2)" } as React.CSSProperties}
      >
        <span className="cb-title text-base sm:text-lg">VS</span>
      </span>
      <ScoreSide
        name={them.name ?? "Opponent"}
        stars={them.stars ?? 0}
        destruction={them.destruction ?? 0}
        tone="var(--foe)"
        align="end"
      />
    </div>
  );
}
