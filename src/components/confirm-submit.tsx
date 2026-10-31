"use client";

// A submit button that asks first.
//
// For the actions with no way back, or none a leader can reach: declining an
// applicant, closing a poll, removing a notice or a layout. A plain button sat
// beside a harmless one, so one mis-tap on a phone was enough.
//
// It goes inside an ordinary <form> or ActionForm in place of SubmitButton, and
// nothing about the form changes. The first press only opens the dialog, which
// lives in a portal outside the form, so its Yes finds the form and submits it.
// requestSubmit() rather than submit(): it runs validation and the form's action.

import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ConfirmSubmit({
  children,
  title,
  body,
  confirmLabel,
  size = "sm",
  variant = "outline",
  className,
}: {
  children?: React.ReactNode;
  /** The question: "Decline this applicant?" */
  title: string;
  /** What happens, and whether it can be undone. */
  body: string;
  /** The verb again, never "OK": "Decline", "Close poll". */
  confirmLabel: string;
  size?: React.ComponentProps<typeof Button>["size"];
  variant?: React.ComponentProps<typeof Button>["variant"];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const { pending } = useFormStatus();

  return (
    <span ref={anchor} className="contents">
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        {pending && <Loader2 aria-hidden className="animate-spin" />}
        {children}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setOpen(false);
                anchor.current?.closest("form")?.requestSubmit();
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
