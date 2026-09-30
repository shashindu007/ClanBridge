// T3B.3 — derived member values. No SQL; this takes what repositories/members.ts
// returned and works out what it means.
//
// ─────────────────────────────────────────────────────────────────────────────
// THE ONE THING TO UNDERSTAND BEFORE CHANGING ANYTHING HERE
//
// member_snapshots.donations is CUMULATIVE SINCE THE LAST MONTHLY RESET. It is
// not a delta and not a lifetime total. Supercell zeroes it at season rollover
// and it only ever climbs in between.
//
// Two consequences, and the second one is a trap:
//
//   1. The CURRENT season's donations are simply the newest snapshot's value.
//      No arithmetic. A reading taken now already is this month's total.
//
//   2. A PAST season's total is the LAST value recorded before the reset —
//      NOT the sum of the deltas across that season.
//
// Summing deltas is the obvious implementation and it is wrong. It measures only
// the growth we happened to observe, so it silently undercounts by however much
// the player had already donated before our first snapshot of the month. The
// hourly sync's first reading of a new season lands up to an hour late, and any
// gap in the job — exactly the situation T4.8 exists to catch — widens the error
// without changing anything a reader would notice.
//
// Taking the last value in a segment is both simpler and correct, because the
// counter is already the running total the game keeps for us.
// ─────────────────────────────────────────────────────────────────────────────

import type { SnapshotPoint } from "@/repositories/members";

/**
 * Below this, a member is flagged in the directory.
 *
 * A ratio, not a count: 200 given against 1000 received is a different
 * conversation from 200 against 400. Named here so the page cannot disagree with
 * the service about what "low" means, and so changing it is one edit.
 *
 * Advisory. Nothing in this system acts on it — see needsAttention().
 */
export const LOW_RATIO_THRESHOLD = 0.5;

/**
 * given / received.
 *
 * Null when received is zero or either side is unknown. Zero received is not a
 * perfect ratio, it is an undefined one, and rendering it as Infinity or as some
 * large number would sort that member to the top of a "best donator" list on the
 * strength of having received nothing. The directory shows the raw pair beside
 * this, so a null hides nothing.
 */
export function donationRatio(
  given: number | null,
  received: number | null,
): number | null {
  if (given === null || received === null) return null;
  if (received === 0) return null;
  return given / received;
}

export interface DonationSeason {
  /** When this segment's first snapshot was taken. */
  from: string;
  /** When its last was. */
  to: string;
  /** The season total: the highest cumulative reading seen before the reset. */
  given: number;
  received: number;
  /** False for the newest segment, which is still accumulating. */
  complete: boolean;
}

/**
 * Split a player's snapshots into monthly seasons at each reset.
 *
 * A reset is a DROP in either counter. Neither can decrease while a season runs,
 * so a decrease is unambiguous — there is no threshold to tune and no false
 * positive to worry about.
 *
 * Points with no donation reading are dropped first rather than treated as zero.
 * A null means "the sync did not record this", and a zero would look like a real
 * reading of nothing donated — which would then register as a reset on the next
 * point and split one season into three.
 *
 * Input must be ASCENDING by capturedAt, which is what snapshotHistory returns.
 */
export function donationSeasons(points: SnapshotPoint[]): DonationSeason[] {
  const usable = points.filter((p) => p.donations !== null && p.donationsReceived !== null);
  if (!usable.length) return [];

  const seasons: DonationSeason[] = [];
  let start = usable[0]!;
  let previous = usable[0]!;

  for (const point of usable.slice(1)) {
    const reset =
      point.donations! < previous.donations! ||
      point.donationsReceived! < previous.donationsReceived!;

    if (reset) {
      // The season ends at `previous` — the last reading before the counter
      // went back to zero, and therefore that season's final total.
      seasons.push({
        from: start.capturedAt,
        to: previous.capturedAt,
        given: previous.donations!,
        received: previous.donationsReceived!,
        complete: true,
      });
      start = point;
    }
    previous = point;
  }

  // The season in progress. Its total is the newest reading, and it will keep
  // climbing — hence complete: false, so a caller does not chart it as final.
  seasons.push({
    from: start.capturedAt,
    to: previous.capturedAt,
    given: previous.donations!,
    received: previous.donationsReceived!,
    complete: false,
  });

  return seasons;
}

/**
 * When this player was last seen doing anything.
 *
 * There is no such field in the game API, so it is derived: the most recent
 * snapshot at which donations rose, donations received rose, or trophies moved
 * at all. Trophies move in both directions — losing them is still playing.
 *
 * A reset is explicitly NOT activity. The counter dropping to zero happens to
 * every member simultaneously whether they logged in or not, and counting it
 * would show the whole clan as active on the first of every month.
 *
 * Null when there is nothing to compare — a single snapshot proves the player
 * existed at that moment, not that they did anything.
 *
 * This is a floor, not a fact: a member who plays daily without donating or
 * moving trophies looks idle here. T3B.5 depends on that being understood, which
 * is why the UI says "last activity seen" rather than "last online".
 */
export function lastActivityAt(points: SnapshotPoint[]): string | null {
  let seen: string | null = null;

  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1]!;
    const point = points[i]!;

    const gave = rose(previous.donations, point.donations);
    const received = rose(previous.donationsReceived, point.donationsReceived);
    const moved =
      previous.trophies !== null &&
      point.trophies !== null &&
      previous.trophies !== point.trophies;

    if (gave || received || moved) seen = point.capturedAt;
  }

  return seen;
}

