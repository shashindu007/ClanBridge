// A flag for what the game is doing right now: WAR · 12h, PREP · 4h, CWL DAY 3.
//
// The store's "NEW" and "BEST VALUE" banners, turned to this product's one
// piece of news that matters at a glance — which state a clan's war is in and
// how long it has left. A clan tile on Home leads with one, so the answer to
// "is anything happening" is readable from across the room.
//
// ALWAYS WORDS. The tone is decoration and the text is the meaning: a red
// ribbon that said nothing would be a status colour carrying meaning alone,
// which globals.css forbids. And a ribbon is never app health — "sync failed"
// is a status badge with its own icon, not a flag.

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type RibbonTone = "war" | "prep" | "cwl" | "neutral";

const TONE: Record<RibbonTone, string> = {
  war: "var(--ribbon-war)",
  prep: "var(--ribbon-prep)",
  cwl: "var(--ribbon-cwl)",
  neutral: "var(--ribbon-neutral)",
};

export function Ribbon({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: RibbonTone;
  icon?: LucideIcon;
  /** The words. Required: a ribbon never speaks in colour alone. */
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn("cb-ribbon", className)}
      data-tone={tone}
      style={{ "--ribbon": TONE[tone] } as React.CSSProperties}
    >
      {Icon && <Icon aria-hidden className="size-3.5" />}
      {children}
    </span>
  );
}
