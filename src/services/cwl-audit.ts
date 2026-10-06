// QA for one CWL war day: is what the rating was worked out FROM sound, and
// does what came out hold together?
//
// The rating is derived, so it is only ever as right as the rows under it — and
// both times it has been wrong the sums were fine and the rows were not: the
// API's mapPosition read as a base number ("#19" of 15), and a member swapped
// out in preparation left in the lineup ("#16 of 16"). Neither raised anything.
// A wrong number looks exactly like a right one.
//
// So this asks the questions that would have caught them, of any day:
//
//   the lineups    each side the war's team size; every base numbered, once
//   the attacks    cwl_attacks and the lineup rows tell the same story; every
//                  target is a base the enemy fielded; every enemy hit lands
//                  on one of ours; the stars add up to the war's own score
//   the rating     plus shares add to 100, none outside the limits, one heroic
//                  of each at most, every player's lines add up to his marks
//
// Pure: it is handed the rows and returns sentences. An empty list is a clean
// day. scripts/audit-cwl-rating.ts runs it over the live database, and
// test/cwl-rating-e2e.test.ts over a seeded one.

import type { CwlAttack, CwlRosterEntry } from "@/repositories/cwl";
import type { DayBoard } from "@/services/cwl-day";
import { CWL_MARKS, type DayRating } from "@/services/cwl-rating";
import type { ScoutWarMember } from "@/services/cwl-scouting";

export interface AuditDayInput {
  war: {
    state: string | null;
    teamSize: number | null;
    ourStars: number | null;
    theirStars: number | null;
  };
  /** Our roster and attacks as stored (cwl_war_members, cwl_attacks). */
  roster: readonly CwlRosterEntry[];
  attacks: readonly CwlAttack[];
  /** Both sides of this war as FIELDED — after fieldedOnly(). */
  lineup: readonly ScoutWarMember[];
  ourTag: string;
  board: DayBoard;
  rated: DayRating;
}

