// The upgrade tracker (079), drawn: who is busy, what is left, and what it costs.
//
// LAID OUT IN THE ORDER A PLAYER ASKS THE QUESTIONS. Open the game, and the
// first thing checked is the top bar — is a builder free? So the workshop board
// comes first, one card per builder, the lab and the pet house, each counting
// down live. A free builder's card is the call to action: it opens the list of
// what that builder could do next, quickest first. Then the totals (how far from
// max, and what it will cost), then the list itself.
//
// Presentational only — no hooks, no state — like village-export-view.tsx, so
// upgrade-tracker-view.test.ts can render it statically. upgrade-tracker.tsx
// holds the tab, sort, boost and dialog, and calls the Server Actions.

import {
  CheckCircle2,
  ChevronDown,
  Clock,
  FlaskConical,
  Hammer,
  Hourglass,
  Lock,
  PawPrint,
  Play,
  Sparkles,
} from "lucide-react";
import { BuilderHutIcon, type Glyph } from "@/components/game/builder-hut-icon";
import { BuildingIcon } from "@/components/game/building-icon";
import { ResourceIcon, resourceLabel } from "@/components/game/resource-icon";
import { UnitIcon } from "@/components/game/unit-icon";
import { Countdown } from "@/components/countdown";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Price, Resource } from "@/data/game/costs";
import { cn } from "@/lib/utils";
import {
  BOOSTS,
  formatAmount,
  formatLong,
  itemTotal,
  nextStep,
  stepSeconds,
  type RemainingItem,
  type SortKey,
  type Totals,
  type UpgradeTab,
} from "@/services/upgrade-time";
import {
  formatDuration,
  secondsLeft,
  upgradeSubject,
  workshopOf,
  workshops,
  type Workshop,
} from "@/services/village";
import type { Village } from "@/types/domain";
import type { ExportedUpgrade, ExportedVillage } from "@/types/village";

export const TAB_LABELS: Record<UpgradeTab, string> = {
  builders: "Builder",
  lab: "Lab",
  pets: "Pets",
  walls: "Walls",
  equipment: "Equipment",
};

export const TAB_ORDER: UpgradeTab[] = ["builders", "lab", "pets", "walls", "equipment"];

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: "quickest", label: "Quickest" },
  { key: "cheapest", label: "Cheapest" },
  { key: "name", label: "A–Z" },
];

const WORKSHOP_GLYPH: Record<Workshop, Glyph> = {
  builders: BuilderHutIcon,
  lab: FlaskConical,
  pets: PawPrint,
};

/** Resources in the order the game's shop lists them. */
const RESOURCE_ORDER: Resource[] = [
  "gold",
  "elixir",
  "dark",
  "builderGold",
  "builderElixir",
  "gems",
  "shiny",
  "glowy",
  "starry",
];

// ─────────────────────────────────────────────────────────────────────────────
// Small pieces
// ─────────────────────────────────────────────────────────────────────────────

export function PriceList({ prices, times = 1, alt }: { prices: Price[]; times?: number; alt?: Price }) {
  if (prices.length === 0 || prices.every((p) => p.amount === 0)) {
    return <span className="text-muted-foreground">free</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {prices.map((p) => (
        <span key={p.resource} className="inline-flex items-center gap-1 tabular-nums">
          <ResourceIcon resource={p.resource} size={14} />
          <span>{formatAmount(p.amount * times)}</span>
          <span className="sr-only">{resourceLabel(p.resource)}</span>
        </span>
      ))}
      {alt && (
        <span className="text-muted-foreground inline-flex items-center gap-1">
          or <ResourceIcon resource={alt.resource} size={14} />
          <span className="sr-only">{resourceLabel(alt.resource)}</span>
        </span>
      )}
    </span>
  );
}

function ItemIcon({ item, size }: { item: RemainingItem; size: number }) {
  const level = item.fromLevel > 0 ? item.fromLevel : undefined;
  if (item.subjectType === "unit" && item.group) {
    return <UnitIcon name={item.name} group={item.group} size={size} level={level} locked={item.locked} />;
  }
  return <BuildingIcon name={item.name} village={item.village} kind={item.kind ?? "Other"} size={size} level={level} />;
}

