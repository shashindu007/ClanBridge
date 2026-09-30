// T2.6 — Clan and member sync. Hourly.
//
// The simplest of the sync jobs, and therefore the one that proves the whole
// pipeline: API client -> schema -> mapper -> database, with sync_log around it.
//
// Also covers:
//   T2.9  one member_snapshots row per player per run. Donations and trophies
//         are cumulative totals Supercell resets monthly, so a single reading
//         means nothing — differencing snapshots is the only way to get
//         per-season figures (T3B.3) or detect inactivity (T3B.5).
//   T3.9  membership movement. Players move between the three clans and some
//         leave entirely; neither may lose history.
//
// R11 — this job writes GAME FACTS only: clans, players, member_snapshots.
// It must never touch clan_roles (that is a user's app role, not the in-game
// one), nor any human-decision table.
//
// Done when: running it twice produces no duplicate rows (R5).

import type { SupabaseClient } from "@supabase/supabase-js";
import { clanEndpoint } from "@/integration/coc-client";
import { request } from "@/integration/coc-client";
import { clanSchema } from "@/integration/coc-schemas";
import { mapClan, mapClanMembers, mapSnapshot } from "@/integration/mappers";
import type { Player } from "@/types/domain";
import { activeClans, main, type JobContext } from "./shared";

interface ClanRow {
  id: string;
  tag: string;
  name: string;
}

/**
 * Upsert the clan's own row.
 *
 * Only fields the API owns. The clan's `tag` is the join key — set when a leader
 * added the clan at /admin (migration 015) — so it is matched on, never written.
 *
 * T3B.0 — the last four columns feed the dashboard. mapClan() has returned all
 * of them since T2.4; until migration 020 there was nowhere to put them, so an
 * hourly fetch was being discarded. `?? null` rather than omitting the key:
 * a field the API stops sending should clear the stored value, not silently
 * leave last month's number on the page.
 */
async function syncClanRecord(
  supabase: SupabaseClient,
  clan: ClanRow,
  api: ReturnType<typeof mapClan>,
): Promise<void> {
  const { error } = await supabase
    .from("clans")
    .update({
      name: api.name,
      badge_url: api.badgeUrl,
      level: api.level ?? null,
      war_league: api.warLeague ?? null,
      member_count: api.memberCount ?? null,
      is_war_log_public: api.isWarLogPublic ?? null,
    })
    .eq("id", clan.id);

  if (error) throw new Error(`clans update failed for ${clan.tag}: ${error.message}`);
}

/**
 * Upsert every current member.
 *
 * `players.tag` is unique, which makes this idempotent (R5): a second run in the
 * same hour finds the same rows and changes nothing meaningful.
 *
 * R3 — clan_id is written explicitly on every row. It is the column every later
 * query filters by, and the one generated code forgets.
 */
async function syncMembers(
  supabase: SupabaseClient,
  clan: ClanRow,
  members: Player[],
): Promise<number> {
  if (!members.length) return 0;

  const rows = members.map((m) => ({
    clan_id: clan.id,
    tag: m.tag,
    name: m.name,
    th_level: m.thLevel ?? null,
    clan_role: m.role ?? null,
    // A returning member is un-departed here rather than re-created, so their
    // whole history reattaches to the same row (T3.9).
    left_at: null,
  }));

  const { error } = await supabase
    .from("players")
    .upsert(rows, { onConflict: "tag", ignoreDuplicates: false });

  if (error) throw new Error(`players upsert failed for ${clan.tag}: ${error.message}`);
  return rows.length;
}

/**
 * T2.9 — one snapshot row per player per run.
 *
 * `on conflict do nothing` against (player_id, captured_slot) — migration 054's
 * 30-minute slot, which replaced 007's hour when this job went half-hourly.
 * Re-running within the slot is free, which is what reconciles "one row per
 * run" with R5's "a re-run changes nothing".
 */
