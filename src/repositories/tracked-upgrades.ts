// Upgrade timers a member started on Base details (079).
//
// Same shape of argument as village-exports.ts: owner-only, filtered by the
// player ids the page has already gated on basesForUser(), with 079's policies
// as the net. Written only here, by the owner (R11) — the sync's one write is
// notified_at, and it lives in scripts/sync/upgrade-reminders.ts.

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRead } from "@/lib/errors";
import type { WriteResult } from "@/repositories/account-bases";
import type { SubjectType, TrackedUpgrade } from "@/services/village-overlay";
import type { Workshop } from "@/services/village";
import type { Village } from "@/types/domain";
import type { ExportedVillage } from "@/types/village";

const COLUMNS = "id, player_id, village, subject_type, subject, from_level, workshop, boost_pct, started_at, ends_at";

const VILLAGES = new Set<Village>(["home", "builder"]);
const TYPES = new Set<SubjectType>(["building", "unit", "weapon"]);
const WORKSHOPS = new Set<Workshop>(["builders", "lab", "pets"]);

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();

/** Guarded rather than trusted, so one odd row is skipped instead of breaking the page. */
function toTracked(row: Record<string, unknown>): TrackedUpgrade | null {
  const village = row.village as Village;
  const subjectType = row.subject_type as SubjectType;
  const workshop = row.workshop as Workshop;
  if (!VILLAGES.has(village) || !TYPES.has(subjectType) || !WORKSHOPS.has(workshop)) return null;
  if (typeof row.subject !== "string" || typeof row.id !== "string") return null;
  return {
    id: row.id,
    village,
    subjectType,
    subject: row.subject,
    fromLevel: Number(row.from_level),
    workshop,
    boostPct: Number(row.boost_pct ?? 0),
    startedAt: iso(row.started_at),
    endsAt: iso(row.ends_at),
  };
}

/** Each base's live (not cancelled, not folded) tracked upgrades, in one read. */
export async function trackedUpgradesFor(
  supabase: SupabaseClient,
  playerIds: readonly string[],
): Promise<Map<string, TrackedUpgrade[]>> {
  const out = new Map<string, TrackedUpgrade[]>();
  const ids = [...new Set(playerIds)];
  if (!ids.length) return out;

  const { data, error } = await supabase
    .from("tracked_upgrades")
    .select(COLUMNS)
    .in("player_id", ids) // the mechanism; 079's owner policy is the net
    .is("deleted_at", null)
    .is("folded_at", null);

  assertRead(error, "tracked_upgrades");

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const t = toTracked(row);
    if (!t) continue;
    const list = out.get(row.player_id as string) ?? [];
    list.push(t);
    out.set(row.player_id as string, list);
  }
  return out;
}

export interface NewTracked {
  village: Village;
  subjectType: SubjectType;
  subject: string;
  fromLevel: number;
  workshop: Workshop;
  boostPct: number;
  startedAt: Date;
  endsAt: Date;
}

export async function insertTracked(
  supabase: SupabaseClient,
  playerId: string,
  userId: string,
  t: NewTracked,
): Promise<WriteResult> {
  const { error } = await supabase.from("tracked_upgrades").insert({
    player_id: playerId,
    created_by: userId,
    village: t.village,
    subject_type: t.subjectType,
    subject: t.subject,
    from_level: t.fromLevel,
    workshop: t.workshop,
    boost_pct: t.boostPct,
    started_at: t.startedAt.toISOString(),
    ends_at: t.endsAt.toISOString(),
  });
  return { error };
}

/**
 * "Finished early" — a book, a hammer, gems. Ends it now and marks it as
 * announced, since the member is the one telling us.
 */
export async function finishTracked(
  supabase: SupabaseClient,
  playerId: string,
  id: string,
  now: Date,
): Promise<WriteResult> {
  const at = now.toISOString();
  const { error } = await supabase
    .from("tracked_upgrades")
    .update({ ends_at: at, notified_at: at })
    .eq("id", id)
    .eq("player_id", playerId)
    .is("deleted_at", null)
    .is("folded_at", null);
  return { error };
}

/** Cancel one timer. A soft delete (R4); the prune removes it a month later. */
export async function cancelTracked(supabase: SupabaseClient, playerId: string, id: string): Promise<WriteResult> {
  const { error } = await supabase
    .from("tracked_upgrades")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("player_id", playerId)
    .is("deleted_at", null)
    .is("folded_at", null);
  return { error };
}

/**
 * A fresh export is the truth as of its own timestamp, so every live timer
 * started before it is retired: the export either shows it running or shows it
 * done. `before` null retires all of them (the export was removed).
 */
export async function resetTracked(
  supabase: SupabaseClient,
  playerId: string,
  before: Date | null,
): Promise<WriteResult> {
  let q = supabase
    .from("tracked_upgrades")
    .update({ deleted_at: new Date().toISOString() })
    .eq("player_id", playerId)
    .is("deleted_at", null)
    .is("folded_at", null);
  if (before) q = q.lt("started_at", before.toISOString());
  const { error } = await q;
  return { error };
}

/**
 * Write the levelled-up village and retire the rows it absorbed, in one
 * transaction (079's apply_tracked_upgrades). False when the export moved under
 * us — another tab folded first — which is not an error: the page re-reads.
 */
export async function foldTracked(
  supabase: SupabaseClient,
  playerId: string,
  revision: number,
  village: ExportedVillage,
  ids: readonly string[],
): Promise<{ applied: boolean; error: WriteResult["error"] }> {
  const { data, error } = await supabase.rpc("apply_tracked_upgrades", {
    p_player: playerId,
    p_revision: revision,
    p_village: village,
    p_ids: [...ids],
  });
  return { applied: data === true, error };
}
