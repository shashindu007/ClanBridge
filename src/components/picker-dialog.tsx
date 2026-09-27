"use client";

// The CWL lineup builder's "Add players" dialog.
//
// Its open state lives in the URL (?pick=1, lib/roster-view.ts), not here.
// Every Add is a server action that redirects back to the page; state held in
// this component would reset on each one and close the dialog after every
// player — fifteen reopenings to fill a lineup. The URL survives the redirect,
// so the dialog stays open and the list stays scrolled where the leader was.
//
// Closing replaces the URL with the same view minus `pick`, so the back button
// does not reopen it.

import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function PickerDialog({
  open,
  closeHref,
  title,
  description,
  toolbar,
  children,
}: {
  open: boolean;
  closeHref: string;
  title: string;
  description?: React.ReactNode;
  /** Filters and search — stays put while the list scrolls. */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) router.replace(closeHref, { scroll: false });
      }}
    >
      <DialogContent size="wide" className="sm:h-[min(52rem,calc(100dvh-2rem))]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription asChild><div>{description}</div></DialogDescription>}
        </DialogHeader>
        {toolbar && <div className="space-y-3">{toolbar}</div>}
        <DialogBody>{children}</DialogBody>
      </DialogContent>
    </Dialog>
  );
}