/** Everything wrong with one day, as sentences. Empty when nothing is. */
export function auditDay(input: AuditDayInput): string[] {
  const { war, roster, attacks, lineup, ourTag, board, rated } = input;
  const issues: string[] = [];
  const own = lineup.filter((m) => m.clanTag === ourTag);
  const foe = lineup.filter((m) => m.clanTag !== ourTag);

  if (war.state === null) issues.push("the war has no state");
  if (war.teamSize === null) issues.push("the war has no team size");

  // ── the lineups ────────────────────────────────────────────────────────────
  if (war.teamSize !== null) {
    const size = war.teamSize;
    if (roster.length !== size) issues.push(`our roster has ${roster.length} members for a ${size}-base war`);
    if (board.bases.length !== size) issues.push(`the board has ${board.bases.length} of our bases, not ${size}`);
    if (own.length > 0 && own.length !== size) issues.push(`our lineup has ${own.length} rows, not ${size}`);
    if (foe.length > 0 && foe.length !== size) issues.push(`the enemy lineup has ${foe.length} rows, not ${size}`);
  }

  const numbers = board.bases.map((b) => b.base);
  if (numbers.some((n) => n === null)) issues.push("one of our bases has no number");
  const known = numbers.filter((n): n is number => n !== null);
  if (new Set(known).size !== known.length) issues.push("two of our bases share a number");
  if (known.length > 0 && Math.max(...known) !== known.length) {
    issues.push(`our base numbers run to ${Math.max(...known)} over ${known.length} bases`);
  }

  const foeTags = new Set(foe.map((m) => m.tag));
  const ourTags = new Set(board.bases.map((b) => b.tag));
  for (const m of foe) {
    if (m.thLevel === null) issues.push(`enemy ${m.name ?? m.tag} has no Town Hall`);
    if (m.mapPosition === null) issues.push(`enemy ${m.name ?? m.tag} has no map position`);
  }

  // ── the attacks ────────────────────────────────────────────────────────────
  const onBoard = new Set(board.bases.map((b) => b.playerId));
  const perPlayer = new Map<string, number>();
  for (const attack of attacks) {
    perPlayer.set(attack.playerId, (perPlayer.get(attack.playerId) ?? 0) + 1);
    if (!onBoard.has(attack.playerId)) issues.push("an attack is stored for a player who is not on the board");
  }
  for (const [, count] of perPlayer) {
    if (count > 1) issues.push(`a player has ${count} attacks stored — CWL gives one`);
  }

  for (const base of board.bases) {
    if (!base.tag || base.name === "Unknown player") issues.push("a roster member has no players row");
    if (base.thLevel === null) issues.push(`${base.name} has no Town Hall`);

    const row = own.find((m) => m.tag === base.tag);
    if (row && !base.attack && row.attackStars !== null) {
      issues.push(`${base.name} attacked according to his lineup row, but cwl_attacks has nothing`);
    }
    const attack = base.attack;
    if (!attack) continue;

    if (!attack.target) {
      issues.push(`${base.name}'s attack names no defender`);
    } else if (foe.length > 0) {
      if (!foeTags.has(attack.target.tag) || attack.target.base === null) {
        issues.push(`${base.name} attacked ${attack.target.tag}, who is not in the fielded enemy lineup`);
      } else if (attack.target.thLevel === null) {
        issues.push(`${base.name}'s target has no Town Hall`);
      }
    }
    // Only where it is used: a day that is not rated reads no order.
    if (attack.alreadyTaken === null && rated.status !== "notRated") {
      issues.push(`${base.name} hit a base a clanmate also hit, and the order of the attacks is not recorded`);
    }
    if (row) {
      if (row.attackStars === null) {
        issues.push(`${base.name} has an attack in cwl_attacks but none on his lineup row`);
      } else if (row.attackStars !== attack.stars || row.attackDefenderTag !== (attack.target?.tag ?? null)) {
        issues.push(`${base.name}'s attack differs between cwl_attacks and his lineup row`);
      }
    }
  }

  for (const m of foe) {
    if (m.attackStars === null) continue;
    if (m.attackDefenderTag !== null && !ourTags.has(m.attackDefenderTag)) {
      issues.push(`enemy ${m.name ?? m.tag} attacked ${m.attackDefenderTag}, who is not one of our bases`);
    }
  }

  // The best hit on each base is what scores, on both sides.
  if (foe.length > 0) {
    const won = new Map<string, number>();
    for (const base of board.bases) {
      const target = base.attack?.target;
      if (target) won.set(target.tag, Math.max(won.get(target.tag) ?? 0, base.attack!.stars));
    }
    const ours = [...won.values()].reduce((t, v) => t + v, 0);
    const theirs = board.bases.reduce((t, b) => t + (b.defences[0]?.stars ?? 0), 0);
    if (war.ourStars !== null && ours !== war.ourStars) {
      issues.push(`our attacks add up to ${ours} stars; the war says ${war.ourStars}`);
    }
    if (war.theirStars !== null && theirs !== war.theirStars) {
      issues.push(`their attacks add up to ${theirs} stars; the war says ${war.theirStars}`);
    }
  }

  // ── the rating ─────────────────────────────────────────────────────────────
  if (rated.status === "counted" || rated.status === "provisional") {
    const rows = rated.players;
    if (rows.length !== board.bases.length) issues.push(`${rows.length} players rated for ${board.bases.length} bases`);

    const plus = rows.filter((r) => r.marks > 0).reduce((t, r) => t + r.share, 0);
    if (rated.total > 0 && Math.abs(plus - 100) > 0.001) issues.push(`the plus shares add up to ${plus.toFixed(3)}, not 100`);
    if (rows.some((r) => r.share > 100.0001)) issues.push("a share is above 100%");
    if (rows.some((r) => r.share < CWL_MARKS.worstShare - 0.0001)) issues.push(`a share is below ${CWL_MARKS.worstShare}%`);
    if (rows.filter((r) => r.heroicAttack).length > 1) issues.push("more than one heroic attack");
    if (rows.filter((r) => r.heroicDefence).length > 1) issues.push("more than one heroic defence");

    for (const r of rows) {
      const lines = [...r.attack, ...r.defence];
      const added = Math.round(lines.reduce((t, l) => t + l.marks, 0) * 10) / 10;
      if (Math.abs(added - r.marks) > 0.05) issues.push(`${r.name}'s lines add up to ${added}, his marks are ${r.marks}`);
      // The page keys a row's lines by their label.
      if (new Set(r.attack.map((l) => l.label)).size !== r.attack.length) issues.push(`${r.name} has two attack lines with one label`);
      if (new Set(r.defence.map((l) => l.label)).size !== r.defence.length) issues.push(`${r.name} has two defence lines with one label`);
    }
  }

  return [...new Set(issues)];
}
