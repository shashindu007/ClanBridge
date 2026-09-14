"use client";

// T11.9 — picking and uploading a profile picture.
//
// A client component for the same reason layouts/upload/upload-form.tsx is one:
// the compression happens HERE, on the device holding the photograph. Section 3
// rejects `sharp`, and sending a 4 MB phone picture over mobile data in order to
// throw 99% of it away on the server would be the worst of both.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ORDER OF OPERATIONS, WHICH IS NOT THE OBVIOUS ONE
//
// The picture goes to Storage FIRST, under a client-generated uuid, and only then
// does users.avatar_path move to point at it. The obvious order — write the
// pointer, then upload — leaves the column naming an object that does not exist
// if the upload fails, which renders as a broken image on the member's own page
// with no way for them to tell it apart from a bug.
//
// This way round the failure mode is an orphaned object in the bucket: ~40 KB
// nobody references. That is a cost, not a defect, and it is the same trade 035's
// missing DELETE policy already accepts in writing.
//
// A CHANGED PICTURE IS A NEW OBJECT, never an overwrite. The uuid is fresh every
// time, so no signed URL already in a browser can start serving different bytes,
// and 035 needs no UPDATE policy. Its header carries the full argument.
// ─────────────────────────────────────────────────────────────────────────────

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AVATAR_TARGET_BYTES, avatarPath, compressAvatar } from "@/lib/avatar-image";
import { ImageRejected } from "@/lib/layout-image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export interface AvatarFormProps {
  /** The signed-in member. The FIRST path segment, which 035's policy checks. */
  userId: string;
  /** Server action that moves users.avatar_path once the object is in the bucket. */
  save: (input: { avatarPath: string }) => Promise<{ error?: string }>;
}

type Status = "idle" | "working" | "error";

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

export function AvatarForm({ userId, save }: AvatarFormProps) {
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ url: string; size: number } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  // Compress on PICK, not on submit. A member sees the square crop before they
  // commit to it — which matters more here than for a layout, because a centred
  // crop is a decision made FOR them and they should get to look at it — and a
  // rejected file is rejected immediately.
  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0] ?? null;
    setFile(null);
    setPreview(null);
    setMessage("");
    setStatus("idle");
    if (!picked) return;

    setStatus("working");
    try {
      const { blob } = await compressAvatar(picked);
      setFile(new File([blob], "avatar.jpg", { type: "image/jpeg" }));
      setPreview({ url: URL.createObjectURL(blob), size: blob.size });
      setStatus("idle");
    } catch (error) {
      setStatus("error");
      setMessage(
        error instanceof ImageRejected
          ? error.message
          : "That image could not be processed. Try a different picture.",
      );
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;

    setStatus("working");
    setMessage("");

    const supabase = createClient();
    const path = avatarPath(userId, crypto.randomUUID());

    // Storage first — see the note at the top of this file.
    const { error } = await supabase.storage.from("avatars").upload(path, file, {
      contentType: "image/jpeg",
      // No upsert. The name is a fresh uuid, so a collision would mean something
      // is wrong rather than something to overwrite.
      upsert: false,
    });

    if (error) {
      setStatus("error");
      setMessage(
        `The picture could not be uploaded: ${error.message}. Your account was not changed.`,
      );
      return;
    }

    const result = await save({ avatarPath: path });

    if (result.error) {
      setStatus("error");
      // The object IS in the bucket at this point and the pointer did not move.
      // Saying "try again" is right: the retry uploads a second object and moves
      // the pointer to that one, leaving the first orphaned — which is the cost
      // this design already accepts rather than a state anything has to repair.
      setMessage(result.error);
      return;
    }

    setFile(null);
    setPreview(null);
    setStatus("idle");
    // The server action revalidated, but this component holds its own state and a
    // refresh is what makes the section above it show the new picture.
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="avatar">
          {preview ? "A different picture" : "Choose a picture"}
        </Label>
        <Input
          id="avatar"
          type="file"
          // The three types sniffImageType recognises. The STORED object is always
          // JPEG — compressAvatar re-encodes — which is why 035's bucket allows
          // image/jpeg alone while this accepts all three.
          accept="image/jpeg,image/png,image/webp"
          onChange={onPick}
          disabled={status === "working"}
        />
        <p className="text-muted-foreground text-xs">
          Cropped to a square from the middle and shrunk to 256 pixels, in your
          browser. Nothing but the pixels is uploaded — the location and camera
          details a phone photo carries are left behind.
        </p>
      </div>

      {preview && (
        <div className="flex items-center gap-4">
          {/* A raw img on a blob: URL. next/image cannot optimise one, and there
              is nothing to optimise — the file is already 40 KB and local. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.url}
            alt="The picture you picked"
            className="size-24 rounded-full border object-cover"
          />
          <div className="text-muted-foreground space-y-1 text-xs">
            <p>{kb(preview.size)}</p>
            {preview.size > AVATAR_TARGET_BYTES && (
              // Not an error. compressAvatar returns the smallest it managed
              // rather than refusing, and 035's 100 KB limit is the real boundary.
              <p>Larger than usual, but well inside the limit.</p>
            )}
            <p>This is how it will look.</p>
          </div>
        </div>
      )}

      {status === "error" && (
        <Alert variant="destructive">
          <AlertTitle>Not saved</AlertTitle>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={!file || status === "working"}>
        {status === "working" ? "Working…" : "Save picture"}
      </Button>
    </form>
  );
}
