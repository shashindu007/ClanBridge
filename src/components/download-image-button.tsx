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
      const options = {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        // A transparent pixel for any image that cannot be fetched. Without it
        // html-to-image sets the clone's src to "" and ONE unreadable image —
        // a clan badge from a CDN that sends no CORS header — rejects the whole
        // export. (The sheets now load badges same-origin; this is the net.)
        imagePlaceholder:
          "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
        // Buttons inside the captured node are for the screen, not the image.
        filter: (el: Node) => !(el instanceof HTMLElement && el.dataset.noCapture !== undefined),
      };
      let url: string;
      try {
        url = await toPng(node, options);
      } catch (first) {
        // Font embedding is the other thing that fails in the wild; the sheet
        // still reads fine in the system font.
        console.error("PNG export failed, retrying without web fonts", first);
        url = await toPng(node, { ...options, skipFonts: true });
      }
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName.endsWith(".png") ? fileName : `${fileName}.png`;
      link.click();
    } catch (error) {
      console.error("PNG export failed", error);
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
