// T6.5, T6.9, T6.10 — derived war values. No SQL here; this layer takes what the
// repository returned and works out what it means.
//
// ─────────────────────────────────────────────────────────────────────────────
// A WAR IS NOT A CWL DAY, AND COPYING services/cwl.ts WOULD BE WRONG
//
// CWL gives each member ONE attack, so "missed" is a boolean and
// services/cwl.ts models it as one. A regular war gives TWO. That single
// difference changes what the leader is looking at:
//
//   used 0 of 2   did nothing. The list everyone already chases.
//   used 1 of 2   HALF A MISS, and the one a boolean hides completely.
//   used 2 of 2   done.
//
// Fifteen members each leaving one attack unused is fifteen attacks — more than
// a whole second roster's worth — and a `missed: boolean` reports every one of
// them as fine. So the unit here is the ATTACK, not the member.
//
// The denominator comes from war_members.attacks_allowed rather than a constant
// 2, for the reason 024 gives on that column: it is what the API said about THIS
// war, and a future game change must not silently rewrite what old wars meant.
// ─────────────────────────────────────────────────────────────────────────────
//
// R12 — everything below compares a plan against an outcome and never rewrites
// one to match the other. Where the answer is unknowable, these functions return
// null rather than false: "we cannot tell whether they hit their target" and
// "they ignored their target" are different findings, and collapsing them
// accuses people of things the data does not say.

import type {
  Lineup,
  LineupMember,
  WarAttackRow,
  WarMemberRow,
  WarOpponentRow,
  WarRow,
  WarTargetRow,
} from "@/repositories/war";

export interface MemberWarRecord {
  playerId: string;
  tag: string;
  name: string;
  mapPosition: number | null;
  thLevel: number | null;
  attacks: WarAttackRow[];
  attacksUsed: number;
  attacksAllowed: number;
  /** Unused attacks. 0, 1 or 2 — the number the chase list is actually about. */
  attacksRemaining: number;
  /** True only when they used NONE. Kept for the headline count, not the whole story. */
  missedEntirely: boolean;
  stars: number;
  destruction: number;
  /** The base they were told to hit, if anyone told them. */
  target: WarTargetRow | null;
  /**
   * Did they attack the base they were assigned?
   *
   * null when unknowable — no assignment, no attack yet, or an attack whose
   * defender_position the sync could not resolve. Never false in those cases:
   * false is an accusation.
   */
  followedTarget: boolean | null;
}

/**
 * The roster with each member's attacks and assignment attached.
 *
 * Driven from the roster, not from the attacks. A player only appears if they
 * were actually in the war, and a player with no attacks still appears — which
 * is the entire point. Iterating attacks instead makes the people who did
 * nothing invisible, and they are the ones the leader is looking for.
 */
export function warRecord(
  members: WarMemberRow[],
  attacks: WarAttackRow[],
  targets: WarTargetRow[] = [],
): MemberWarRecord[] {
  const byPlayer = new Map<string, WarAttackRow[]>();
  for (const attack of attacks) {
    const list = byPlayer.get(attack.playerId) ?? [];
    list.push(attack);
    byPlayer.set(attack.playerId, list);
  }

  const targetOf = new Map(targets.map((t) => [t.playerId, t]));

  return members.map((member) => {
    const mine = (byPlayer.get(member.playerId) ?? [])
      .slice()
      .sort((a, b) => a.attackOrder - b.attackOrder);
    const target = targetOf.get(member.playerId) ?? null;

    return {
      playerId: member.playerId,
      tag: member.tag,
      name: member.name,
      mapPosition: member.mapPosition,
      thLevel: member.thLevel,
      attacks: mine,
      attacksUsed: mine.length,
      attacksAllowed: member.attacksAllowed,
      // Clamped at zero. A member with more attacks than allowed is not a
      // negative remainder, it is a data problem, and reporting "-1 left" sends
      // the reader looking for a bug in the wrong place.
      attacksRemaining: Math.max(0, member.attacksAllowed - mine.length),
      missedEntirely: mine.length === 0,
      stars: mine.reduce((total, a) => total + a.stars, 0),
      destruction: mine.reduce((total, a) => total + a.destruction, 0),
      target,
      followedTarget: didFollowTarget(target, mine),
    };
  });
}

/**
 * Whether any of a member's attacks landed on the base they were assigned.
 *
 * ANY, not the first: a member told to hit base 3 who scouts base 7 first and
 * then takes base 3 has done what they were asked. Judging only the first
 * attack marks that as non-compliance and starts an argument the report exists
 * to prevent.
 */
