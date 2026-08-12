// T9.1 — participation across every clan, in one view. Objective O3.
//
// This is the page IMPLEMENTATION.md calls "what the leader actually wants",
// and the reason is that the alternative is three browser tabs and mental
// arithmetic. One leader runs all three clans; the question they ask is never
// "how is clan A doing" but "who across all of it has stopped turning up".
//
// R3 — SPANNING CLANS IS NOT THE SAME AS NOT FILTERING BY CLAN, and this is the
// second page where that distinction is the whole risk (search, T3B.6, was the
// first). Every read here is per clan, over the list visibleClans() returned.
// Nothing queries players or member_snapshots unscoped and leans on RLS to sort
// it out afterwards — RLS is the net, not the plan.
//
// No SQL in this file. It takes what the repositories returned and works out
// what it means, which is what src/services/ is for.

import type { MemberRow, SnapshotPoint } from "@/repositories/members";
import { memberActivity, needsAttention, type MemberActivity } from "@/services/members";

export interface ClanInput {
  clanId: string;
  clanTag: string;
  clanName: string;
  members: MemberRow[];
  latest: Map<string, SnapshotPoint>;
  /**
   * playerId -> that player's recent snapshots, ascending.
   *
   * From recentSnapshots(), which reads the whole clan's window in ONE query.
   * Without it `lastActivityAt` is null for everybody and the only flag that can
   * ever fire is the donation ratio — which would make a "needs attention"
   * column that silently under-reports rather than one that is simply absent.
   */
  history: Map<string, SnapshotPoint[]>;
}

export interface ParticipationRow {
  playerId: string;
  tag: string;
  name: string;
  clanId: string;
  clanTag: string;
  clanName: string;
  thLevel: number | null;
  activity: MemberActivity;
  /** Advisory reasons this member is worth a look. Never a kick decision (T3B.5). */
  flags: string[];
}

export interface ClanSummary {
  clanId: string;
  clanTag: string;
  clanName: string;
  members: number;
  /** Members whose donation ratio is known and below the threshold. */
  lowRatio: number;
  /** Members carrying at least one attention flag. */
  needsAttention: number;
  /** Median donation ratio, or null when nobody has a known one. */
  medianRatio: number | null;
}

/**
 * Every member of every clan, flattened into one sortable list.
 *
 * Sorted by attention first, then by name. The leader opens this page to find
 * the people who have stopped playing, so the answer is at the top rather than
 * behind a sort they have to know to apply — and within the flagged group,
 * alphabetical, because "who was flagged" is a list you read rather than a
 * ranking you act on in order.
 *
 * DEPARTED MEMBERS ARE NOT HERE. membersForClan() excludes them by default and
 * this does not ask for them: a participation report is about the people
 * currently in the clans. Their history survives (R4) and the player profile
 * still shows it — T0.11 answer 4 confirmed that is wanted — but a former
 * member sitting in a "needs attention" list forever is noise that makes the
 * real entries harder to see.
 */
export function participation(
  clans: readonly ClanInput[],
  now: Date = new Date(),
): ParticipationRow[] {
  const rows = clans.flatMap((clan) =>
    clan.members.map((member) => ({
      playerId: member.playerId,
      tag: member.tag,
      name: member.name,
      clanId: clan.clanId,
      clanTag: clan.clanTag,
      clanName: clan.clanName,
      thLevel: member.thLevel,
      activity: memberActivity(
        member.playerId,
        clan.latest.get(member.playerId),
        clan.history.get(member.playerId) ?? [],
      ),
      flags: [] as string[],
    })),
  );

  // needsAttention() takes the whole list at once and is called once, not per
  // member: it is the single statement of what "worth a look" means (T3B.5), and
  // reimplementing any part of it here would give this page a second opinion
  // that drifts from the per-clan one the leader compares it against.
  //
  // CWL counts are passed as zero. Wiring them would mean a roster-and-attack
  // read per player per season across every clan, and the flag they drive is
  // explicitly inert at zero — "rostered for none, attacked in none" is not a
  // miss. The per-clan attention list (T3B.5) is where CWL is already weighed.
  const flagged = new Map(
    needsAttention(
      rows.map((r) => ({
        playerId: r.playerId,
        name: r.name,
        activity: r.activity,
        warsRostered: 0,
        attacksUsed: 0,
      })),
      now,
    ).map((f) => [f.playerId, f.reasons]),
  );

  for (const row of rows) row.flags = flagged.get(row.playerId) ?? [];

  return rows.sort(
    (a, b) => b.flags.length - a.flags.length || a.name.localeCompare(b.name),
  );
}

/** The median of a list, or null when it is empty. Even counts take the lower middle. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

/**
 * One row per clan, for comparing them against each other.
 *
 * MEDIAN RATHER THAN MEAN, and the difference is not cosmetic. One member who
 * donates 40,000 and receives 200 drags a clan's mean ratio far above what a
 * typical member there is doing, and the leader reads it as "clan B is fine"
 * while most of clan B donates nothing. The median describes the middle member,
 * which is the one the question is actually about.
 */
export function clanSummaries(rows: readonly ParticipationRow[]): ClanSummary[] {
  const byClan = new Map<string, ParticipationRow[]>();
  for (const row of rows) {
    const list = byClan.get(row.clanId) ?? [];
    list.push(row);
    byClan.set(row.clanId, list);
  }

  return [...byClan.values()]
    .map((members) => {
      const first = members[0]!;
      const ratios = members
        .map((m) => m.activity.ratio)
        .filter((r): r is number => r !== null);

      return {
        clanId: first.clanId,
        clanTag: first.clanTag,
        clanName: first.clanName,
        members: members.length,
        lowRatio: members.filter((m) => m.activity.lowRatio).length,
        needsAttention: members.filter((m) => m.flags.length > 0).length,
        medianRatio: median(ratios),
      };
    })
    .sort((a, b) => a.clanName.localeCompare(b.clanName));
}