/** A rise only. A fall is a monthly reset, which nobody did anything to cause. */
function rose(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return false;
  return after > before;
}

export interface MemberActivity {
  playerId: string;
  /** This season so far, straight off the newest snapshot. */
  donations: number | null;
  donationsReceived: number | null;
  ratio: number | null;
  trophies: number | null;
  lastActivityAt: string | null;
  /** Ratio is known and below LOW_RATIO_THRESHOLD. */
  lowRatio: boolean;
}

/**
 * Fold one player's latest reading and their history into what the directory
 * shows for them.
 *
 * `latest` and `history` are separate arguments because they come from separate
 * queries with different costs: the directory reads one latest-snapshot batch
 * for the whole clan, and only the profile page reads a full history per player.
 * Passing an empty history is normal and simply leaves lastActivityAt null.
 */
export function memberActivity(
  playerId: string,
  latest: SnapshotPoint | undefined,
  history: SnapshotPoint[] = [],
): MemberActivity {
  const donations = latest?.donations ?? null;
  const received = latest?.donationsReceived ?? null;
  const ratio = donationRatio(donations, received);

  return {
    playerId,
    donations,
    donationsReceived: received,
    ratio,
    trophies: latest?.trophies ?? null,
    lastActivityAt: lastActivityAt(history),
    lowRatio: ratio !== null && ratio < LOW_RATIO_THRESHOLD,
  };
}

/**
 * memberActivity(), with last activity already known — from 055's
 * last_activity(), which applies lastActivityAt()'s rule over weeks of readings
 * in the database. The directory and Participation use this; the profile still
 * derives it from the full history it reads anyway.
 */
export function memberActivityAt(
  playerId: string,
  latest: SnapshotPoint | undefined,
  lastSeen: string | null,
): MemberActivity {
  return { ...memberActivity(playerId, latest), lastActivityAt: lastSeen };
}

// ─────────────────────────────────────────────────────────────────────────────
// T3B.5 — inactivity.
//
// ADVISORY ONLY. Nothing in this system acts on the output, and nothing should.
// The spec says never automate a kick decision, and the reason is in the inputs:
// every one of them is a proxy. lastActivityAt is a floor derived from two
// counters, not a login time. CWL participation is zero for everyone in a month
// the clan did not play. A member on holiday and a member who has quit look
// identical from here.
//
// So this returns REASONS, not just a number. A leader who cannot see why
// someone was flagged cannot defend the decision to them, and a score with no
// visible working is one that gets trusted exactly as far as its first mistake.
// ─────────────────────────────────────────────────────────────────────────────

/** Days without observed activity before a member is worth a look. */
export const QUIET_DAYS = 14;

export interface AttentionInput {
  playerId: string;
  name: string;
  activity: MemberActivity;
  /** CWL wars this player was rostered for in the window, and attacks they used. */
  warsRostered: number;
  attacksUsed: number;
}

export interface AttentionFlag {
  playerId: string;
  name: string;
  /** Plain sentences, shown verbatim. The score is never presented alone. */
  reasons: string[];
  /** Count of reasons. Ordering only — it is not a percentage of anything. */
  score: number;
}

/**
 * Members worth a second look, with the reason for each.
 *
 * `now` is injected so this is testable without waiting, matching the shape
 * services/freshness.ts already uses.
 *
 * A member with no snapshot at all is NOT flagged. Unknown is not inactive, and
 * flagging it would fill the list with everyone the sync has not reached yet —
 * which on day one is the entire clan.
 */
export function needsAttention(
  members: AttentionInput[],
  now: Date = new Date(),
): AttentionFlag[] {
  const flags: AttentionFlag[] = [];

  for (const member of members) {
    const reasons: string[] = [];
    const { activity } = member;

    if (activity.lastActivityAt) {
      const days = Math.floor(
        (now.getTime() - new Date(activity.lastActivityAt).getTime()) / 86_400_000,
      );
      if (days >= QUIET_DAYS) {
        reasons.push(`No donations or trophy movement seen for ${days} days`);
      }
    }

    if (activity.lowRatio && activity.ratio !== null) {
      reasons.push(
        `Donation ratio ${activity.ratio.toFixed(2)} — received ` +
          `${activity.donationsReceived} and gave ${activity.donations} this season`,
      );
    }

    // Only meaningful if they were actually picked. Zero of zero is not a miss,
    // it is a month the clan did not play CWL, or one they were not rostered in.
    if (member.warsRostered > 0 && member.attacksUsed === 0) {
      reasons.push(
        `Rostered for ${member.warsRostered} CWL war` +
          `${member.warsRostered === 1 ? "" : "s"} and attacked in none`,
      );
    } else if (member.warsRostered >= 3 && member.attacksUsed < member.warsRostered / 2) {
      reasons.push(
        `Used ${member.attacksUsed} of ${member.warsRostered} CWL attacks`,
      );
    }

    if (reasons.length) {
      flags.push({
        playerId: member.playerId,
        name: member.name,
        reasons,
        score: reasons.length,
      });
    }
  }

  // Most reasons first, then alphabetically so the order is stable between loads.
  return flags.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}
