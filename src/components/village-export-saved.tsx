"use client";

// The game export on the OWNER's Base details page: the saved one (076), with
// Replace and Remove, or the upload form when there is none.
//
// It replaced "Paste village export" (T11B.12), which parsed in the tab and kept
// nothing, so a member pasted again on every visit. 076's header says why it is
// saved now and what is kept. Not on the leader's page: it is the member's own
// game data, and only the owner can read it.

import { useState, useTransition } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { removeVillageExport } from "@/app/(app)/account/bases/actions";
import { UpgradeTracker } from "@/components/upgrade-tracker";
import { VillageExportForm } from "@/components/village-export-upload";
import { VillageExportView, type BuildingFilter } from "@/components/village-export-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { encodeTag } from "@/lib/tags";
import type { RemainingItem, Running } from "@/services/upgrade-time";
import type { Village } from "@/types/domain";
import type { ExportedVillage } from "@/types/village";

export interface SavedVillageExportProps {
  /** This base's tag, normalised (#PY0LQGRJ). */
  tag: string;
  /** What the member calls this base. */
  label: string;
  /** The saved export, or null when there is none. */
  village: ExportedVillage | null;
  /** The page's clock, ISO, so server and browser agree on time left. */
  now: string;
  /** Which village the page is showing: its `?village=` switch decides. */
  which?: Village;
  /**
   * The upgrade tracker (079): what is left, with prices, and what is running.
   * Worked out on the server, after the overlay. Absent shows the export alone.
   */
  tracker?: { items: RemainingItem[]; running: Running };
}

export function SavedVillageExport({ tag, label, village, now, which = "home", tracker }: SavedVillageExportProps) {
  const [filter, setFilter] = useState<BuildingFilter>("all");
  const [notMaxedOnly, setNotMaxedOnly] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!village || replacing) {
    return (
      <section className="cb-panel space-y-4 rounded-panel border p-5">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">
            {village ? "Replace your game export" : "Track everything, from your game"}
          </h2>
          <p className="text-muted-foreground text-sm">
            The details below come from Supercell&apos;s public data, which has no buildings,
            walls, traps or upgrade timers. Your game can export all of them. Upload that export
            once and it stays here, and on your Home card, until you upload a newer one.
          </p>
        </div>
        <VillageExportForm
          tag={tag}
          label={label}
          onSaved={() => setReplacing(false)}
          onCancel={village ? () => setReplacing(false) : undefined}
        />
      </section>
    );
  }

  function remove() {
    setError("");
    startTransition(async () => {
      const result = await removeVillageExport(encodeTag(tag));
      if (result.error) setError(result.error);
      setConfirming(false);
    });
  }

  const actions = confirming ? (
    <>
      <Button type="button" variant="destructive" size="sm" onClick={remove} disabled={pending}>
        {pending ? "Removing…" : "Remove it"}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={pending}>
        Keep it
      </Button>
    </>
  ) : (
    <>
      <Button type="button" size="sm" onClick={() => setReplacing(true)}>
        <RefreshCw aria-hidden />
        Upload newer
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden />
        Remove
      </Button>
    </>
  );

  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <VillageExportView
        village={village}
        which={which}
        now={new Date(now)}
        actions={actions}
        filter={filter}
        onFilter={setFilter}
        notMaxedOnly={notMaxedOnly}
        onNotMaxedOnly={setNotMaxedOnly}
        tracker={
          tracker && (
            <UpgradeTracker
              tag={tag}
              village={village}
              which={which}
              now={now}
              items={tracker.items}
              running={tracker.running}
            />
          )
        }
      />
    </div>
  );
}