function UpgradeIcon({ village, upgrade, which }: { village: ExportedVillage; upgrade: ExportedUpgrade; which: Village }) {
  const subject = upgradeSubject(village, upgrade);
  if (subject?.type === "unit") return <UnitIcon name={upgrade.name} group={subject.group} size={44} />;
  return <BuildingIcon name={upgrade.name} village={which} kind={subject?.kind ?? "Town Hall"} size={44} />;
}

// ─────────────────────────────────────────────────────────────────────────────
// The workshop board
// ─────────────────────────────────────────────────────────────────────────────

export interface WorkshopBoardProps {
  village: ExportedVillage;
  which: Village;
  now: Date;
  /** A free slot's button: show what this workshop could start next. */
  onPick?: (workshop: Workshop) => void;
  /** Finished early / Cancel, for a tracked timer. */
  slotActions?: (upgrade: ExportedUpgrade) => React.ReactNode;
}

export function WorkshopBoard({ village, which, now, onPick, slotActions }: WorkshopBoardProps) {
  const states = workshops(village, which, now);
  const running = village.upgrades
    .filter((u) => u.village === which && secondsLeft(u, now) > 0)
    .map((u) => ({ u, w: u.workshop ?? workshopOf(upgradeSubject(village, u)) }))
    .sort((a, b) => Date.parse(a.u.finishesAt) - Date.parse(b.u.finishesAt));

  const builders = states.find((s) => s.key === "builders");
  const free = builders ? Math.max(0, builders.total - builders.busy) : 0;
  const nextBuilder = running.find((r) => r.w === "builders");

  let headline = "No builders in this export.";
  if (builders && free > 0) headline = `${free} of ${builders.total} builders free`;
  else if (nextBuilder) {
    headline = `Next builder free in ${formatDuration(secondsLeft(nextBuilder.u, now))}: ${nextBuilder.u.name}`;
  }

  return (
    <section aria-labelledby="workshops-title" className="cb-panel space-y-4 rounded-panel border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="workshops-title" className="flex items-center gap-2 text-lg font-semibold">
          <Hourglass aria-hidden className="text-muted-foreground size-4.5" />
          Upgrading now
        </h2>
        <p className={cn("text-sm font-medium", free > 0 ? "text-success-ink" : "text-muted-foreground")}>
          {headline}
        </p>
      </div>

      {states.length === 0 ? (
        <p className="text-muted-foreground text-sm">This export has no builders, lab or pet house to show.</p>
      ) : (
        <ul className="cb-scroll-x -mx-1 flex snap-x snap-mandatory gap-2.5 px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3">
          {states.flatMap((state) => {
            const mine = running.filter((r) => r.w === state.key).slice(0, state.total);
            const cards = mine.map((r, i) => (
              <BusySlot
                key={`${state.key}-${r.u.trackedId ?? `${r.u.name}-${i}`}`}
                label={state.key === "builders" ? `Builder ${i + 1}` : state.label}
                village={village}
                upgrade={r.u}
                which={which}
                now={now}
                actions={slotActions?.(r.u)}
              />
            ));
            for (let i = mine.length; i < state.total; i++) {
              cards.push(
                <FreeSlot
                  key={`${state.key}-free-${i}`}
                  workshop={state.key}
                  label={state.key === "builders" ? "Free builder" : `${state.label} is free`}
                  onPick={onPick}
                />,
              );
            }
            return cards;
          })}
        </ul>
      )}

      <p className="text-muted-foreground text-xs">
        Start an upgrade in the game, then tap Start here. Levels go up by themselves when a timer
        ends. Timers that came with your export are marked as such.
      </p>
    </section>
  );
}

