"use server";

// Saving a member's in-game village export (076), from Home and Base details.
//
// THE SERVER PARSES IT AGAIN. The browser parses first, for an instant answer,
// but what is stored is what parseVillageExport() makes of the raw text HERE —
// a hand-built object posted to this action never reaches the table. Only the
// mapped village is kept; the raw text, with its base coordinates, is dropped
// at the end of this request (076's header).
//
// AUTHORISED BY OWNERSHIP, as Base details is: the tag must be in the caller's
// own basesForUser() list, and the export must be for that same tag. 076's
// owner policies are the net under both.

import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/auth";
import { safeMessage } from "@/lib/errors";
import { sharedRateLimiter, WRITE_LIMIT } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { decodeTag, encodeTag, InvalidTagError } from "@/lib/tags";
import { parseVillageExport } from "@/integration/village-export";
import { basesForUser, type OwnedBase } from "@/repositories/account-bases";
import { clearVillageExport, saveVillageExport } from "@/repositories/village-exports";

export interface ExportActionState {
  error?: string;
}

type Owned = { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string; base: OwnedBase };

async function ownBase(rawTag: string): Promise<Owned | { ok: false; error: string }> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { ok: false, error: "Sign in again to save your export." };

  let tag: string;
  try {
    tag = decodeTag(rawTag);
  } catch (error) {
    if (error instanceof InvalidTagError) return { ok: false, error: "That base could not be found." };
    throw error;
  }

  const base = (await basesForUser(supabase, userId)).find((b) => b.tag === tag);
  // The same answer for "not yours" and "does not exist", as Base details' 404.
  if (!base) return { ok: false, error: "That base could not be found." };
  return { ok: true, supabase, userId, base };
}

function refresh(base: OwnedBase) {
  revalidatePath("/dashboard");
  revalidatePath(`/account/bases/${encodeTag(base.tag)}/details`);
}

/** Parse, check and save one base's export. Replaces any saved before. */
export async function uploadVillageExport(rawTag: string, text: string): Promise<ExportActionState> {
  const owned = await ownBase(rawTag);
  if (!owned.ok) return { error: owned.error };
  const { supabase, userId, base } = owned;

  try {
    const limited = await (await sharedRateLimiter(WRITE_LIMIT)).limit(`village-export:${userId}`);
    if (!limited.success) return { error: "Too many uploads in a row. Wait a minute and try again." };
  } catch {
    // Production without Upstash: rate-limit.ts throws on purpose. Fail closed.
    return { error: "Saving is unavailable right now. Try again later." };
  }

  const parsed = parseVillageExport(typeof text === "string" ? text : "");
  if (!parsed.ok) return { error: parsed.error };
  if (parsed.village.tag !== base.tag) {
    return { error: `This export is for ${parsed.village.tag}, not this base (${base.tag}).` };
  }

  const { error } = await saveVillageExport(supabase, base.playerId, userId, parsed.village);
  if (error) return { error: safeMessage("village export save", error, "Could not save that export.") };

  refresh(base);
  return {};
}

/** Remove the saved export. The row stays, as a tombstone (R4). */
export async function removeVillageExport(rawTag: string): Promise<ExportActionState> {
  const owned = await ownBase(rawTag);
  if (!owned.ok) return { error: owned.error };

  const { error } = await clearVillageExport(owned.supabase, owned.base.playerId);
  if (error) return { error: safeMessage("village export remove", error, "Could not remove that export.") };

  refresh(owned.base);
  return {};
}
