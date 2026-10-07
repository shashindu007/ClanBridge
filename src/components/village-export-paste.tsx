"use client";

// T11B.12 — "Paste village export", on the OWNER's Base details page only.
//
// ─────────────────────────────────────────────────────────────────────────────
// NOTHING LEAVES THE TAB
//
// The pasted text is parsed here, in the browser, and held in React state. There
// is no fetch, no server action, no localStorage, and no table. Reloading or
// leaving the page discards it, and the page says so. village-export.ts's
// header records why this is a decision (R11, and the export carries a full
// defensive inventory a member did not ask to publish).
//
// The parser and the game data behind it (~60 KB of JSON) are loaded with a
// dynamic import on the first "Show details", so members who never paste never
// download them.
//
// THE TAG MUST MATCH THIS BASE. A member with two villages will paste the wrong
// export sooner or later, and a page headed with one village's name showing
// another's buildings is worse than an error.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { VillageExportView } from "@/components/village-export-view";
import type { Village } from "@/types/domain";
import type { ExportedVillage } from "@/types/village";

export interface VillageExportPasteProps {
  /** This base's tag, normalised (#PY0LQGRJ). The export must match it. */
  tag: string;
  /** What the member calls this base, for the mismatch message. */
  label: string;
}

export function VillageExportPaste({ tag, label }: VillageExportPasteProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [village, setVillage] = useState<ExportedVillage | null>(null);
  const [which, setWhich] = useState<Village>("home");

  async function show() {
    setError("");
    setWorking(true);
    try {
      const { parseVillageExport } = await import("@/integration/village-export");
      const result = parseVillageExport(text);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.village.tag !== tag) {
        setError(`This export is for ${result.village.tag}, not ${label} (${tag}).`);
        return;
      }
      setVillage(result.village);
      setWhich("home");
      // The text has done its job; holding ~60 KB in state for nothing is not useful.
      setText("");
      setOpen(false);
    } finally {
      setWorking(false);
    }
  }

  function clear() {
    setVillage(null);
    setText("");
    setError("");
  }

  if (village) {
    return <VillageExportView village={village} which={which} onWhich={setWhich} onClear={clear} />;
  }

  return (
    <section className="cb-panel space-y-4 rounded-panel border p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">See everything, from your game</h2>
        <p className="text-muted-foreground text-sm">
          The details above come from Supercell&apos;s public data, which has no
          buildings, walls, traps or upgrade timers. Your game can export all of
          them. Paste that export to see them here.
        </p>
      </div>

      {!open ? (
        <Button type="button" onClick={() => setOpen(true)}>
          Paste village export
        </Button>
      ) : (
        <div className="space-y-3">
          <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
            <li>In Clash of Clans, open Settings, then More Settings.</li>
            <li>Under Data Export, tap Copy.</li>
            <li>Paste it below.</li>
          </ol>

          <div className="space-y-1">
            <Label htmlFor="village-export" className="text-xs">
              Village export
            </Label>
            <textarea
              id="village-export"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              spellCheck={false}
              autoComplete="off"
              placeholder='{"tag":"#…","timestamp":…,"buildings":[…]}'
              className="border-input bg-background focus-visible:ring-ring/50 w-full rounded-control border p-3 font-mono text-base sm:text-xs focus-visible:ring-[3px] focus-visible:outline-none"
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={show} disabled={working || text.trim() === ""}>
              {working ? "Reading…" : "Show details"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOpen(false);
                setError("");
              }}
            >
              Cancel
            </Button>
          </div>

          <p className="text-muted-foreground text-xs">
            Read in your browser only. Nothing is sent or saved, and it is gone when
            you leave or reload this page.
          </p>
        </div>
      )}
    </section>
  );
}
