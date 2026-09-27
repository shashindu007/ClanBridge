"use client";

// "Add 4 selected" — the bottom of the CWL player picker.
//
// The checkboxes live in the scrolling table and this bar lives under it, so
// they are joined by the HTML `form` attribute rather than by nesting: every
// checkbox says form="<formId>", and the <form> is the one this bar sits in.
// The browser includes them in its FormData and resets them with it, so after
// a save React's form reset clears the ticks on its own.
//
// The count is read from the DOM on each change rather than mirrored in state
// per row: ninety rows of controlled checkboxes would re-render the whole table
// on every tick.

import { useCallback, useEffect, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";

export function PickSelectionBar({
  formId,
  slotsLeft,
}: {
  formId: string;
  slotsLeft: number;
}) {
  const [count, setCount] = useState(0);

  const boxes = useCallback(
    () =>
      Array.from(
        document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][form="${formId}"]`),
      ),
    [formId],
  );

  const recount = useCallback(() => setCount(boxes().filter((b) => b.checked).length), [boxes]);

  useEffect(() => {
    const onChange = (event: Event) => {
      const target = event.target as HTMLInputElement | null;
      if (target?.getAttribute?.("form") === formId) recount();
    };
    const form = document.getElementById(formId);
    // A reset (after a save) clears the boxes without firing change events.
    const onReset = () => setTimeout(recount, 0);
    document.addEventListener("change", onChange);
    form?.addEventListener("reset", onReset);
    recount();
    return () => {
      document.removeEventListener("change", onChange);
      form?.removeEventListener("reset", onReset);
    };
  }, [formId, recount]);

  const over = count > slotsLeft;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
      <p className="text-sm">
        {count === 0 ? (
          <span className="text-muted-foreground">
            Tick players to add them. {slotsLeft} spot{slotsLeft === 1 ? "" : "s"} left.
          </span>
        ) : over ? (
          <span className="text-destructive font-medium">
            {count} selected — only {slotsLeft} spot{slotsLeft === 1 ? "" : "s"} left.
          </span>
        ) : (
          <span>
            <span className="font-semibold tabular-nums">{count}</span> selected ·{" "}
            <span className="text-muted-foreground">{slotsLeft - count} spots left after adding</span>
          </span>
        )}
      </p>
      <div className="flex items-center gap-2">
        {count > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              for (const box of boxes()) box.checked = false;
              recount();
            }}
          >
            Clear
          </Button>
        )}
        <SubmitButton size="sm" disabled={count === 0 || over} pendingLabel="Adding">
          {count > 0 ? `Add ${count} selected` : "Add selected"}
        </SubmitButton>
      </div>
    </div>
  );
}
