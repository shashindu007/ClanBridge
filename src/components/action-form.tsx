"use client";

// A <form> for a Server Action that RETURNS its result instead of redirecting.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY NOT redirect(?ok=) LIKE THE REST OF THE APP
//
// In Next 15 a redirect() from a Server Action reaches the client as an error
// the page's RedirectBoundary catches — and it catches it by REMOUNTING the
// page. On the busy screens that cost everything a leader was in the middle of:
// the "Add players" dialog closed and reopened with its list scrolled back to
// the top, folded sections sprang back to their defaults, the window jumped to
// the top, Back gained an entry per click, and an Add queued behind the first
// was discarded by the redirect's navigation — "I cannot add 3 or 4 players".
//
// Returning { ok } / { error } and calling revalidatePath() on the server gets
// the fresh page in the SAME response, applied in place: one render, no remount,
// no history entry. This component shows the result as a toast (showToast) and
// lets React 19 reset the form, which clears ticked boxes after a bulk add.
//
// useFormStatus still works inside, so SubmitButton shows its pending state.
// ─────────────────────────────────────────────────────────────────────────────

import { useActionState } from "react";
import { showToast } from "@/components/toaster";

export interface ActionResult {
  /** A feedback.ts code, or a sentence shown as-is. */
  ok?: string;
  error?: string;
}

export type ResultAction = (formData: FormData) => Promise<ActionResult>;

export function ActionForm({
  action,
  hidden = {},
  className,
  id,
  onChange,
  children,
}: {
  action: ResultAction;
  hidden?: Record<string, string>;
  className?: string;
  id?: string;
  onChange?: React.FormEventHandler<HTMLFormElement>;
  children: React.ReactNode;
}) {
  const [, formAction] = useActionState<ActionResult | null, FormData>(async (_previous, formData) => {
    try {
      const result = await action(formData);
      if (result.error) showToast("error", result.error);
      else if (result.ok) showToast("ok", result.ok);
      return result;
    } catch (error) {
      // A redirect (e.g. to /login) must still propagate; everything else is a
      // failure the member should hear about rather than a silent no-op.
      if (error && typeof error === "object" && "digest" in error) throw error;
      showToast("error", "Something went wrong — try again.");
      return { error: "unknown" };
    }
  }, null);

  return (
    <form action={formAction} className={className} id={id} onChange={onChange}>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children}
    </form>
  );
}
