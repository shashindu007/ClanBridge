"use server";

// Saving a member's in-game village export (076), from Home and Base details.
//
// THE SERVER PARSES IT AGAIN. The browser parses first, for an instant answer,
// but what is stored is what parseVillageExport() makes of the raw text HERE —
// a hand-built object posted to this action never reaches the table. Only the
// mapped village is kept; the raw text, with its base coordinates, is dropped
// at the end of this request (076's header).
//
// AUTHORISED BY OWNERSHIP (own-base.ts): the tag must be in the caller's own
// basesForUser() list, and the export must be for that same tag.
//
// A FRESH EXPORT RESETS THE TRACKER (079). It is the game's own word as of its
// timestamp, so every timer started here before that moment is retired — the
// export already shows each one running or done.

import { safeMessage } from "@/lib/errors";
import { parseVillageExport } from "@/integration/village-export";
import { clearVillageExport, saveVillageExport } from "@/repositories/village-exports";
import { resetTracked } from "@/repositories/tracked-upgrades";
import { ownBase, refresh, withinWriteLimit } from "./own-base";

export interface ExportActionState {
  error?: string;
}

/** Parse, check and save one base's export. Replaces any saved before. */
export async function uploadVillageExport(rawTag: string, text: string): Promise<ExportActionState> {
  const owned = await ownBase(rawTag);
  if (!owned.ok) return { error: owned.error };
  const { supabase, userId, base } = owned;

  const limited = await withinWriteLimit("village-export", userId);
  if (limited) return { error: limited };

  const parsed = parseVillageExport(typeof text === "string" ? text : "");
  if (!parsed.ok) return { error: parsed.error };
  if (parsed.village.tag !== base.tag) {
    return { error: `This export is for ${parsed.village.tag}, not this base (${base.tag}).` };
  }

  const { error } = await saveVillageExport(supabase, base.playerId, userId, parsed.village);
  if (error) return { error: safeMessage("village export save", error, "Could not save that export.") };

  // Not fatal: a timer left over is shown against the new export, and dropped
  // by the overlay if the export contradicts it.
  const reset = await resetTracked(supabase, base.playerId, new Date(parsed.village.exportedAt));
  if (reset.error) console.error(`tracked upgrades reset: ${reset.error.message}`);

  refresh(base);
  return {};
}

/** Remove the saved export, and the timers that rode on it. The rows stay, as tombstones (R4). */
export async function removeVillageExport(rawTag: string): Promise<ExportActionState> {
  const owned = await ownBase(rawTag);
  if (!owned.ok) return { error: owned.error };

  const { error } = await clearVillageExport(owned.supabase, owned.base.playerId);
  if (error) return { error: safeMessage("village export remove", error, "Could not remove that export.") };

  const reset = await resetTracked(owned.supabase, owned.base.playerId, null);
  if (reset.error) console.error(`tracked upgrades reset: ${reset.error.message}`);

  refresh(owned.base);
  return {};
}
