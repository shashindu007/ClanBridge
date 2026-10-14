"use client";

// "Download PNG" for one section of a print view — a clan's CWL lineup, ready
// to drop into the clan's WhatsApp group, which is where a lineup is actually
// read.
//
// The node is found by id rather than a ref so the server page can own the
// markup and this button can sit anywhere near it.
//
// `share` adds a "Share" button where the browser can hand a file to another
// app (a phone, mostly): the image goes straight to Facebook or WhatsApp
// without a trip through the downloads folder. A browser only opens the share
// sheet soon after the tap, and drawing the image can take longer; when it
// refuses, the finished image is kept and the next tap shares it at once.

import { useEffect, useState } from "react";
import { ImageDown, Loader2, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A transparent pixel: what an image that cannot be drawn becomes. */
const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function DownloadImageButton({
  targetId,
  fileName,
  label = "Download PNG",
  pixelRatio = 2,
  share = false,
}: {
  targetId: string;
  fileName: string;
  label?: string;
  /** Output pixels per CSS pixel: a 540px-wide node at 2 is a 1080px image. */
  pixelRatio?: number;
  share?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [canShare, setCanShare] = useState(false);
  /** Drawn, but the browser refused to share it that late after the tap. */
  const [pending, setPending] = useState<File | null>(null);
  const name = fileName.endsWith(".png") ? fileName : `${fileName}.png`;

  // Decided after mount: the server cannot know, and guessing would mismatch.
  useEffect(() => {
    if (!share || typeof navigator.canShare !== "function") return;
    try {
      setCanShare(navigator.canShare({ files: [new File([""], "probe.png", { type: "image/png" })] }));
    } catch {
      setCanShare(false);
    }
  }, [share]);

  async function render(): Promise<Blob | null> {
    const node = document.getElementById(targetId);
    if (!node) return null;
    // Loaded on demand: nobody who never presses this pays for it.
    const { toBlob } = await import("html-to-image");
    const options = {
      pixelRatio,
      backgroundColor: "#ffffff",
      // A transparent pixel for any image that cannot be fetched. Without it
      // html-to-image sets the clone's src to "" and ONE unreadable image —
      // a clan badge from a CDN that sends no CORS header — rejects the whole
      // export. (The sheets now load badges same-origin; this is the net.)
      imagePlaceholder: BLANK,
      // ...but that net only catches a fetch that throws or a 404. A 504 from
      // /_next/image (the badge CDN timing out) comes back as an error page
      // that cannot be decoded, and that too rejected the whole export. Such
      // an image is blanked instead.
      onImageErrorHandler: (event: Event | string) => {
        const img = typeof event === "string" ? null : event.target;
        if (img instanceof HTMLImageElement && img.src !== BLANK) img.src = BLANK;
      },
      // Buttons inside the captured node are for the screen, not the image.
      filter: (el: Node) => !(el instanceof HTMLElement && el.dataset.noCapture !== undefined),
    };
    try {
      return await toBlob(node, options);
    } catch (first) {
      // Font embedding is the other thing that fails in the wild; the sheet
      // still reads fine in the system font.
      console.error("PNG export failed, retrying without web fonts", first);
      return await toBlob(node, { ...options, skipFonts: true });
    }
  }

  async function run(action: (blob: Blob) => Promise<void>) {
    setBusy(true);
    setFailed(false);
    try {
      const blob = await render();
      if (blob) await action(blob);
    } catch (error) {
      if (!quiet(error)) {
        console.error("PNG export failed", error);
        setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  }

  const download = () =>
    run(async (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      // After the click has started the download, not before.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    });

  async function shareImage() {
    if (pending) {
      // Still inside this tap: nothing awaited before share().
      const file = pending;
      setPending(null);
      try {
        await navigator.share({ files: [file] });
      } catch (error) {
        if (!quiet(error)) setFailed(true);
      }
      return;
    }
    await run(async (blob) => {
      const file = new File([blob], name, { type: "image/png" });
      try {
        await navigator.share({ files: [file] });
      } catch (error) {
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          setPending(file);
          return;
        }
        throw error;
      }
    });
  }

  return (
    <span data-no-capture className="inline-flex flex-wrap items-center gap-2 print:hidden">
      <Button type="button" variant="outline" size="sm" onClick={download} disabled={busy}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : <ImageDown aria-hidden />}
        {label}
      </Button>
      {canShare && (
        <Button type="button" size="sm" onClick={shareImage} disabled={busy}>
          <Share2 aria-hidden />
          {pending ? "Tap to share" : "Share"}
        </Button>
      )}
      {failed && <span className="text-destructive text-xs">Could not render the image — try again.</span>}
    </span>
  );
}

/** Closing the share sheet without picking an app is not a failure. */
function quiet(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