function BusySlot({
  label,
  village,
  upgrade: u,
  which,
  now,
  actions,
}: {
  label: string;
  village: ExportedVillage;
  upgrade: ExportedUpgrade;
  which: Village;
  now: Date;
  actions?: React.ReactNode;
}) {
  const started = u.startedAt ? Date.parse(u.startedAt) : Number.NaN;
  const ends = Date.parse(u.finishesAt);
  const pct = Number.isFinite(started) && ends > started ? ((now.getTime() - started) / (ends - started)) * 100 : null;

  return (
    <li className="cb-sunken flex min-w-[15.5rem] snap-start flex-col gap-2.5 rounded-control p-3 sm:min-w-0">
      <div className="flex items-center gap-3">
        <UpgradeIcon village={village} upgrade={u} which={which} />
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground flex items-center gap-1.5 text-[0.6875rem] font-semibold tracking-wide uppercase">
            {label}
            {u.source !== "tracked" && (
              <Badge variant="outline" className="px-1.5 py-0 text-[0.625rem] normal-case">
                from export
              </Badge>
            )}
          </p>
          <p className="truncate text-sm font-medium">{u.name}</p>
          <p className="text-muted-foreground text-xs tabular-nums">
            Level {u.fromLevel} → {u.fromLevel + 1}
          </p>
        </div>
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <Countdown iso={u.finishesAt} doneLabel="done" className="cb-title text-xl tabular-nums" />
        <span className="text-muted-foreground text-xs tabular-nums">
          <LocalTime iso={u.finishesAt} style="datetime" />
        </span>
      </div>
      {pct !== null && <Progress value={pct} label={`${u.name} ${Math.round(pct)}% done`} className="h-1.5" />}
      {actions && <div className="flex flex-wrap gap-1.5">{actions}</div>}
    </li>
  );
}

