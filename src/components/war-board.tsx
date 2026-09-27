// The enemy side as a board of cards, one per base — the shape of the in-game
// war map rather than a table of it.
//
// Each card answers the two questions a leader brings to a base, in colour AND
// in words: is anyone on it, and what has happened to it.
//
//   Free         blue, dashed     nobody assigned, nobody has attacked
//   Assigned     gold             a member holds it (named on the card)
//   Attacked     amber            hit, not yet for three stars
//   Three stars  green            done — nothing more to win here
//
// The state is derived in services/war.ts (enemyBoard); this only draws it.

import { CheckCircle2, Circle, Swords, UserCheck } from "lucide-react";
import { Stars } from "@/components/stars";
import { TownHall } from "@/components/game/town-hall";
import type { EnemyBase } from "@/services/war";
import { cn } from "@/lib/utils";

export type BaseState = "free" | "assigned" | "attacked" | "cleared";

export function baseState(base: EnemyBase): BaseState {
  if (base.bestStars === 3) return "cleared";
  if (base.bestStars !== null) return "attacked";
  if (base.assignedTo.length > 0) return "assigned";
  return "free";
}

const STATE: Record<BaseState, { label: string; card: string; chip: string; icon: typeof Circle }> = {
  free: {
    label: "Free",
    card: "border-dashed border-info/50",
    chip: "bg-info-tint text-info-ink",
    icon: Circle,
  },
  assigned: {
    label: "Assigned",
    card: "border-gold/70",
    chip: "bg-gold text-gold-ink",
    icon: UserCheck,
  },
  attacked: {
    label: "Attacked",
    card: "border-warning/70",
    chip: "bg-warning-tint text-warning-ink",
    icon: Swords,
  },
  cleared: {
    label: "Three stars",
    card: "border-success/70",
    chip: "bg-success-tint text-success-ink",
    icon: CheckCircle2,
  },
};

export function BaseStateLegend() {
  return (
    <ul className="flex flex-wrap gap-2 text-xs" aria-label="What the colours mean">
      {(Object.keys(STATE) as BaseState[]).map((key) => {
        const { label, chip, icon: Icon } = STATE[key];
        return (
          <li key={key} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium", chip)}>
            <Icon aria-hidden className="size-3" />
            {label}
          </li>
        );
      })}
    </ul>
  );
}

export function BaseCard({ base, action }: { base: EnemyBase; action?: React.ReactNode }) {
  const state = baseState(base);
  const { label, card, chip, icon: Icon } = STATE[state];
  const holder = base.assignedTo.map((a) => a.name).join(", ");

  return (
    <li className={cn("bg-tile flex min-w-0 flex-col gap-2 rounded-panel border-2 p-3", card)}>
      <div className="flex items-start justify-between gap-2">
        <span className="cb-title text-2xl leading-none tabular-nums" aria-label={`Base ${base.position}`}>
          {base.position}
        </span>
        <TownHall level={base.thLevel} size="sm" />
      </div>
      <p className="truncate text-sm" title={base.name ?? undefined}>
        {base.name ?? <span className="text-muted-foreground">Unknown</span>}
      </p>

      <span className={cn("inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", chip)}>
        <Icon aria-hidden className="size-3" />
        {label}
      </span>

      {holder && (
        <p className="truncate text-xs" title={holder}>
          <span className="text-muted-foreground">On it: </span>
          <span className="font-semibold">{holder}</span>
        </p>
      )}

      {base.bestStars !== null && (
        <p className="text-xs">
          <Stars stars={base.bestStars} />{" "}
          <span className="text-muted-foreground tabular-nums">{base.bestDestruction?.toFixed(0)}%</span>
          <span className="text-muted-foreground block truncate">
            by {base.attackedBy.map((a) => a.name).join(", ")}
          </span>
        </p>
      )}

      {action && <div className="mt-auto pt-1">{action}</div>}
    </li>
  );
}
