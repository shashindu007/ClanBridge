// What every Base details write checks first, shared by actions.ts (the export)
// and tracker-actions.ts (the upgrade tracker).
//
// A plain module rather than part of either action file: in a "use server" file
// every export becomes a callable endpoint, and these are not meant to be one.
//
// AUTHORISED BY OWNERSHIP, as Base details is: the tag must be in the caller's
// own basesForUser() list. 076's and 079's owner policies are the net under it.

import { revalidatePath } from "next/cache";
import { currentUserId } from "@/lib/auth";
import { sharedRateLimiter, WRITE_LIMIT } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { decodeTag, encodeTag, InvalidTagError } from "@/lib/tags";
import { basesForUser, type OwnedBase } from "@/repositories/account-bases";

export type Owned = {
  ok: true;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  base: OwnedBase;
};

export async function ownBase(rawTag: string): Promise<Owned | { ok: false; error: string }> {
  const supabase = await createClient();
  const userId = await currentUserId(supabase);
  if (!userId) return { ok: false, error: "Sign in again to save your changes." };

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

/**
 * The write limit, keyed per member and purpose. Fails CLOSED: production
 * without Upstash throws in rate-limit.ts on purpose, and a write it cannot
 * meter is a write it refuses.
 */
export async function withinWriteLimit(purpose: string, userId: string): Promise<string | null> {
  try {
    const limited = await (await sharedRateLimiter(WRITE_LIMIT)).limit(`${purpose}:${userId}`);
    return limited.success ? null : "Too many changes in a row. Wait a minute and try again.";
  } catch {
    return "Saving is unavailable right now. Try again later.";
  }
}

export function refresh(base: OwnedBase) {
  revalidatePath("/dashboard");
  revalidatePath(`/account/bases/${encodeTag(base.tag)}/details`);
}