function FreeSlot({
  workshop,
  label,
  onPick,
}: {
  workshop: Workshop;
  label: string;
  onPick?: (workshop: Workshop) => void;
}) {
  const Icon = WORKSHOP_GLYPH[workshop];
  return (
    <li className="border-success/40 bg-success-tint/40 flex min-h-[9.5rem] min-w-[15.5rem] snap-start flex-col items-center justify-center gap-2 rounded-control border-2 border-dashed p-3 text-center sm:min-w-0">
      <Icon aria-hidden className="text-success-ink size-7" />
      <p className="text-sm font-semibold">{label}</p>
      {onPick && (
        <Button type="button" size="sm" variant="gold" onClick={() => onPick(workshop)}>
          <Sparkles aria-hidden />
          Pick an upgrade
        </Button>
      )}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Totals
// ─────────────────────────────────────────────────────────────────────────────

export interface TotalsHeaderProps {
  totals: Totals;
  hallLabel: string;
  builders: number;
  boost: number;
  onBoost?: (pct: number) => void;
  /** Which workshops this village has, for the time breakdown. */
  has: Workshop[];
}

export function TotalsHeader({ totals, hallLabel, builders, boost, onBoost, has }: TotalsHeaderProps) {
  const resources = RESOURCE_ORDER.filter((r) => (totals.cost[r] ?? 0) > 0);
  const maxed = totals.steps === 0;

  return (
    <div className="cb-sunken space-y-4 rounded-control p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Time to max {hallLabel}
          </p>
          <p className="cb-title text-3xl leading-none tabular-nums">
            {maxed ? "Maxed" : `≈ ${formatLong(totals.overall)}`}
          </p>
          {!maxed && (
            <p className="text-muted-foreground text-xs">
              With {builders} builder{builders === 1 ? "" : "s"}
              {boost > 0 ? ` and a ${boost}% Gold Pass boost` : ""}, never idle.
            </p>
          )}
        </div>
        {!maxed && (
          <dl className="grid grid-cols-3 gap-2 text-center">
            {(["builders", "lab", "pets"] as const)
              .filter((w) => has.includes(w))
              .map((w) => {
                const Icon = WORKSHOP_GLYPH[w];
                return (
                  <div key={w} className="bg-background/50 min-w-[5.5rem] rounded-control px-2 py-1.5">
                    <dt className="text-muted-foreground flex items-center justify-center gap-1 text-[0.6875rem]">
                      <Icon aria-hidden className="size-3.5" />
                      {TAB_LABELS[w]}
                    </dt>
                    <dd className="text-sm font-semibold tabular-nums">{formatLong(totals.finish[w])}</dd>
                  </div>
                );
              })}
          </dl>
        )}
      </div>

      {resources.length > 0 && (
        <ul aria-label="Resources still needed" className="flex flex-wrap gap-1.5">
          {resources.map((r) => (
            <li key={r} className="bg-background/60 flex items-center gap-1.5 rounded-chip border px-2.5 py-1 text-sm">
              <ResourceIcon resource={r} size={16} />
              <span className="font-semibold tabular-nums">{formatAmount(totals.cost[r]!)}</span>
              <span className="text-muted-foreground text-xs">{resourceLabel(r)}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        {onBoost && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs font-medium">Gold Pass boost</span>
            <div role="group" aria-label="Gold Pass boost" className="cb-segment flex gap-1">
              {BOOSTS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  aria-pressed={boost === pct}
                  data-active={boost === pct || undefined}
                  onClick={() => onBoost(pct)}
                  className="cb-choice min-h-9 px-2.5 text-xs"
                >
                  {pct === 0 ? "Off" : `${pct}%`}
                </button>
              ))}
            </div>
          </div>
        )}
        {totals.unpriced > 0 && (
          <p className="text-muted-foreground text-xs">
            {totals.unpriced} level{totals.unpriced === 1 ? " has" : "s have"} no price on record yet and
            {totals.unpriced === 1 ? " is" : " are"} left out.
          </p>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The list
// ─────────────────────────────────────────────────────────────────────────────

export interface UpgradesPanelProps {
  /** Already filtered to the tab and sorted. */
  items: RemainingItem[];
  tabs: Array<{ key: UpgradeTab; count: number }>;
  tab: UpgradeTab;
  onTab?: (tab: UpgradeTab) => void;
  sort: SortKey;
  onSort?: (sort: SortKey) => void;
  boost: number;
  /** Why Start is unavailable right now, or null when it can be pressed. */
  startBlocked?: (item: RemainingItem) => string | null;
  onStart?: (item: RemainingItem) => void;
  onMark?: (item: RemainingItem) => void;
  hallLabel: string;
  totals: React.ReactNode;
}

export function UpgradesPanel({
  items,
  tabs,
  tab,
  onTab,
  sort,
  onSort,
  boost,
  startBlocked,
  onStart,
  onMark,
  hallLabel,
  totals,
}: UpgradesPanelProps) {
  return (
    <section id="upgrades-left" aria-labelledby="upgrades-left-title" className="cb-panel scroll-mt-20 space-y-4 rounded-panel border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="upgrades-left-title" className="flex items-center gap-2 text-lg font-semibold">
          <Hammer aria-hidden className="text-muted-foreground size-4.5" />
          Upgrades left
        </h2>
        <span className="text-muted-foreground text-sm">for {hallLabel}</span>
      </div>

      {totals}

      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Upgrade type" className="cb-segment cb-scroll-x flex max-w-full gap-1 [&>*]:shrink-0">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              aria-pressed={t.key === tab}
              data-active={t.key === tab || undefined}
              onClick={() => onTab?.(t.key)}
              className="cb-choice min-h-10"
            >
              {TAB_LABELS[t.key]}
              <span className={cn("text-xs tabular-nums", t.key === tab ? "opacity-80" : "text-muted-foreground")}>
                {t.count}
              </span>
            </button>
          ))}
        </nav>
        {onSort && (
          <div role="group" aria-label="Sort" className="flex gap-1.5 sm:ml-auto">
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={s.key === sort}
                data-active={s.key === sort || undefined}
                onClick={() => onSort(s.key)}
                className="cb-choice min-h-10 text-sm"
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground flex items-center gap-2 py-2 text-sm">
          <CheckCircle2 aria-hidden className="text-success-ink size-4" />
          Nothing left here for {hallLabel}.
        </p>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {items.map((item) => (
            <UpgradeItemRow
              key={item.key}
              item={item}
              boost={boost}
              blocked={startBlocked?.(item) ?? null}
              onStart={onStart}
              onMark={onMark}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function titleOf(item: RemainingItem): string {
  if (item.action === "build") return `Build ${item.name}`;
  return item.name;
}

function levelLine(item: RemainingItem): string {
  const n = item.idle + item.busy;
  const plural = item.kind === "Wall" ? "pieces" : "";
  const many = n > 1 ? ` · ×${n}${plural ? ` ${plural}` : ""}` : "";
  if (item.locked) return `Not unlocked yet · max ${item.cap}`;
  if (item.action === "merge") {
    const from = item.merge?.map((m) => `${m.n} × ${m.name} Lv ${m.level}`).join(" + ");
    return `Merge ${from}${many}`;
  }
  if (item.action === "build") return `New${many} · max ${item.cap}`;
  const extra = item.hero ? ` · ${item.hero}` : "";
  return `Level ${item.fromLevel} → ${item.fromLevel + 1}${many}${extra} · max ${item.cap}`;
}

export function UpgradeItemRow({
  item,
  boost,
  blocked,
  onStart,
  onMark,
}: {
  item: RemainingItem;
  boost: number;
  blocked: string | null;
  onStart?: (item: RemainingItem) => void;
  onMark?: (item: RemainingItem) => void;
}) {
  const step = nextStep(item);
  const instant = item.workshop === null;
  const total = itemTotal(item, boost);
  const each = (item.idle + item.busy) > 1;
  const allBusy = item.idle === 0 && item.busy > 0;

  let action: React.ReactNode;
  if (item.locked) {
    action = (
      <Badge variant="outline">
        <Lock aria-hidden />
        Locked
      </Badge>
    );
  } else if (allBusy) {
    action = (
      <Badge variant="info">
        <Hourglass aria-hidden />
        Upgrading
      </Badge>
    );
  } else if (instant) {
    action = onMark && (
      <Button type="button" size="sm" variant="outline" onClick={() => onMark(item)}>
        <CheckCircle2 aria-hidden />
        Upgraded
      </Button>
    );
  } else {
    action = onStart && (
      <div className="flex flex-col items-end gap-0.5">
        <Button
          type="button"
          size="sm"
          variant="gold"
          onClick={() => onStart(item)}
          disabled={blocked !== null}
          aria-label={
            item.action === "upgrade"
              ? `Start ${item.name} level ${item.fromLevel + 1}`
              : item.action === "merge"
                ? `Merge into ${item.name}`
                : `Build ${item.name}`
          }
        >
          <Play aria-hidden />
          {item.action === "build" ? "Build" : item.action === "merge" ? "Merge" : "Start"}
        </Button>
        {blocked && <span className="text-muted-foreground max-w-[9rem] text-right text-[0.6875rem] leading-tight">{blocked}</span>}
      </div>
    );
  }

  return (
    <li className="cb-sunken rounded-control">
      <div className="flex items-center gap-3 p-2.5 sm:p-3">
        <ItemIcon item={item} size={44} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="truncate text-sm font-medium">{titleOf(item)}</p>
          <p className="text-muted-foreground truncate text-xs tabular-nums">{levelLine(item)}</p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            {step ? (
              <>
                <PriceList prices={step.cost} alt={step.alt} />
                {each && <span className="text-muted-foreground">each</span>}
                {!instant && (
                  <span className="text-muted-foreground inline-flex items-center gap-1 tabular-nums">
                    <Clock aria-hidden className="size-3.5" />
                    {formatDuration(stepSeconds(item, step, boost)) === "done"
                      ? "instant"
                      : formatDuration(stepSeconds(item, step, boost))}
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">No price on record for this level yet</span>
            )}
          </p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>

      {(item.steps.length > 1 || each) && (
        <details className="group border-t border-dashed">
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs [&::-webkit-details-marker]:hidden">
            <span className="font-medium">To max:</span>
            <PriceList prices={toPrices(total.cost)} />
            {!instant && total.seconds > 0 && <span className="tabular-nums">· {formatLong(total.seconds)}</span>}
            <ChevronDown aria-hidden className="ml-auto size-4 transition-transform group-open:rotate-180" />
          </summary>
          <ol className="grid gap-1 px-3 pb-3 text-xs sm:grid-cols-2">
            {item.steps.map((s, i) => (
              <li key={s?.level ?? `missing-${i}`} className="bg-background/50 flex items-center justify-between gap-2 rounded-chip px-2 py-1">
                <span className="font-medium tabular-nums">Lv {s?.level ?? "?"}</span>
                {s ? (
                  <span className="flex items-center gap-2">
                    <PriceList prices={s.cost} alt={s.alt} />
                    {!instant && (
                      <span className="text-muted-foreground tabular-nums">{formatDuration(stepSeconds(item, s, boost))}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">no price yet</span>
                )}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

function toPrices(cost: Partial<Record<Resource, number>>): Price[] {
  return RESOURCE_ORDER.filter((r) => (cost[r] ?? 0) > 0).map((r) => ({ resource: r, amount: cost[r]! }));
}
