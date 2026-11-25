"use client";

// Start one upgrade timer, or mark instances already upgraded (079).
//
// ONE DIALOG, TWO JOBS, because a player arriving here has done one of two
// things in the game: just started an upgrade ("Start timer"), or upgraded
// something instantly or without telling us (walls, equipment, a book). The
// second is a quiet link under the first for builder and lab upgrades, and the
// whole dialog for walls and equipment, which never hold a builder.
//
// The finish time shown is a PREVIEW. The Server Action works it out again from
// the game data; the only figure the member can supply is the time left the
// game shows for an upgrade they started before opening this page.

import { useState } from "react";
import { BellRing, CheckCircle2, Minus, Play, Plus } from "lucide-react";
import Link from "next/link";
import { PriceList } from "@/components/upgrade-tracker-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDisplay } from "@/lib/display-time";
import { boostApplies, BOOSTS, nextStep, stepSeconds, type RemainingItem } from "@/services/upgrade-time";
import { formatDuration } from "@/services/village";

export type DialogMode = "start" | "mark";

export interface StartUpgradeDialogProps {
  item: RemainingItem | null;
  mode: DialogMode;
  boost: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error: string;
  onStart: (options: { boostPct: number; secondsLeft: number | null }) => void;
  onMark: (count: number) => void;
}

const MAX_DAYS = 45;

function clampInt(value: string, max: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : 0;
}

export function StartUpgradeDialog(props: StartUpgradeDialogProps) {
  const { item, open, onOpenChange } = props;
  return (
    <Dialog open={open && item !== null} onOpenChange={onOpenChange}>
      {item && (
        // Keyed by the item so a new pick starts from a clean form.
        <DialogInner key={`${item.key}:${props.mode}`} {...props} item={item} />
      )}
    </Dialog>
  );
}

function DialogInner({
  item,
  mode,
  boost: initialBoost,
  onOpenChange,
  pending,
  error,
  onStart,
  onMark,
}: StartUpgradeDialogProps & { item: RemainingItem }) {
  const step = nextStep(item);
  const [boost, setBoost] = useState(initialBoost);
  const [earlier, setEarlier] = useState(step === null);
  const [days, setDays] = useState("0");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("0");
  const [count, setCount] = useState(1);

  const boosts = boostApplies(item.workshop);
  const full = step ? stepSeconds(item, step, boosts ? boost : 0) : null;
  const typed = clampInt(days, MAX_DAYS) * 86_400 + clampInt(hours, 23) * 3_600 + clampInt(minutes, 59) * 60;
  const seconds = earlier ? typed : full;
  const finishes = seconds !== null ? new Date(Date.now() + seconds * 1000).toISOString() : null;
  const to = item.fromLevel + 1;
  const subject = item.action === "build" ? `a new ${item.name}` : `${item.name} to level ${to}`;

  if (mode === "mark") {
    const max = Math.max(1, item.idle);
    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark {item.name} upgraded</DialogTitle>
          <DialogDescription>
            For upgrades done in the game already. They move from level {item.fromLevel} to {to} here
            straight away.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {max > 1 && (
            <div className="space-y-2">
              <Label htmlFor="mark-count">How many</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="One fewer"
                  onClick={() => setCount((n) => Math.max(1, n - 1))}
                  disabled={count <= 1}
                >
                  <Minus aria-hidden />
                </Button>
                <Input
                  id="mark-count"
                  inputMode="numeric"
                  className="w-20 text-center tabular-nums"
                  value={count}
                  onChange={(e) => setCount(Math.min(max, Math.max(1, clampInt(e.target.value, max))))}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label="One more"
                  onClick={() => setCount((n) => Math.min(max, n + 1))}
                  disabled={count >= max}
                >
                  <Plus aria-hidden />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCount(max)}>
                  All {max}
                </Button>
              </div>
            </div>
          )}
          {step && (
            <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
              Cost: <PriceList prices={step.cost} times={count} alt={step.alt} />
            </p>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Not now
          </Button>
          <Button type="button" variant="bubble" onClick={() => onMark(count)} disabled={pending}>
            <CheckCircle2 aria-hidden />
            {pending ? "Saving…" : count > 1 ? `Mark ${count} upgraded` : "Mark upgraded"}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Start {subject}</DialogTitle>
        <DialogDescription>
          Start it in the game first, then here. It counts down on this page and levels up by
          itself when it ends.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-4">
        <div className="cb-sunken grid grid-cols-2 gap-3 rounded-control p-3 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Cost</p>
            {step ? <PriceList prices={step.cost} alt={step.alt} /> : <span>not on record</span>}
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Takes</p>
            <p className="font-semibold tabular-nums">{full !== null ? formatDuration(full) : "not on record"}</p>
          </div>
        </div>

        {boosts && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Gold Pass boost</p>
            <div role="group" aria-label="Gold Pass boost" className="cb-segment flex w-fit gap-1">
              {BOOSTS.map((pct) => (
                <button
                  key={pct}
                  type="button"
                  aria-pressed={boost === pct}
                  data-active={boost === pct || undefined}
                  onClick={() => setBoost(pct)}
                  className="cb-choice min-h-9 px-2.5 text-xs"
                >
                  {pct === 0 ? "Off" : `${pct}%`}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              className="size-4 accent-[var(--bubble)]"
              checked={earlier}
              disabled={step === null}
              onChange={(e) => setEarlier(e.target.checked)}
            />
            {step === null ? "Enter the time left the game shows" : "I started it earlier"}
          </label>
          {earlier && (
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  ["Days", days, setDays, MAX_DAYS],
                  ["Hours", hours, setHours, 23],
                  ["Minutes", minutes, setMinutes, 59],
                ] as const
              ).map(([label, value, set, max]) => (
                <div key={label} className="space-y-1">
                  <Label htmlFor={`left-${label}`} className="text-muted-foreground text-xs">
                    {label} left
                  </Label>
                  <Input
                    id={`left-${label}`}
                    inputMode="numeric"
                    className="tabular-nums"
                    value={value}
                    onChange={(e) => set(String(clampInt(e.target.value, max)))}
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {finishes && (
          <p className="text-sm">
            Finishes <span className="font-semibold">{formatDisplay(finishes, "datetime")}</span>
          </p>
        )}

        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <BellRing aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            A phone notification follows when it ends, up to 30 minutes late.{" "}
            <Link href="/settings/notifications" className="text-primary underline-offset-2 hover:underline">
              Notification settings
            </Link>
          </span>
        </p>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </DialogBody>
      <DialogFooter className="sm:justify-between">
        <Button type="button" variant="ghost" size="sm" onClick={() => onMark(1)} disabled={pending}>
          <CheckCircle2 aria-hidden />
          Already upgraded
        </Button>
        <Button
          type="button"
          variant="bubble"
          onClick={() => onStart({ boostPct: boosts ? boost : 0, secondsLeft: earlier ? typed : null })}
          disabled={pending || seconds === null || (earlier && typed === 0)}
        >
          <Play aria-hidden />
          {pending ? "Starting…" : "Start timer"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
