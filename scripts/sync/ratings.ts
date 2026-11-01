// T13.10 — the Player rating. A step of sync-clans.yml, doing real work every 6
// hours.
//
// No game API: it reads what the other jobs stored and writes one derived table.
// The sums are src/services/player-rating.ts, the reads src/lib/player-rating-data.ts.
//
// EVERY 6 HOURS, GATED HERE RATHER THAN BY A CRON. A run reads every clan's month,
// which is far too much for each half-hourly tick on Supabase's free tier, and a
// workflow of its own would pay for another checkout on a private repository's
// Actions minutes. As a step it rides along, and most ticks end at the check
// below, recorded as a skip (R10) the way cwl-scout's "scoutFresh" is.
//
// WHICH MONTHS. The running one, and last month until the 10th: its last raid
// weekend finishes in this month, and Clan Games settle at the turn of it. After
// that a month is left alone, so a player's number for it stays put. Any month the
// donation readings still cover that has no ranking yet is filled in, which is
// what backfills a new install.
//
// R5 — one upsert per month, so a page sees all of a month's new numbers or none.
//
// R11 — writes player_ratings only. Derived from game facts, and no person edits it.

import { monthOf, openMonths } from "@/lib/rating";
import { SEGMENT_WINDOW_DAYS } from "@/repositories/season-donations";
import { ratingMonths } from "@/repositories/player-ratings";
import {
  familyMonthRatings,
  loadFamily,
  ratedSeason,
} from "@/lib/player-rating-data";
import { activeClans, main, skip, type JobContext } from "./shared";

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** A successful run within this leaves nothing to do. */
export const RATINGS_EVERY_MS = 6 * HOUR;

/**
 * Oldest first, so a backfill that fails partway leaves the older months done.
 * `force` takes every month the readings still cover, ranked or not.
 */
export function monthsToRate(stored: readonly string[], now: Date, force = false): string[] {
  const current = monthOf(now);
  const open = new Set(openMonths(now));

  const earliest = new Date(now.getTime() - SEGMENT_WINDOW_DAYS * DAY);
  let walk = new Date(Date.UTC(earliest.getUTCFullYear(), earliest.getUTCMonth(), 1));
  while (monthOf(walk) < current) {
    if (force || !stored.includes(monthOf(walk))) open.add(monthOf(walk));
    walk = new Date(Date.UTC(walk.getUTCFullYear(), walk.getUTCMonth() + 1, 1));
  }

  return [...open].sort();
}

async function ranRecently({ supabase }: JobContext, now: Date): Promise<boolean> {
  const { data, error } = await supabase
    .from("sync_log")
    .select("started_at")
    .eq("job_type", "ratings")
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) throw new Error(`Could not read sync_log: ${error.message}`);
  const last = (data as Array<{ started_at: string }> | null)?.[0];
  return last !== undefined && now.getTime() - Date.parse(last.started_at) < RATINGS_EVERY_MS;
}

export async function syncRatings(
  ctx: JobContext,
  now = new Date(),
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  if (!force && (await ranRecently(ctx, now))) {
    skip("ratingsFresh", `a run finished within ${RATINGS_EVERY_MS / HOUR} hours`);
  }

  const { supabase } = ctx;
  const clans = await activeClans(supabase);
  const family = await loadFamily(supabase, clans, now);
  const computedAt = now.toISOString();

  for (const month of monthsToRate(await ratingMonths(supabase), now, force)) {
    const season = ratedSeason(family, month, now);
    if (!season) {
      console.log(`[ratings] ${month}: no complete donation season, left alone`);
      continue;
    }

    const ratings = await familyMonthRatings(supabase, family, month, season, now);
    if (!ratings) {
      console.log(`[ratings] ${month}: nobody has marks yet`);
      continue;
    }

    const rows = ratings.map((r) => ({
      month,
      player_id: r.playerId,
      clan_id: family.clanOf.get(r.playerId)!,
      donation_marks: r.marks.donations,
      war_marks: r.marks.war,
      cwl_marks: r.marks.cwl,
      games_marks: r.marks.games,
      raid_marks: r.marks.raids,
      donation_share: r.shares.donations,
      war_share: r.shares.war,
      cwl_share: r.shares.cwl,
      games_share: r.shares.games,
      raid_share: r.shares.raids,
      rating: r.rating,
      computed_at: computedAt,
    }));

    const { error } = await supabase
      .from("player_ratings")
      .upsert(rows, { onConflict: "month,player_id" });
    if (error) throw new Error(`Could not write ${month}'s ratings: ${error.message}`);

    ctx.recorded(rows.length);
    console.log(`[ratings] ${month}: ${rows.length} players`);
  }
}

// Matched on the file name rather than a substring of the whole path, so a
// checkout in a directory that happens to contain "ratings" cannot fire it.
if (/[\\/]ratings\.ts$/.test(process.argv[1] ?? "")) {
  // --force: the first fill, or after a rule changes. Skips the 6-hour check and
  // reworks every month the readings still cover.
  const force = process.argv.includes("--force");
  void main("ratings", (ctx) => syncRatings(ctx, new Date(), { force }));
}
