"use client";

// The CWL lineup builder's "Add players" dialog.
//
// Opens from its own button, instantly — no round trip to the server just to
// show a list the page already rendered. The URL still carries `?pick=1` while
// it is open (history.replaceState, which costs no navigation), and the filter
// links inside it carry `pick=1` too, so a filter change, a search, or a reload
// lands back in the open dialog. Closing strips the flag the same way.
//
// Nothing here writes: the list's own form posts to the page's server action,
// which no longer redirects (components/action-form.tsx), so the dialog stays
// mounted, open and scrolled where the leader was through every save.

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

function setPickFlag(open: boolean) {
  const url = new URL(window.location.href);
  if (open) url.searchParams.set("pick", "1");
  else url.searchParams.delete("pick");
  // Our own two toast params never belong in a restored URL either.
  url.searchParams.delete("ok");
  url.searchParams.delete("error");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`);
}

export function PickerDialog({
  defaultOpen,
  triggerLabel = "Add players",
  triggerVariant = "gold",
  title,
  description,
  toolbar,
  footer,
  children,
}: {
  defaultOpen: boolean;
  triggerLabel?: string;
  triggerVariant?: "gold" | "outline";
  title: string;
  description?: React.ReactNode;
  /** Filters and search — stays put while the list scrolls. */
  toolbar?: React.ReactNode;
  /** Stays pinned under the list: the "Add N selected" bar. */
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setPickFlag(next);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant}>
          <UserPlus aria-hidden />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent size="wide" className="sm:h-[min(52rem,calc(100dvh-2rem))]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <DialogDescription asChild>
              <div>{description}</div>
            </DialogDescription>
          )}
        </DialogHeader>
        {toolbar && <div className="space-y-3">{toolbar}</div>}
        <DialogBody>{children}</DialogBody>
        {footer}
      </DialogContent>
    </Dialog>
  );
}