function didFollowTarget(
  target: WarTargetRow | null,
  attacks: WarAttackRow[],
): boolean | null {
  if (!target) return null;
  if (!attacks.length) return null;

  // Every attack missing a defender_position means the sync could not resolve
  // the opponent roster. Unknown, not "no".
  const known = attacks.filter((a) => a.defenderPosition !== null);
  if (!known.length) return null;

  return known.some((a) => a.defenderPosition === target.targetPosition);
}

/**
 * The chase list (T6.3), ordered by how much is still owed.
 *
 * Two attacks outstanding before one, then by map position so the list reads
 * top-down the way the war map does.
 */
export function outstandingAttacks(record: MemberWarRecord[]): MemberWarRecord[] {
  return record
    .filter((m) => m.attacksRemaining > 0)
    .sort(
      (a, b) =>
        b.attacksRemaining - a.attacksRemaining ||
        (a.mapPosition ?? 99) - (b.mapPosition ?? 99),
    );
}

// ---------------------------------------------------------------------------
// T6.3 — the enemy board
// ---------------------------------------------------------------------------

export interface EnemyBase {
  position: number;
  tag: string | null;
  name: string | null;
  thLevel: number | null;
  /** Best stars anyone got on it. null when nobody has hit it. */
  bestStars: number | null;
  bestDestruction: number | null;
  /** Everyone who attacked it, in the order they did. */
  attackedBy: Array<{ playerId: string; name: string; stars: number; destruction: number }>;
  /** Members told to hit it, whether or not they have. */
  assignedTo: Array<{ playerId: string; name: string }>;
  /** Nobody assigned and nobody attacked — what a member may claim (T6.4). */
  free: boolean;
}

/**
 * The other side, base by base, with what has happened to each (T6.3).
 *
 * Built from `teamSize` rather than from the opponent rows, so a base the sync
 * has no roster entry for still appears. It has to: the leader assigns targets
 * by position, and a board that silently omitted base 11 would make base 11
 * unassignable — with the missing row looking like a smaller war rather than a
 * gap.
 *
 * BEST stars, not latest and not a sum. Two members hitting one base gives that
 * base one score, and it is the best of them — which is how the game scores it
 * and therefore the only number that matches what the leader sees in-game.
 */
export function enemyBoard(
  teamSize: number,
  opponents: WarOpponentRow[],
  attacks: WarAttackRow[],
  members: WarMemberRow[],
  targets: WarTargetRow[] = [],
): EnemyBase[] {
  const nameOf = new Map(members.map((m) => [m.playerId, m.name]));
  const byPosition = new Map(
    opponents.filter((o) => o.mapPosition !== null).map((o) => [o.mapPosition!, o]),
  );

  // An attack whose defender_position the sync could not resolve belongs to no
  // base. Dropped from the board rather than bucketed into base 0, which would
  // read as somebody attacking a base that does not exist.
  const hits = new Map<number, WarAttackRow[]>();
  for (const attack of attacks) {
    if (attack.defenderPosition === null) continue;
    const list = hits.get(attack.defenderPosition) ?? [];
    list.push(attack);
    hits.set(attack.defenderPosition, list);
  }

  const assigned = new Map<number, WarTargetRow[]>();
  for (const target of targets) {
    const list = assigned.get(target.targetPosition) ?? [];
    list.push(target);
    assigned.set(target.targetPosition, list);
  }

  const board: EnemyBase[] = [];
  for (let position = 1; position <= teamSize; position += 1) {
    const opponent = byPosition.get(position) ?? null;
    const landed = (hits.get(position) ?? []).slice().sort((a, b) => a.attackOrder - b.attackOrder);
    const plan = assigned.get(position) ?? [];

    board.push({
      position,
      tag: opponent?.tag ?? null,
      name: opponent?.name ?? null,
      thLevel: opponent?.thLevel ?? null,
      bestStars: landed.length ? Math.max(...landed.map((a) => a.stars)) : null,
      bestDestruction: landed.length ? Math.max(...landed.map((a) => a.destruction)) : null,
      attackedBy: landed.map((a) => ({
        playerId: a.playerId,
        name: nameOf.get(a.playerId) ?? "Unknown player",
        stars: a.stars,
        destruction: a.destruction,
      })),
      assignedTo: plan.map((t) => ({
        playerId: t.playerId,
        name: nameOf.get(t.playerId) ?? "Unknown player",
      })),
      free: plan.length === 0 && landed.length === 0,
    });
  }

  return board;
}

