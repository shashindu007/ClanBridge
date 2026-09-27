"use client";

// "Download PNG" for one section of a print view — a clan's CWL lineup, ready
// to drop into the clan's WhatsApp group, which is where a lineup is actually
// read.
//
// The node is found by id rather than a ref so the server page can own the
// markup and this button can sit anywhere near it.

import { useState } from "react";
import { ImageDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DownloadImageButton({
  targetId,
  fileName,
  label = "Download PNG",
}: {
  targetId: string;
  fileName: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function download() {
    const node = document.getElementById(targetId);
    if (!node) return;
    setBusy(true);
    setFailed(false);
    try {
      // Loaded on demand: nobody who never presses this pays for it.
      const { toPng } = await import("html-to-image");
      const url = await toPng(node, {
        pixelRatio: 2,
        cacheBust: true,
        backgroundColor: "#ffffff",
        // Buttons inside the captured node are for the screen, not the image.
        filter: (el) => !(el instanceof HTMLElement && el.dataset.noCapture !== undefined),
      });
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
      link.click();
    } catch {
      // Most often a cross-origin image (a clan badge the CDN will not share).
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span data-no-capture className="inline-flex items-center gap-2 print:hidden">
      <Button type="button" variant="outline" size="sm" onClick={download} disabled={busy}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : <ImageDown aria-hidden />}
        {label}
      </Button>
      {failed && <span className="text-destructive text-xs">Could not render the image — try PDF.</span>}
    </span>
  );
}
