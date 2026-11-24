"use server";

// The upgrade tracker's writes (079): Start, Finished early, Cancel, and
// Already upgraded.
//
// NOTHING THE BROWSER SAYS ABOUT A PRICE OR A TIME IS TRUSTED. The browser names
// WHICH upgrade ("Cannon, level 19, home"); this file re-reads the export and
// the timers, re-runs the overlay and remainingUpgrades() exactly as the page
// did, and works out the finish time from the game data. The one figure a
// member may supply is the time left on an upgrade they started in the game
// before telling us — it is theirs to know, and capped at 45 days by 079.
//
// EVERY WRITE SETTLES FIRST. Timers that have ended are folded into the export
// before anything new is written (apply_tracked_upgrades, one transaction), so
// the table holds only what is still running and a builder freed a minute ago is
// free for the next Start.

import { safeMessage } from "@/lib/errors";
import { remainingUpgrades } from "@/services/upgrades";
import { boostApplies, boosted, BOOSTS, type RemainingItem } from "@/services/upgrade-time";
import { applyTracked, markUpgraded, type SubjectType } from "@/services/village-overlay";
import { workshops } from "@/services/village";
import {
  cancelTracked,
  finishTracked,
  foldTracked,
  insertTracked,
  trackedUpgradesFor,
} from "@/repositories/tracked-upgrades";
import { latestReadings } from "@/repositories/player-progress";
import { villageExportsFor, type SavedExport } from "@/repositories/village-exports";
import type { Village } from "@/types/domain";
import { ownBase, refresh, withinWriteLimit, type Owned } from "./own-base";

export interface TrackerActionState {
  error?: string;
}

/** Which upgrade, as the browser names it. Everything else is looked up. */
export interface UpgradeRef {
  village: Village;
  subjectType: SubjectType;
  name: string;
  fromLevel: number;
}

const MAX_SECONDS = 45 * 86_400;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validRef(ref: unknown): ref is UpgradeRef {
  if (!ref || typeof ref !== "object") return false;
  const r = ref as Record<string, unknown>;
  return (
    (r.village === "home" || r.village === "builder") &&
    (r.subjectType === "building" || r.subjectType === "unit" || r.subjectType === "weapon") &&
    typeof r.name === "string" &&
    r.name.length > 0 &&
    r.name.length <= 64 &&
    Number.isInteger(r.fromLevel) &&
    (r.fromLevel as number) >= 0 &&
    (r.fromLevel as number) <= 200
  );
}

interface Settled {
  saved: SavedExport;
  overlay: ReturnType<typeof applyTracked>;
}

/**
 * Read the export and its timers, fold whatever has finished, and return the
 * village as it stands now. Null when there is no export to track against.
 */
async function settle(owned: Owned, now: Date): Promise<Settled | { error: string }> {
  const { supabase, base } = owned;
  const [exports, tracked, readings] = await Promise.all([
    villageExportsFor(supabase, [base.playerId]),
    trackedUpgradesFor(supabase, [base.playerId]),
    // Phase E. Losing it only costs the early finish, never the write.
    latestReadings(supabase, [base.playerId]).catch(() => new Map()),
  ]);
  const saved = exports.get(base.playerId);
  if (!saved) return { error: "Upload your village export first — the tracker counts from it." };
  const reading = readings.get(base.playerId) ?? null;

  let overlay = applyTracked(saved.village, tracked.get(base.playerId) ?? [], now, reading);
  if (overlay.changed) {
    const folded = await foldTracked(supabase, base.playerId, saved.revision, overlay.stored, overlay.foldIds);
    if (folded.error) return { error: safeMessage("tracker fold", folded.error, "Could not update your base.") };
    if (!folded.applied) {
      return { error: "Your base changed in another tab. The page has been refreshed — try again." };
    }
    // The fold moved the revision, so the next write in this request needs the new one.
    const fresh = (await villageExportsFor(supabase, [base.playerId])).get(base.playerId);
    if (!fresh) return { error: "Upload your village export first — the tracker counts from it." };
    const live = (await trackedUpgradesFor(supabase, [base.playerId])).get(base.playerId) ?? [];
    overlay = applyTracked(fresh.village, live, now, reading);
    return { saved: fresh, overlay };
  }
  return { saved, overlay };
}

function findItem(settled: Settled, ref: UpgradeRef, now: Date): RemainingItem | undefined {
  return remainingUpgrades(settled.overlay.village, ref.village, now).find(
    (i) => i.subjectType === ref.subjectType && i.name === ref.name && i.fromLevel === ref.fromLevel,
  );
}

async function begin(rawTag: string): Promise<Owned | { ok: false; error: string }> {
  const owned = await ownBase(rawTag);
  if (!owned.ok) return owned;
  const limited = await withinWriteLimit("tracker", owned.userId);
  return limited ? { ok: false, error: limited } : owned;
}

/**
 * "I started this in the game." `secondsLeft` is for an upgrade started before
 * the member opened the page: the time the game shows, which wins over ours.
 */
