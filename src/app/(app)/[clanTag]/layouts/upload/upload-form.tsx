"use client";

// T8.2/T8.3 — the upload form.
//
// A client component because the compression has to happen HERE, on the device
// that took the screenshot. Section 3 rejects `sharp`, and uploading a 3 MB
// phone screenshot over mobile data in order to throw most of it away on the
// server would be the worst of both.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ORDER OF OPERATIONS, WHICH IS NOT THE OBVIOUS ONE
//
// The image is uploaded to Storage FIRST, under a client-generated uuid, and
// only then is the database row inserted. The obvious order — insert the row,
// then name the image after its id — leaves a row pointing at an image that
// does not exist if the upload fails, and that row renders as a broken card
// forever with no way for a member to fix it.
//
// This way round the failure mode is an orphaned object in the bucket: a few
// hundred kilobytes nobody references. That is a cost, not a defect, and it is
// the same trade 029's missing DELETE policy already accepts.
//
// The path does not need to match the layout id. 029's policies only require
// the FIRST segment to be the clan, which is what
// storage.foldername(name)[1] reads.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ImageRejected,
  TARGET_BYTES,
  compressImage,
  isCopyLink,
  layoutImagePath,
} from "@/lib/layout-image";
import { LAYOUT_TYPES, TH_LEVELS, type LayoutType } from "@/repositories/layouts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface UploadFormProps {
  clanId: string;
  clanTag: string;
  /** Server action that inserts the row once the image is in the bucket. */
  save: (input: {
    clanId: string;
    thLevel: number;
    layoutType: LayoutType;
    copyLink: string;
    description: string | null;
    imagePath: string | null;
  }) => Promise<{ error?: string }>;
}

type Status = "idle" | "working" | "error";

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

export function UploadForm({ clanId, clanTag, save }: UploadFormProps) {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ url: string; size: number } | null>(null);
  const [copyLink, setCopyLink] = useState("");
  const [thLevel, setThLevel] = useState<number>(TH_LEVELS[0]!);
  const [layoutType, setLayoutType] = useState<LayoutType>("war");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  // Compress on PICK rather than on submit, so a member sees the result before
  // committing to it — and so a rejected file is rejected immediately rather
  // than after they have filled in the rest of the form.
  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setFile(null);
    setPreview(null);
    setMessage("");
    setStatus("idle");
    if (!picked) return;

    setStatus("working");
    try {
      const { blob } = await compressImage(picked);
      const compressed = new File([blob], "layout.jpg", { type: "image/jpeg" });
      setFile(compressed);
      setPreview({ url: URL.createObjectURL(blob), size: blob.size });
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof ImageRejected
          ? error.message
          : "That image could not be processed. Try a different screenshot.",
      );
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!isCopyLink(copyLink)) {
      setStatus("error");
      setMessage(
        "That is not a Clash of Clans layout link. In game: Layout Editor → Copy Link.",
      );
      return;
    }

    setStatus("working");
    setMessage("");

    let imagePath: string | null = null;

    // Image first — see the note at the top of this file.
    if (file) {
      const supabase = createClient();
      imagePath = layoutImagePath(clanId, crypto.randomUUID());

      const { error } = await supabase.storage.from("layouts").upload(imagePath, file, {
        contentType: "image/jpeg",
        // No upsert. The name is a fresh uuid, so a collision would mean
        // something is wrong rather than something to overwrite.
        upsert: false,
      });

      if (error) {
        setStatus("error");
        setMessage(
          `The screenshot could not be uploaded: ${error.message}. The layout was not saved.`,
        );
        return;
      }
    }

    const result = await save({
      clanId,
      thLevel,
      layoutType,
      copyLink: copyLink.trim(),
      description: description.trim() || null,
      imagePath,
    });

    if (result.error) {
      setStatus("error");
      setMessage(result.error);
      return;
    }

    router.push(`/${encodeURIComponent(clanTag)}/layouts`);
  }

  const busy = status === "working";

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {status === "error" && (
        <Alert variant="destructive">
          <AlertTitle>That did not work</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="copyLink">Copy link</Label>
        <Input
          id="copyLink"
          name="copyLink"
          required
          placeholder="https://link.clashofclans.com/…"
          value={copyLink}
          onChange={(e) => setCopyLink(e.target.value)}
          disabled={busy}
        />
        <p className="text-muted-foreground text-xs">
          In game: Layout Editor → <strong>Copy Link</strong>, then paste it here.
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="space-y-2">
          <Label htmlFor="thLevel">Town Hall</Label>
          <select
            id="thLevel"
            className="border-input bg-background h-9 rounded-control border px-3 text-sm"
            value={thLevel}
            onChange={(e) => setThLevel(Number(e.target.value))}
            disabled={busy}
          >
            {TH_LEVELS.map((level) => (
              <option key={level} value={level}>
                TH{level}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="layoutType">Type</Label>
          <select
            id="layoutType"
            className="border-input bg-background h-9 rounded-control border px-3 text-sm"
            value={layoutType}
            onChange={(e) => setLayoutType(e.target.value as LayoutType)}
            disabled={busy}
          >
            {LAYOUT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="screenshot">Screenshot</Label>
        <Input
          id="screenshot"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onPick}
          disabled={busy}
        />
        <p className="text-muted-foreground text-xs">
          {/* Said plainly because it is the reassuring half of "your photo is
              being rewritten": re-encoding is also what removes the location
              data a phone attaches to a picture of a screen. */}
          Resized and compressed on your phone before it is sent — which also
          strips any location data the picture carried. Optional, but a layout
          with no picture is rarely used.
        </p>

        {preview && (
          <div className="space-y-2 pt-2">
            {/* eslint-disable-next-line @next/next/no-img-element -- a blob: URL
                from this device, never optimised or fetched by the server. */}
            <img
              src={preview.url}
              alt="Your screenshot, as it will be stored"
              className="max-h-48 rounded border"
            />
            <p className="text-muted-foreground text-xs">
              {kb(preview.size)}
              {preview.size > TARGET_BYTES && " — larger than usual, but still accepted"}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          name="description"
          placeholder="Anti-3-star, funnels to the centre…"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={busy}
        />
      </div>

      <Button type="submit" disabled={busy}>
        {busy ? "Working…" : "Share layout"}
      </Button>
    </form>
  );
}
