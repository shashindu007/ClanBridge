// T11B.5 — base progress. Daily, from .github/workflows/sync-players.yml.
//
// R1/R2 — the only place hero, troop and spell levels are read from Supercell,
// and it runs on GitHub Actions, never in a page.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHO IS SYNCED: CLAN MEMBERS, AND EVERY OWNED VILLAGE
//
// Two sets, unioned by player id:
//
//   1. Current members of every active clan — clan-games.ts's membersOf(),
//      filtered by clan (R3). This is what a leader's "Base details" reads.
//
//   2. Every village a member has linked to their account, WHEREVER it now is.
//      A member's alt in another clan, or a main that left all three, still
//      belongs to them, and /account/bases/[tag]/details is theirs to open. 036's
//      owner policy is what lets them read those rows; this is what writes them.
//
// A village in set 2 but not set 1 is stored with clan_id = null when it has
// left the platform, so a clan it USED to be in does not keep receiving its new
// readings through 036's clan policy. Its owner still sees them.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE CAP IS APPLIED HERE AND STORED
//
// resolveUnit() attaches the Town Hall cap from src/data/game/ at capture time.
// 036's header explains why it is stored rather than recomputed on read: caps
// rise every game update, and a recomputed history would silently re-score
// itself.
//
// COST: one API call per village per run. No bulk player endpoint exists. About
// 150 members across three clans plus a handful of owned alts, at the client's
// 200 ms throttle, is well under a minute a day.
//
// R5 — ON CONFLICT DO NOTHING against unique (player_id, captured_day). A second
// run on the same UTC day writes nothing, and 036 withholds UPDATE from the sync
// role so that is enforced rather than hoped for.
//
// R11 — writes player_progress only, a game fact.

import type { SupabaseClient } from "@supabase/supabase-js";
import { playerEndpoint, request } from "@/integration/coc-client";
import { playerSchema } from "@/integration/coc-schemas";
import { CocNotFoundError } from "@/integration/errors";
import { mapPlayerProgress } from "@/integration/mappers";
import { lockedUnits, resolveUnit, type ResolvedUnit, type UnitSource } from "@/data/game";
import type { PlayerProgress, ProgressUnit } from "@/types/domain";
import { activeClans, main, skip, type JobContext } from "./shared";

/** One village to read, and the clan its reading is filed under. */
export interface ProgressTarget {
  id: string;
  tag: string;
  clanId: string | null;
}

interface PlayerRow {
  id: string;
  tag: string;
  clan_id: string | null;
  left_at: string | null;
}

/** Rows per upsert. Keeps a single statement well under PostgREST's body limit. */
const BATCH = 50;

/**
 * Everyone to read, deduplicated.
 *
 * Clan members first, so a village that is both a member and owned keeps its
 * clan. The owned read is NOT clan-filtered — the subject is "villages somebody
 * linked", which is not a clan-shaped question; account-bases.ts is the
 * precedent and says so at length. This job runs as the service role, so the
 * restriction is the explicit `user_id is not null`, and nothing it reads is
 * shown to anybody without passing 036's policies.
 */
export async function progressTargets(supabase: SupabaseClient): Promise<ProgressTarget[]> {
  const clans = await activeClans(supabase);
  const targets = new Map<string, ProgressTarget>();

  for (const clan of clans) {
    const { data, error } = await supabase
      .from("players")
      .select("id, tag, clan_id, left_at")
      .eq("clan_id", clan.id) // R3
      .is("deleted_at", null)
      .is("left_at", null);

    if (error) throw new Error(`players read failed for ${clan.tag}: ${error.message}`);
    for (const row of (data ?? []) as PlayerRow[]) {
      targets.set(row.id, { id: row.id, tag: row.tag, clanId: clan.id });
    }
  }

  const { data: owned, error: ownedError } = await supabase
    .from("players")
    .select("id, tag, clan_id, left_at")
    .not("user_id", "is", null)
    .is("deleted_at", null);

  if (ownedError) throw new Error(`owned players read failed: ${ownedError.message}`);
  for (const row of (owned ?? []) as PlayerRow[]) {
    if (targets.has(row.id)) continue;
    targets.set(row.id, {
      id: row.id,
      tag: row.tag,
      // Left every platform clan: file it under no clan. See the header.
      clanId: row.left_at ? null : row.clan_id,
    });
  }

  return [...targets.values()];
}

/**
 * The stored shape of one reading. Pure — the test exercises it directly.
 *
 * Each unit is resolved against the hall it belongs to: the Town Hall for home
 * units, the Builder Hall for builder units.
 */
export function progressRow(target: ProgressTarget, progress: PlayerProgress) {
  const resolve = (source: UnitSource) => (unit: ProgressUnit): ResolvedUnit =>
    resolveUnit(unit, source, unit.village === "home" ? progress.thLevel : progress.bhLevel);

  const present: ResolvedUnit[] = [
    ...progress.heroes.map(resolve("heroes")),
    ...progress.equipment.map(resolve("equipment")),
    ...progress.troops.map(resolve("troops")),
    ...progress.spells.map(resolve("spells")),
  ];

  // What this hall allows but the API omitted because it is not unlocked yet.
  // Stored as level 0 at capture, with the cap of the day, like everything else.
  const units = [
    ...present,
    ...lockedUnits(present, progress.thLevel, progress.bhLevel),
  ];

  return {
    player_id: target.id,
    clan_id: target.clanId,
    th_level: progress.thLevel ?? null,
    th_weapon_level: progress.thWeaponLevel ?? null,
    bh_level: progress.bhLevel ?? null,
    units,
  };
}

export async function syncPlayers(ctx: JobContext): Promise<void> {
  const { supabase } = ctx;

  const targets = await progressTargets(supabase);
  if (!targets.length) {
    skip("noPlayers", "no clan members or owned villages held — has sync:clans run?");
  }

  const rows: Array<ReturnType<typeof progressRow>> = [];
  let missing = 0;

  for (const target of targets) {
    try {
      const api = await request(playerEndpoint(target.tag), playerSchema);
      rows.push(progressRow(target, mapPlayerProgress(api)));
    } catch (error) {
      // A village the API no longer knows — a banned or deleted account — must
      // not cost everybody else their reading. clan-games.ts does the same.
      if (error instanceof CocNotFoundError) {
        missing++;
        console.warn(`  ${target.tag} not found, skipped`);
        continue;
      }
      throw error;
    }
  }

  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from("player_progress")
      .upsert(rows.slice(i, i + BATCH), {
        onConflict: "player_id,captured_day",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`player_progress insert failed: ${error.message}`);
  }

  ctx.recorded(rows.length);
  console.log(
    `  ${rows.length} of ${targets.length} village(s) read` +
      (missing ? `, ${missing} not found` : "") +
      " — a second run today writes nothing (R5)",
  );
}

// Matched on the file name rather than a substring of the whole path, so a
// checkout in a directory that happens to contain "players" cannot fire it.
if (/[\\/]players\.ts$/.test(process.argv[1] ?? "")) {
  void main("players", (ctx) => syncPlayers(ctx));
}
