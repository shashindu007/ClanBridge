"use client";

// The upgrade tracker's state: which tab, which sort, the Gold Pass boost, and
// the Start dialog. The drawing is upgrade-tracker-view.tsx.
//
// The items arrive from the server with their prices attached (the price table
// never ships to the browser). Totals and sorting are re-done here, instantly,
// when the boost changes. Every write is a Server Action that revalidates the
// page, so after a Start the server sends the new board — nothing here keeps a
// second copy of what is running.
//
// THE BOOST IS REMEMBERED IN THIS BROWSER ONLY. It is a convenience (a member
// with the Gold Pass sets it once), not data: if storage is blocked the page
// simply starts at Off.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";
import {
  cancelUpgrade,
  finishUpgradeNow,
  markAlreadyUpgraded,
  startUpgrade,
  type UpgradeRef,
} from "@/app/(app)/account/bases/tracker-actions";
import { StartUpgradeDialog, type DialogMode } from "@/components/start-upgrade-dialog";
import {
  TAB_ORDER,
  TotalsHeader,
  UpgradesPanel,
  WorkshopBoard,
} from "@/components/upgrade-tracker-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { encodeTag } from "@/lib/tags";
import {
  BOOSTS,
  remainingTotals,
  sortItems,
  type RemainingItem,
  type Running,
  type SortKey,
  type UpgradeTab,
} from "@/services/upgrade-time";
import { workshops, type Workshop } from "@/services/village";
import type { Village } from "@/types/domain";
import type { ExportedUpgrade, ExportedVillage } from "@/types/village";

const BOOST_KEY = "cb-upgrade-boost";

export interface UpgradeTrackerProps {
  tag: string;
  /** The village as it stands now: the export with the overlay applied. */
  village: ExportedVillage;
  which: Village;
  /** The page's clock, ISO, so server and browser agree. */
  now: string;
  items: RemainingItem[];
  running: Running;
}

function readBoost(): number {
  try {
    const n = Number(window.localStorage.getItem(BOOST_KEY));
    return (BOOSTS as readonly number[]).includes(n) ? n : 0;
  } catch {
    return 0;
  }
}

function saveBoost(n: number): void {
  try {
    window.localStorage.setItem(BOOST_KEY, String(n));
  } catch {
    // Private window or blocked storage: the boost is just not remembered.
  }
}

function refOf(item: RemainingItem): UpgradeRef {
  return { village: item.village, subjectType: item.subjectType, name: item.name, fromLevel: item.fromLevel };
}

export function UpgradeTracker({ tag, village, which, now, items, running }: UpgradeTrackerProps) {
  const router = useRouter();
  const clock = useMemo(() => new Date(now), [now]);
  const slots = useMemo(() => workshops(village, which, clock), [village, which, clock]);
  const builders = slots.find((s) => s.key === "builders")?.total ?? 1;
  const hall = which === "home" ? village.thLevel : village.bhLevel;
  const hallLabel = `${which === "home" ? "Town Hall" : "Builder Hall"} ${hall ?? "?"}`;

  const counts = useMemo(() => {
    const out = new Map<UpgradeTab, number>();
    for (const i of items) out.set(i.tab, (out.get(i.tab) ?? 0) + i.idle + i.busy);
    return out;
  }, [items]);
  const tabs = TAB_ORDER.filter((t) => counts.has(t)).map((key) => ({ key, count: counts.get(key)! }));

  const [tab, setTab] = useState<UpgradeTab>(tabs[0]?.key ?? "builders");
  const [sort, setSort] = useState<SortKey>("quickest");
  const [boost, setBoostState] = useState(0);
  const [dialog, setDialog] = useState<{ item: RemainingItem; mode: DialogMode } | null>(null);
  const [error, setError] = useState("");
  const [boardError, setBoardError] = useState("");
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => setBoostState(readBoost()), []);

  const setBoost = (n: number) => {
    setBoostState(n);
    saveBoost(n);
  };

  const totals = useMemo(
    () => remainingTotals(items, { builders, boostPct: boost, running }),
    [items, builders, boost, running],
  );
  const shownTab = counts.has(tab) ? tab : (tabs[0]?.key ?? "builders");
  const visible = useMemo(
    () => sortItems(items.filter((i) => i.tab === shownTab), sort, boost),
    [items, shownTab, sort, boost],
  );

  function startBlocked(item: RemainingItem): string | null {
    if (!item.workshop) return null;
    const slot = slots.find((s) => s.key === item.workshop);
    if (!slot) return item.workshop === "builders" ? "No builders in the export" : null;
    if (slot.busy < slot.total) return null;
    return slot.key === "builders" ? `All ${slot.total} builders busy` : `${slot.label} busy`;
  }

  function pick(workshop: Workshop) {
    setTab(workshop);
    setSort("quickest");
    document.getElementById("upgrades-left")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function run(action: () => Promise<{ error?: string }>, onDone: () => void, onError: (message: string) => void) {
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        onError(result.error);
        router.refresh();
      } else {
        onDone();
      }
    });
  }

  const encoded = encodeTag(tag);

  function slotActions(u: ExportedUpgrade) {
    if (!u.trackedId) return null;
    const id = u.trackedId;
    if (cancelling === id) {
      return (
        <>
          <Button
            type="button"
            size="xs"
            variant="destructive"
            disabled={pending}
            onClick={() =>
              run(() => cancelUpgrade(encoded, id), () => setCancelling(null), setBoardError)
            }
          >
            Cancel timer
          </Button>
          <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => setCancelling(null)}>
            Keep it
          </Button>
        </>
      );
    }
    return (
      <>
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => finishUpgradeNow(encoded, id), () => setBoardError(""), setBoardError)}
        >
          <CheckCircle2 aria-hidden />
          Finished early
        </Button>
        <Button type="button" size="xs" variant="ghost" disabled={pending} onClick={() => setCancelling(id)}>
          <X aria-hidden />
          Cancel
        </Button>
      </>
    );
  }

  const open = (item: RemainingItem, mode: DialogMode) => {
    setError("");
    setDialog({ item, mode });
  };

  return (
    <>
      {boardError && (
        <Alert variant="destructive">
          <AlertDescription>{boardError}</AlertDescription>
        </Alert>
      )}

      <WorkshopBoard village={village} which={which} now={clock} onPick={pick} slotActions={slotActions} />

      <UpgradesPanel
        items={visible}
        tabs={tabs}
        tab={shownTab}
        onTab={setTab}
        sort={sort}
        onSort={setSort}
        boost={boost}
        startBlocked={startBlocked}
        onStart={(item) => open(item, "start")}
        onMark={(item) => open(item, "mark")}
        hallLabel={hallLabel}
        totals={
          <TotalsHeader
            totals={totals}
            hallLabel={hallLabel}
            builders={builders}
            boost={boost}
            onBoost={setBoost}
            has={slots.map((s) => s.key)}
          />
        }
      />

      <StartUpgradeDialog
        item={dialog?.item ?? null}
        mode={dialog?.mode ?? "start"}
        boost={boost}
        open={dialog !== null}
        onOpenChange={(o) => !o && !pending && setDialog(null)}
        pending={pending}
        error={error}
        onStart={(options) => {
          if (!dialog) return;
          if (options.boostPct !== boost) setBoost(options.boostPct);
          const item = dialog.item;
          run(() => startUpgrade(encoded, refOf(item), options), () => setDialog(null), setError);
        }}
        onMark={(count) => {
          if (!dialog) return;
          const item = dialog.item;
          run(() => markAlreadyUpgraded(encoded, refOf(item), count), () => setDialog(null), setError);
        }}
      />
    </>
  );
}
