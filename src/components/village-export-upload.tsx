"use client";

// Upload a village export — the game's "Data Export" JSON — and save it (076).
//
// Two ways in, because members have it in two places: pasted from the clipboard
// (the game's Copy button), or a .json file they saved earlier. Both end as the
// same text.
//
// CHECKED TWICE. The parser is loaded here (dynamically, so members who never
// upload never download its ~60 KB of game data) to say "that is not an export"
// or "that is your other base" at once. The server then parses the raw text
// again and stores only what IT made of it — see account/bases/actions.ts.
//
// THE TAG MUST MATCH THIS BASE. A member with two villages will paste the wrong
// export sooner or later, and a card showing one village's walls under another's
// name is worse than an error.

import { useRef, useState, useTransition } from "react";
import { FileJson, Upload } from "lucide-react";
import { uploadVillageExport } from "@/app/(app)/account/bases/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { encodeTag } from "@/lib/tags";

/** MAX_EXPORT_BYTES in integration/village-export.ts, without importing its game data. */
const MAX_FILE_BYTES = 1_000_000;

export interface VillageExportFormProps {
  /** This base's tag, normalised (#PY0LQGRJ). The export must match it. */
  tag: string;
  /** What the member calls this base, for the mismatch message. */
  label: string;
  /** After a successful save. */
  onSaved?: () => void;
  onCancel?: () => void;
}

export function VillageExportForm({ tag, label, onSaved, onCancel }: VillageExportFormProps) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  async function pickFile(file: File | undefined) {
    setError("");
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("That file is far too large to be a village export.");
      return;
    }
    setText(await file.text());
    setFileName(file.name);
  }

  function save() {
    setError("");
    startTransition(async () => {
      const { parseVillageExport } = await import("@/integration/village-export");
      const parsed = parseVillageExport(text);
      if (!parsed.ok) {
        setError(parsed.error);
        return;
      }
      if (parsed.village.tag !== tag) {
        setError(`This export is for ${parsed.village.tag}, not ${label} (${tag}).`);
        return;
      }

      const result = await uploadVillageExport(encodeTag(tag), text);
      if (result.error) {
        setError(result.error);
        return;
      }
      // The text has done its job; holding ~60 KB in state for nothing is not useful.
      setText("");
      setFileName(null);
      onSaved?.();
    });
  }

  return (
    <div className="space-y-4">
      <ol className="text-muted-foreground list-decimal space-y-1 pl-5 text-sm">
        <li>In Clash of Clans, open Settings, then More Settings.</li>
        <li>Under Data Export, tap Copy.</li>
        <li>Paste it below, or choose a saved .json file.</li>
      </ol>

      <div className="space-y-1">
        <Label htmlFor={`village-export-${tag}`} className="text-xs">
          Village export
        </Label>
        <textarea
          id={`village-export-${tag}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName(null);
          }}
          rows={6}
          spellCheck={false}
          autoComplete="off"
          placeholder='{"tag":"#…","timestamp":…,"buildings":[…]}'
          className="border-input bg-background focus-visible:ring-ring/50 w-full rounded-control border p-3 font-mono text-base sm:text-xs focus-visible:ring-[3px] focus-visible:outline-none"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json,text/plain"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            void pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <FileJson aria-hidden />
          Choose .json file
        </Button>
        {fileName && <span className="text-muted-foreground truncate text-xs">{fileName}</span>}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={save} disabled={pending || text.trim() === ""}>
          <Upload aria-hidden />
          {pending ? "Saving…" : "Save export"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
      </div>

      <p className="text-muted-foreground text-xs">
        Saved to your account and visible only to you. Only levels, counts and timers are kept —
        never your base&apos;s layout. Upload again after upgrading to keep it current.
      </p>
    </div>
  );
}

/** The form in a dialog, for Home's base card. */
export function VillageExportDialog({
  tag,
  label,
  open,
  onOpenChange,
}: {
  tag: string;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload game JSON</DialogTitle>
          <DialogDescription>
            {label} — buildings, walls and upgrade timers, tracked on Home and in Base details.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <VillageExportForm
            tag={tag}
            label={label}
            onSaved={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
