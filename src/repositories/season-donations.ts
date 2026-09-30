// 052 — the reads behind season donations. services/season-donations.ts does
// the arithmetic; this only fetches.
//
// R3 — both reads take the clan list from visibleClans() and filter by it
// explicitly. RLS on member_snapshots and donation_counters is the net.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CounterReading, DonationSegment } from "@/services/season-donations";

/**
 * How far back stays are read: the running season, the complete one before it,
 * and the stay that straddles that one's start. Stays are a few hundred rows
 * however far back this reaches, so it is cheap; it is the reset detection that
 * needs the length.
 */
export const SEGMENT_WINDOW_DAYS = 75;

/**
 * PostgREST's default row cap. Paged by offset, not by captured_at: every row
 * one sync run writes shares one now(), so "older than the last row seen" would
 * skip the rest of that run at a page edge.
 */
const PAGE = 1000;
/** A ceiling so a runaway loop is impossible; ~10 pages covers a season of the family. */
const MAX_PAGES = 20;

export async function donationSegments(
  supabase: SupabaseClient,
  clanIds: readonly string[],
  since: Date,
): Promise<DonationSegment[]> {
  if (!clanIds.length) return [];
  const out: DonationSegment[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await supabase
      .rpc("donation_segments", { p_clan_ids: [...clanIds], p_since: since.toISOString() })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error || !data) break;

    const rows = data as Array<Record<string, unknown>>;
    for (const r of rows) {
      out.push({
        playerId: r.player_id as string,
        clanId: r.clan_id as string,
        startedAt: r.started_at as string,
        endedAt: r.ended_at as string,
        startReason: r.start_reason as DonationSegment["startReason"],
        given: r.given as number,
        received: r.received as number,
      });
    }
    if (rows.length < PAGE) break;
  }

  return out;
}

/** The daily donation readings taken while in these clans, between two instants. */
export async function donationReadings(
  supabase: SupabaseClient,
  clanIds: readonly string[],
  from: Date,
  to: Date,
): Promise<CounterReading[]> {
  const perClan = await Promise.all(
    clanIds.map(async (clanId) => {
      const out: CounterReading[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { data, error } = await supabase
          .from("donation_counters")
          .select("player_id, clan_id, captured_at, troops_donated, spells_donated, sieges_donated, clan_donations")
          .eq("clan_id", clanId) // R3
          .is("deleted_at", null)
          .gte("captured_at", from.toISOString())
          .lt("captured_at", to.toISOString())
          .order("captured_at", { ascending: false })
          .order("id")
          .range(page * PAGE, page * PAGE + PAGE - 1);
        if (error || !data) break;

        const rows = data as Array<Record<string, unknown>>;
        for (const r of rows) {
          out.push({
            playerId: r.player_id as string,
            clanId: r.clan_id as string,
            capturedAt: r.captured_at as string,
            troops: (r.troops_donated as number | null) ?? null,
            spells: (r.spells_donated as number | null) ?? null,
            sieges: (r.sieges_donated as number | null) ?? null,
            clanDonations: (r.clan_donations as number | null) ?? null,
          });
        }
        if (rows.length < PAGE) break;
      }
      return out;
    }),
  );

  return perClan.flat();
}