export async function startUpgrade(
  rawTag: string,
  ref: UpgradeRef,
  options: { boostPct: number; secondsLeft: number | null },
): Promise<TrackerActionState> {
  if (!validRef(ref)) return { error: "That upgrade could not be found." };
  const boostPct = (BOOSTS as readonly number[]).includes(options?.boostPct) ? options.boostPct : 0;
  const typed = options?.secondsLeft;
  if (typed !== null && typed !== undefined && (!Number.isInteger(typed) || typed < 0 || typed > MAX_SECONDS)) {
    return { error: "Enter a time left of up to 45 days." };
  }

  const owned = await begin(rawTag);
  if (!owned.ok) return { error: owned.error };
  const now = new Date();
  const settled = await settle(owned, now);
  if ("error" in settled) return settled;

  const item = findItem(settled, ref, now);
  if (!item || !item.workshop) return { error: "That upgrade is not available any more. Refresh the page." };
  if (item.locked) return { error: `Unlock ${item.name} in the game first.` };
  if (item.blocked) return { error: `${item.blocked} first.` };
  if (item.idle < 1) return { error: `Every ${item.name} at level ${item.fromLevel} is already upgrading.` };

  const slot = workshops(settled.overlay.village, ref.village, now).find((w) => w.key === item.workshop);
  if (slot && slot.busy >= slot.total) {
    return {
      error:
        slot.key === "builders"
          ? `All ${slot.total} builders are busy. Finish or cancel one first.`
          : `The ${slot.label} is busy. Finish or cancel its upgrade first.`,
    };
  }

  const step = item.steps[0];
  const full = step ? (boostApplies(item.workshop) ? boosted(step.seconds, boostPct) : step.seconds) : null;
  const seconds = typed ?? full;
  if (seconds === null) {
    return { error: "This upgrade has no time on record yet. Enter the time left the game shows." };
  }

  const { error } = await insertTracked(owned.supabase, owned.base.playerId, owned.userId, {
    village: ref.village,
    subjectType: ref.subjectType,
    subject: ref.name,
    fromLevel: ref.fromLevel,
    workshop: item.workshop,
    boostPct: boostApplies(item.workshop) ? boostPct : 0,
    startedAt: now,
    endsAt: new Date(now.getTime() + seconds * 1000),
  });
  if (error) return { error: safeMessage("tracker start", error, "Could not start that timer.") };

  refresh(owned.base);
  return {};
}

/** A book, a hammer or gems finished it early. */
export async function finishUpgradeNow(rawTag: string, id: string): Promise<TrackerActionState> {
  if (typeof id !== "string" || !UUID.test(id)) return { error: "That timer could not be found." };
  const owned = await begin(rawTag);
  if (!owned.ok) return { error: owned.error };

  const now = new Date();
  const { error } = await finishTracked(owned.supabase, owned.base.playerId, id, now);
  if (error) return { error: safeMessage("tracker finish", error, "Could not finish that timer.") };

  const settled = await settle(owned, now);
  refresh(owned.base);
  return "error" in settled ? settled : {};
}

/** Started by mistake, or cancelled in the game. */
export async function cancelUpgrade(rawTag: string, id: string): Promise<TrackerActionState> {
  if (typeof id !== "string" || !UUID.test(id)) return { error: "That timer could not be found." };
  const owned = await begin(rawTag);
  if (!owned.ok) return { error: owned.error };

  const { error } = await cancelTracked(owned.supabase, owned.base.playerId, id);
  if (error) return { error: safeMessage("tracker cancel", error, "Could not cancel that timer.") };

  refresh(owned.base);
  return {};
}

/**
 * Level `count` instances up now, with no timer: walls and equipment (instant
 * in the game), or anything upgraded without a timer here.
 */
export async function markAlreadyUpgraded(
  rawTag: string,
  ref: UpgradeRef,
  count: number,
): Promise<TrackerActionState> {
  if (!validRef(ref)) return { error: "That upgrade could not be found." };
  if (!Number.isInteger(count) || count < 1 || count > 500) return { error: "Choose how many were upgraded." };

  const owned = await begin(rawTag);
  if (!owned.ok) return { error: owned.error };
  const now = new Date();
  const settled = await settle(owned, now);
  if ("error" in settled) return settled;

  const item = findItem(settled, ref, now);
  if (!item || item.locked) return { error: "That upgrade is not available any more. Refresh the page." };
  if (item.blocked) return { error: `${item.blocked} first.` };
  if (count > item.idle) return { error: `Only ${item.idle} can be upgraded from level ${item.fromLevel}.` };
  // A merge is limited by its sources at the merge level, not by how many are missing.
  if (item.ready !== undefined && count > item.ready) {
    return { error: `Only ${item.ready} can be merged with what is at the merge level now.` };
  }

  // The STORED village, so no running timer is written into the export.
  const next = markUpgraded(settled.overlay.stored, { ...ref, subject: ref.name }, count);
  if (!next) return { error: "That upgrade is not available any more. Refresh the page." };

  const folded = await foldTracked(owned.supabase, owned.base.playerId, settled.saved.revision, next, []);
  if (folded.error) return { error: safeMessage("tracker mark", folded.error, "Could not save that.") };
  if (!folded.applied) return { error: "Your base changed in another tab. Refresh and try again." };

  refresh(owned.base);
  return {};
}
