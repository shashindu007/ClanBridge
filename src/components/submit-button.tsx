"use client";

// A submit button that shows it is working.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE PROBLEM THIS SOLVES
//
// Every mutation in this product is a <form> posting to a Server Action, and a
// Server Action is a round trip to a database in another region followed by a
// re-render of the whole page. Between the click and the new page arriving,
// nothing on screen changed at all — no spinner, no disabled state, not even a
// pressed one, because the press animation ends the moment the pointer lifts.
//
// So the button looked broken. The rational response to a control that appears
// to do nothing is to press it again, and on the roster builder — where every
// row carries four "assign to this clan" buttons — pressing again meant a
// second write racing the first.
//
// useFormStatus() reports the pending state of the NEAREST PARENT FORM, which is
// exactly the granularity wanted here: the roster page gives each button its own
// one-field form, so the button a leader pressed is the only one that shows as
// busy while the eighty others stay live.
//
// It must be a separate component for that to work — the hook reads context the
// <form> provides, so a component rendering the form cannot also read its
// status. That is the whole reason this file exists rather than a prop on
// Button.
// ─────────────────────────────────────────────────────────────────────────────

import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

export type SubmitButtonProps = React.ComponentProps<typeof Button> & {
  /**
   * What to say while the action is in flight. Defaults to the button's own
   * label, so the width does not jump and the member is not told a different
   * story mid-press.
   *
   * Worth setting where the wait is long enough to wonder about, and where the
   * verb changes meaning: "Publish to members" becoming "Publishing…" says the
   * thing is happening, which "Publish to members" with a spinner says less
   * plainly.
   */
  pendingLabel?: React.ReactNode;
};

export function SubmitButton({
  children,
  pendingLabel,
  disabled,
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      // Disabled while in flight, which is the half that prevents the double
      // write rather than merely explaining it. `disabled` from the caller still
      // wins, so a button that was already unavailable stays unavailable.
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending && <Loader2 aria-hidden className="animate-spin" />}
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