async function writeSnapshots(
  supabase: SupabaseClient,
  clan: ClanRow,
  members: Player[],
  playerIds: Map<string, string>,
): Promise<number> {
  const rows = members
    .map((m) => {
      const playerId = playerIds.get(m.tag);
      if (!playerId) return null;
      const snapshot = mapSnapshot({
        tag: m.tag,
        name: m.name,
        role: undefined,
        townHallLevel: m.thLevel,
        trophies: m.trophies,
        donations: m.donations,
        donationsReceived: m.donationsReceived,
      });
      return {
        clan_id: clan.id,
        player_id: playerId,
        donations: snapshot.donations ?? null,
        donations_received: snapshot.donationsReceived ?? null,
        trophies: snapshot.trophies ?? null,
        th_level: snapshot.thLevel ?? null,
        role: m.role ?? null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (!rows.length) return 0;

  const { error } = await supabase
    .from("member_snapshots")
    .upsert(rows, { onConflict: "player_id,captured_slot", ignoreDuplicates: true });

  if (error) throw new Error(`member_snapshots failed for ${clan.tag}: ${error.message}`);
  return rows.length;
}

/**
 * T3.9 — mark players who are in none of the three clans as departed.
 *
 * Deliberately runs ONCE, after every clan has been fetched. Running it per clan
 * would mark a player who moved from clan A to clan B as having left, purely
 * because clan A was processed first — the single most likely bug in this file.
 *
 * R4 — nothing is deleted. left_at is set, the row and every attack, snapshot
 * and bonus survive, and access is revoked by the flag.
 */
async function markDepartures(
  supabase: SupabaseClient,
  clanIds: string[],
  presentTags: Set<string>,
): Promise<number> {
  const { data: existing, error } = await supabase
    .from("players")
    .select("id, tag")
    .in("clan_id", clanIds)
    .is("deleted_at", null)
    .is("left_at", null);

  if (error) throw new Error(`could not read players for departures: ${error.message}`);

  const gone = (existing ?? []).filter((p) => !presentTags.has(p.tag as string));
  if (!gone.length) return 0;

  const { error: updateError } = await supabase
    .from("players")
    .update({ left_at: new Date().toISOString() })
    .in(
      "id",
      gone.map((p) => p.id),
    );

  if (updateError) throw new Error(`could not mark departures: ${updateError.message}`);
  return gone.length;
}

export async function syncClans(ctx: JobContext): Promise<void> {
  const { supabase } = ctx;
  const clans = await activeClans(supabase);

  // Every tag seen across ALL three clans this run. Departure detection needs
  // the complete picture, so it cannot happen inside the per-clan loop.
  const presentTags = new Set<string>();
  const problems: string[] = [];

  for (const clan of clans) {
    // One clan's bad hour must not cost the others theirs: a 5xx or a timeout
    // used to throw out of this loop and every clan later in tag order got
    // nothing that run. Recorded and thrown at the end instead.
    try {
      const api = await request(clanEndpoint(clan.tag), clanSchema);
      const mapped = mapClan(api);
      const members = mapClanMembers(api);

      await syncClanRecord(supabase, clan, mapped);
      const written = await syncMembers(supabase, clan, members);
      ctx.recorded(written);

      for (const m of members) presentTags.add(m.tag);

      // Read back the ids the upsert produced or matched. Needed because
      // member_snapshots references player_id, not tag.
      const { data: rows, error } = await supabase
        .from("players")
        .select("id, tag")
        .eq("clan_id", clan.id)
        .is("deleted_at", null);

      if (error) throw new Error(`could not read players for ${clan.tag}: ${error.message}`);

      const playerIds = new Map<string, string>(
        (rows ?? []).map((r) => [r.tag as string, r.id as string]),
      );

      ctx.recorded(await writeSnapshots(supabase, clan, members, playerIds));

      console.log(`  ${clan.tag} ${clan.name}: ${members.length} members`);

      // T0.1, checked automatically rather than trusted once.
      //
      // The spec treats "war log is public" as a manual in-game check, but the API
      // reports it, so a clan switched to private mid-season is caught on the next
      // hourly run instead of surfacing later as an unexplained 403 in the war
      // module. Warned rather than failed: the clan sync itself works fine, and
      // failing here would stop members and snapshots being recorded too.
      if (mapped.isWarLogPublic === false) {
        console.warn(
          `  WARNING  ${clan.tag} ${clan.name} has a PRIVATE war log. ` +
            `No war or CWL data can be collected for this clan until it is set to ` +
            `Public in game (Clan Settings -> War Log). See T0.1.`,
        );
      }
    } catch (error) {
      problems.push(`${clan.tag}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Departures need the COMPLETE picture. With one clan's member list missing,
  // everyone in it would look as if they had left all three clans. Skipped this
  // run and done by the next one that reads every clan.
  if (problems.length) throw new Error(problems.join("; "));

  const departed = await markDepartures(
    supabase,
    clans.map((c) => c.id),
    presentTags,
  );
  if (departed) {
    ctx.recorded(departed);
    console.log(`  ${departed} player(s) no longer in any of the three clans`);
  }
}

// Run only when executed directly, so the test suite can import syncClans
// without the job firing on import.
if (process.argv[1]?.includes("clans")) {
  void main("clans", syncClans);
}