export interface WarTotals {
  warsPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  stars: number;
  starsAgainst: number;
}

/**
 * A win/loss record over a set of wars (T6.6).
 *
 * Counts only wars that HAVE a result. A war in preparation has none, and
 * scoring it as anything — including a loss — is a lie about a war that has not
 * been fought.
 */
export function warTotals(wars: WarRow[]): WarTotals {
  const totals: WarTotals = {
    warsPlayed: 0,
    wins: 0,
    losses: 0,
    ties: 0,
    stars: 0,
    starsAgainst: 0,
  };

  for (const war of wars) {
    if (!war.result) continue;
    totals.warsPlayed += 1;
    if (war.result === "win") totals.wins += 1;
    else if (war.result === "lose") totals.losses += 1;
    else totals.ties += 1;
    totals.stars += war.ourStars ?? 0;
    totals.starsAgainst += war.theirStars ?? 0;
  }

  return totals;
}

// ---------------------------------------------------------------------------
// T6.10 — plan versus reality
// ---------------------------------------------------------------------------

export interface PlanVersusReality {
  /** Picked by the leader and in the war the API reported. The normal case. */
  playedAsPicked: Array<{ playerId: string; name: string }>;
  /**
   * Picked and then not in the war.
   *
   * The interesting bucket, and the one no amount of API data can produce on its
   * own — the API cannot report an absence it never knew was expected.
   */
  pickedButAbsent: Array<{ playerId: string; name: string }>;
  /** In the war without being picked. Matchmaking filled the slot, or plans changed. */
  playedUnpicked: Array<{ playerId: string; name: string }>;
}

/**
 * Compare who was picked against who played (T6.10).
 *
 * Both lists are kept and neither overwrites the other (R12). This is the
 * comparison migration 024 gives war_lineup_members its own table for, and the
 * reason no sync job is allowed to write there.
 */
export function planVersusReality(
  picked: LineupMember[],
  played: WarMemberRow[],
): PlanVersusReality {
  const playedIds = new Set(played.map((m) => m.playerId));
  const pickedIds = new Set(picked.map((m) => m.playerId));

  return {
    playedAsPicked: picked
      .filter((m) => playedIds.has(m.playerId))
      .map((m) => ({ playerId: m.playerId, name: m.name })),
    pickedButAbsent: picked
      .filter((m) => !playedIds.has(m.playerId))
      .map((m) => ({ playerId: m.playerId, name: m.name })),
    playedUnpicked: played
      .filter((m) => !pickedIds.has(m.playerId))
      .map((m) => ({ playerId: m.playerId, name: m.name })),
  };
}

export interface TargetCompliance {
  /** Members with an assignment and at least one attack whose target is known. */
  judged: number;
  followed: number;
  ignored: number;
  /** Assigned, but nothing to judge yet — no attack, or no resolvable defender. */
  unknown: number;
  /** Attacked with no assignment at all. Not a fault; the plan was incomplete. */
  unassigned: number;
}

/**
 * How closely the war followed the plan (T6.10, second half).
 *
 * `unknown` is reported as its own number rather than folded into `ignored`. A
 * report that says "6 of 15 ignored their target" when 5 of those 6 simply had
 * not attacked yet is worse than no report: it is confidently wrong about people.
 */
export function targetCompliance(record: MemberWarRecord[]): TargetCompliance {
  const compliance: TargetCompliance = {
    judged: 0,
    followed: 0,
    ignored: 0,
    unknown: 0,
    unassigned: 0,
  };

  for (const member of record) {
    if (!member.target) {
      if (member.attacksUsed > 0) compliance.unassigned += 1;
      continue;
    }
    if (member.followedTarget === null) {
      compliance.unknown += 1;
      continue;
    }
    compliance.judged += 1;
    if (member.followedTarget) compliance.followed += 1;
    else compliance.ignored += 1;
  }

  return compliance;
}

// ---------------------------------------------------------------------------
// T6.9 — contribution across the last N wars
// ---------------------------------------------------------------------------

export interface WarContribution {
  playerId: string;
  tag: string;
  name: string;
  /** The denominator. 4 attacks from 7 wars is a different conversation from 4 from 2. */
  warsPlayed: number;
  attacksAvailable: number;
  attacksUsed: number;
  attacksMissed: number;
  stars: number;
  destruction: number;
  /** Wars where they were in the roster and attacked nothing at all. */
  warsMissedEntirely: number;
  targetsFollowed: number;
  targetsJudged: number;
}

