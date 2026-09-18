// T8.3 — share a layout.
//
// The page is a server component that resolves the clan and hands a server
// action down to the form; the form itself is a client component because the
// compression runs on the device (T8.2, see upload-form.tsx).
//
// R3 — requireClanByTag resolves the clan from the URL under the caller's own
// permissions, so a clan tag pasted in from elsewhere never reaches the insert.

import Link from "next/link";
import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/auth";
import { requireClanByTag } from "@/lib/clans";
import { createClient } from "@/lib/supabase/server";
import { isCopyLink } from "@/lib/layout-image";
import { LAYOUT_TYPES, TH_LEVELS, addLayout, type LayoutType } from "@/repositories/layouts";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

export default async function UploadLayoutPage({
  params,
}: {
  params: Promise<{ clanTag: string }>;
}) {
  const { clanTag } = await params;
  const supabase = await createClient();
  const clan = await requireClanByTag(supabase, clanTag);
  const base = `/${encodeURIComponent(clan.tag)}/layouts`;

  /**
   * Insert the row, once the image is already in the bucket.
   *
   * EVERY FIELD IS RE-VALIDATED HERE. The form checks the same things, but the
   * form is client code — a Server Action is independently addressable and
   * cannot assume anything about what called it. The clan is resolved again
   * rather than trusted from the input for the same reason.
   */
  async function save(input: {
    clanId: string;
    thLevel: number;
    layoutType: LayoutType;
    copyLink: string;
    description: string | null;
    imagePath: string | null;
  }): Promise<{ error?: string }> {
    "use server";

    const db = await createClient();
    const userId = await currentUserId(db);
    if (!userId) return { error: "You are signed out. Sign in and try again." };

    // Not input.clanId — resolved from the tag under this caller's permissions.
    const target = await requireClanByTag(db, clanTag);

    if (!isCopyLink(input.copyLink)) {
      return { error: "That is not a Clash of Clans layout link." };
    }
    if (!(TH_LEVELS as readonly number[]).includes(input.thLevel)) {
      return { error: "Pick a Town Hall level." };
    }
    if (!LAYOUT_TYPES.includes(input.layoutType)) {
      return { error: "Pick a layout type." };
    }

    // The image path must live under THIS clan's folder. The storage policy
    // (029) enforces it on upload too, but a row pointing outside would render
    // as a permanently broken card, so it is refused here rather than stored.
    if (input.imagePath && !input.imagePath.startsWith(`${target.id}/`)) {
      return { error: "That screenshot does not belong to this clan." };
    }

    const result = await addLayout(db, {
      clanId: target.id,
      uploadedBy: userId,
      thLevel: input.thLevel,
      layoutType: input.layoutType,
      copyLink: input.copyLink,
      imageUrl: input.imagePath,
      description: input.description?.slice(0, 500) ?? null,
    });

    if (result.error) return { error: result.error };

    revalidatePath(base);
    return {};
  }

  return (
    <main className="mx-auto max-w-2xl space-y-8 p-4 sm:p-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Share a layout</h1>
        <p className="text-muted-foreground text-sm">
          {clan.name} —{" "}
          <Link href={base} className="underline">
            back to the library
          </Link>
        </p>
      </div>

      <UploadForm clanId={clan.id} clanTag={clan.tag} save={save} />
    </main>
  );
}
