// The reads behind Player rating and Season donations, in one place.
//
// Both pages rank or list the same members over the same season, so they load
// through here and cannot disagree about who is in it or what they gave.
//
// R3 — every read is per clan, over the list visibleClans() returned. RLS on
// member_snapshots is auth_clan_ids(), so a member sees their own clans' members
// and no others; nothing here widens that.
//
// OPEN TO EVERY MEMBER (canSeeMemberStats), the tier that already shows a member
// donations and ratios in their own clan's directory.

import type { SupabaseClient } from "@supabase/supabase-js";
import { visibleClans, type VisibleClan } from "@/lib/clans";
import { formatDisplay } from "@/lib/display-time";
import { canSeeMemberStats } from "@/lib/visibility";
import { lastActivity, latestSnapshots, membersForClan } from "@/repositories/members";
import {
  SEGMENT_WINDOW_DAYS,
  donationReadings,
  donationSegments,
} from "@/repositories/season-donations";
import { participation, type ClanInput, type ParticipationRow } from "@/services/cross-clan";
import {
  seasonDonations,
  seasonKey,
  seasonResets,
  seasonsFrom,
  type Season,
  type SeasonDonationReport,
} from "@/services/season-donations";

const DAY = 86_400_000;

/** A season as a person reads it. */
export function seasonLabel(season: Season): string {
  // Before the first reset we saw: our readings began partway through it.
  if (season.start === null && season.end !== null) {
    return `Before ${formatDisplay(season.end, "date")} (partial)`;
  }
  if (season.start === null) return "So far";
  if (season.end === null) return `Current season (since ${formatDisplay(season.start, "date")})`;
  return `${formatDisplay(season.start, "date")} – ${formatDisplay(season.end, "date")}`;
}

export interface RatingData {
  clans: VisibleClan[];
  /** Every current member of those clans, with activity and attention flags. */
  rows: ParticipationRow[];
  seasons: Season[];
  season: Season;
  donations: SeasonDonationReport;
}

/**
 * Everything both pages need, or null when the account is in no clan.
 *
 * `seasonParam` is the ?season= key; unknown or absent means the running
 * season, never an error.
 */
export async function loadRatingData(
  supabase: SupabaseClient,
  userId: string,
  seasonParam?: string,
): Promise<RatingData | null> {
  const clans = (await visibleClans(supabase, userId)).filter((c) => canSeeMemberStats(c.role));
  if (clans.length === 0) return null;

  const clanIds = clans.map((c) => c.id);
  const now = Date.now();

  // One set of reads per clan, issued together, with the season stays alongside.
  const [inputs, segments] = await Promise.all([
    Promise.all(
      clans.map(async (clan): Promise<ClanInput> => {
        const members = await membersForClan(supabase, clan.id);
        const [latest, activity] = await Promise.all([
          latestSnapshots(supabase, clan.id, members.length),
          lastActivity(supabase, clan.id),
        ]);
        return {
          clanId: clan.id,
          clanTag: clan.tag,
          clanName: clan.name,
          members,
          latest,
          lastActivity: activity.byPlayer,
        };
      }),
    ),
    donationSegments(supabase, clanIds, new Date(now - SEGMENT_WINDOW_DAYS * DAY)),
  ]);

  // 052 — the season comes from resets found in the data, never a calendar.
  const seasons = seasonsFrom(seasonResets(segments));
  const season = seasons.find((s) => seasonKey(s) === seasonParam) ?? seasons[0]!;

  // The readings a season needs: its own, a few days before (a stay straddling
  // its start), and ten after (last month's missed tail is found through the
  // next stay's first reading).
  const readings = await donationReadings(
    supabase,
    clanIds,
    new Date(season.start ? Date.parse(season.start) - 3 * DAY : now - SEGMENT_WINDOW_DAYS * DAY),
    new Date(season.end ? Date.parse(season.end) + 10 * DAY : now + DAY),
  );

  return {
    clans,
    rows: participation(inputs),
    seasons,
    season,
    donations: seasonDonations(segments, readings, season),
  };
}