/**
 * Per-player totals across several wars, for the aggregate table and the player
 * profile (T6.9).
 *
 * `attacksAvailable` is summed per war rather than multiplied out, because a
 * member who played four wars out of six has eight attacks available and not
 * twelve. Getting that wrong understates everybody by exactly the wars they were
 * not in, which reads as a participation problem that does not exist.
 */
export function warContribution(
  perWar: Array<{ members: WarMemberRow[]; attacks: WarAttackRow[]; targets?: WarTargetRow[] }>,
): WarContribution[] {
  const byPlayer = new Map<string, WarContribution>();

  for (const war of perWar) {
    for (const member of warRecord(war.members, war.attacks, war.targets ?? [])) {
      const entry = byPlayer.get(member.playerId) ?? {
        playerId: member.playerId,
        tag: member.tag,
        name: member.name,
        warsPlayed: 0,
        attacksAvailable: 0,
        attacksUsed: 0,
        attacksMissed: 0,
        stars: 0,
        destruction: 0,
        warsMissedEntirely: 0,
        targetsFollowed: 0,
        targetsJudged: 0,
      };

      entry.warsPlayed += 1;
      entry.attacksAvailable += member.attacksAllowed;
      entry.attacksUsed += member.attacksUsed;
      entry.attacksMissed += member.attacksRemaining;
      entry.stars += member.stars;
      entry.destruction += member.destruction;
      if (member.missedEntirely) entry.warsMissedEntirely += 1;
      if (member.followedTarget !== null) {
        entry.targetsJudged += 1;
        if (member.followedTarget) entry.targetsFollowed += 1;
      }

      byPlayer.set(member.playerId, entry);
    }
  }

  // Fewest missed attacks first, then most stars — the order a leader reads it
  // in. Reliability above brilliance, because the missed attack is what loses
  // the war and the report is used to pick the next lineup.
  return [...byPlayer.values()].sort(
    (a, b) =>
      a.attacksMissed - b.attacksMissed ||
      b.stars - a.stars ||
      a.name.localeCompare(b.name),
  );
}

/**
 * Has anyone linked a lineup to this war yet?
 *
 * T6.10 is meaningless without it, and the page has to say so rather than
 * rendering an empty comparison that looks like "nobody was picked".
 */
export function isComparable(lineup: Lineup | null): boolean {
  return lineup !== null && lineup.status === "published";
}

// ---------------------------------------------------------------------------
// T6.4 — the base number, validated
// ---------------------------------------------------------------------------

/** The largest war the game offers, and 024's upper CHECK on lineup size. */
export const MAX_WAR_SIZE = 50;

/**
 * A base number from a form, or null if it is not one.
 *
 * This exists because NOTHING ELSE CHECKS IT. `003_war.sql` gives
 * `war_targets.target_position` no range CHECK, and neither `assign_war_target`
 * (024) nor `claim_war_target` (025) validates it — they check the role, the
 * clan, the war state and whether the base is taken, and take the number on
 * trust. The old call site read `Number(formData.get("position") ?? NaN)` and
 * tested `Number.isFinite`, which passes `0`: an empty select coerces to zero,
 * and zero is finite.
 *
 * A base-0 row is not a harmless bad value. It occupies the member's one
 * `unique (war_id, player_id)` slot, so they cannot be given a real target
 * without it being cleared first — while being invisible on the board, because
 * `enemyBoard` iterates 1..teamSize. The member appears unassigned and cannot
 * be assigned, and nothing on screen says why.
 *
 * Bounded above by the war's own size when known: base 47 in a 15v15 is the
 * same invisible row as base 0, and MAX_WAR_SIZE alone would let it through.
 * Falls back to MAX_WAR_SIZE only when teamSize is null, which is a war the
 * sync recorded before the game reported a size.
 */
export function parseBasePosition(raw: unknown, teamSize: number | null): number | null {
  // Rejects "", null, undefined, " ", "3.5", "3abc" and NaN. Number("") is 0,
  // which is the whole bug, so the empty string is turned away by hand first.
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const text = String(raw).trim();
  if (text === "") return null;

  const position = Number(text);
  if (!Number.isInteger(position)) return null;

  const upper = teamSize && teamSize > 0 ? teamSize : MAX_WAR_SIZE;
  if (position < 1 || position > upper) return null;

  return position;
}
