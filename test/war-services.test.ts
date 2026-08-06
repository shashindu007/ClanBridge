// T6.5, T6.9, T6.10 — the war derivations, and the repository writes that reach
// the definer functions.
//
// The pure half has no database. It exists because the war module's headline
// numbers are all derivations, and three of them are easy to get subtly wrong in
// ways that produce a confident, readable, incorrect report:
//
//   1. A REGULAR WAR GIVES TWO ATTACKS. `missed: boolean` — correct for CWL —
//      reports fifteen members who each left one attack unused as fifteen
//      members who are fine. That is a whole roster's worth of attacks hidden
//      by a type.
//
//   2. "DID NOT FOLLOW THEIR TARGET" AND "WE CANNOT TELL" ARE DIFFERENT. The
//      second is common: nobody has attacked yet. Collapsing it into the first
//      accuses people of something the data does not say.
//
//   3. ATTACKS AVAILABLE IS SUMMED PER WAR, NOT MULTIPLIED OUT. A member in four
//      wars of six has eight attacks available, not twelve; the multiplied
//      version understates everyone by exactly the wars they were not in.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHarness, type Harness } from "./pg-harness";
import { createPgliteSupabase } from "./pglite-supabase";
import type {
  LineupMember,
  WarAttackRow,
  WarMemberRow,
  WarOpponentRow,
  WarRow,
  WarTargetRow,
} from "@/repositories/war";
import {
  assignTarget,
  attacksForWar,
  claimTarget,
  clearTarget,
  currentWar,
  lineupForWar,
  membersOfWar,
  releaseTarget,
  targetsForWar,
  warById,
  warsForClan,
} from "@/repositories/war";
import {
  enemyBoard,
  isComparable,
  outstandingAttacks,
  planVersusReality,
  targetCompliance,
  warContribution,
  warRecord,
  warTotals,
} from "@/services/war";

// ───────────────────────────────────────────────────────────────────────────
// Builders. Kept tiny so each test reads as the case it is about.
// ───────────────────────────────────────────────────────────────────────────

function member(
  id: string,
  overrides: Partial<WarMemberRow> = {},
): WarMemberRow {
  return {
    playerId: id,
    tag: `#${id.toUpperCase()}`,
    name: `Player ${id}`,
    mapPosition: 1,
    thLevel: 15,
    attacksAllowed: 2,
    ...overrides,
  };
}

function attack(
  playerId: string,
  order: number,
  overrides: Partial<WarAttackRow> = {},
): WarAttackRow {
  return {
    playerId,
    attackOrder: order,
    stars: 3,
    destruction: 100,
    defenderTag: "#DEF",
    defenderPosition: 1,
    ...overrides,
  };
}

function target(playerId: string, position: number): WarTargetRow {
  return {
    playerId,
    targetPosition: position,
    note: null,
    assignedBy: "someone",
    assignedAt: "2026-07-29T06:00:00.000Z",
  };
}

describe("services/war — the derivations", () => {
  // ─────────────────────────────────────────────────────────────────────────
  describe("warRecord — two attacks, not one", () => {
    it("counts a member who used one of two as owing one", () => {
      const record = warRecord([member("a")], [attack("a", 1)]);

      expect(record[0]!.attacksUsed).toBe(1);
      expect(record[0]!.attacksRemaining).toBe(1);
      // The trap. CWL's boolean would report this member as having attacked and
      // therefore fine, and one unused attack per member loses wars.
      expect(record[0]!.missedEntirely).toBe(false);
    });

    it("counts a member who did nothing as owing both", () => {
      const record = warRecord([member("a")], []);
      expect(record[0]!.attacksRemaining).toBe(2);
      expect(record[0]!.missedEntirely).toBe(true);
    });

    it("counts a member who used both as owing nothing", () => {
      const record = warRecord([member("a")], [attack("a", 1), attack("a", 2)]);
      expect(record[0]!.attacksRemaining).toBe(0);
      expect(record[0]!.missedEntirely).toBe(false);
    });

    // The denominator is what the API said about THIS war (024's note on the
    // column), so a war that gave one attack each must not be measured as two.
    it("takes the denominator from the row, never from a constant 2", () => {
      const record = warRecord([member("a", { attacksAllowed: 1 })], [attack("a", 1)]);
      expect(record[0]!.attacksRemaining).toBe(0);
    });

    // More attacks than allowed is a data problem, not a negative debt.
    // "-1 left" sends the reader hunting for a bug in the wrong place.
    it("never reports a negative number of attacks remaining", () => {
      const record = warRecord(
        [member("a", { attacksAllowed: 1 })],
        [attack("a", 1), attack("a", 2)],
      );
      expect(record[0]!.attacksRemaining).toBe(0);
    });

    // Driven from the roster: a member who did nothing has no attack row to be
    // found by, and iterating attacks makes exactly the people the leader is
    // looking for invisible.
    it("includes a member with no attacks at all", () => {
      const record = warRecord([member("a"), member("b")], [attack("a", 1)]);
      expect(record.map((r) => r.playerId)).toEqual(["a", "b"]);
    });

    it("sums stars and destruction across both attacks", () => {
      const record = warRecord(
        [member("a")],
        [attack("a", 1, { stars: 2, destruction: 74.5 }), attack("a", 2, { stars: 3, destruction: 100 })],
      );
      expect(record[0]!.stars).toBe(5);
      expect(record[0]!.destruction).toBeCloseTo(174.5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("followedTarget — null is not false", () => {
    it("is true when any attack landed on the assigned base", () => {
      const record = warRecord(
        [member("a")],
        [attack("a", 1, { defenderPosition: 3 })],
        [target("a", 3)],
      );
      expect(record[0]!.followedTarget).toBe(true);
    });

    // ANY attack, not the first. Someone told to hit base 3 who scouts base 7
    // and then takes base 3 has done what they were asked; judging only the
    // first attack marks that as non-compliance and starts the argument the
    // report exists to prevent.
    it("is true when the SECOND attack landed on it", () => {
      const record = warRecord(
        [member("a")],
        [attack("a", 1, { defenderPosition: 7 }), attack("a", 2, { defenderPosition: 3 })],
        [target("a", 3)],
      );
      expect(record[0]!.followedTarget).toBe(true);
    });

    it("is false when they attacked and never touched it", () => {
      const record = warRecord(
        [member("a")],
        [attack("a", 1, { defenderPosition: 7 })],
        [target("a", 3)],
      );
      expect(record[0]!.followedTarget).toBe(false);
    });

    it("is null when they were assigned a base and have not attacked", () => {
      const record = warRecord([member("a")], [], [target("a", 3)]);
      expect(record[0]!.followedTarget).toBeNull();
    });

    it("is null when nobody assigned them anything", () => {
      const record = warRecord([member("a")], [attack("a", 1)]);
      expect(record[0]!.followedTarget).toBeNull();
    });

    // The sync could not resolve the opponent roster. Unknown, not "no" — this
    // is the failure mode an empty opponent list produces, and it must not read
    // as the whole clan ignoring orders.
    it("is null when no attack has a resolvable defender position", () => {
      const record = warRecord(
        [member("a")],
        [attack("a", 1, { defenderPosition: null })],
        [target("a", 3)],
      );
      expect(record[0]!.followedTarget).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("outstandingAttacks — the chase list", () => {
    it("lists only members who still owe an attack, worst first", () => {
      const record = warRecord(
        [
          member("done", { mapPosition: 1 }),
          member("half", { mapPosition: 2 }),
          member("none", { mapPosition: 3 }),
        ],
        [attack("done", 1), attack("done", 2), attack("half", 1)],
      );

      expect(outstandingAttacks(record).map((m) => m.playerId)).toEqual(["none", "half"]);
    });

    it("breaks ties by map position, so it reads like the war map", () => {
      const record = warRecord(
        [member("low", { mapPosition: 9 }), member("high", { mapPosition: 2 })],
        [],
      );
      expect(outstandingAttacks(record).map((m) => m.playerId)).toEqual(["high", "low"]);
    });

    it("is empty when everybody has attacked twice", () => {
      const record = warRecord([member("a")], [attack("a", 1), attack("a", 2)]);
      expect(outstandingAttacks(record)).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("warTotals", () => {
    const war = (result: string | null, ours = 30, theirs = 20): WarRow =>
      ({ result, ourStars: ours, theirStars: theirs }) as WarRow;

    it("counts wins, losses and ties", () => {
      const totals = warTotals([war("win"), war("lose"), war("tie"), war("win")]);
      expect(totals).toMatchObject({ warsPlayed: 4, wins: 2, losses: 1, ties: 1 });
    });

    // A war in preparation has no result. Scoring it as anything — including a
    // loss — is a lie about a war that has not been fought.
    it("ignores a war that has no result yet", () => {
      const totals = warTotals([war("win"), war(null)]);
      expect(totals.warsPlayed).toBe(1);
      expect(totals.stars).toBe(30);
    });

    it("returns zeroes for no wars, rather than dividing by nothing later", () => {
      expect(warTotals([])).toEqual({
        warsPlayed: 0,
        wins: 0,
        losses: 0,
        ties: 0,
        stars: 0,
        starsAgainst: 0,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("planVersusReality (T6.10)", () => {
    const picked = (id: string): LineupMember =>
      ({ playerId: id, name: `Player ${id}` }) as LineupMember;

    it("separates picked-and-played, picked-and-absent, and unpicked", () => {
      const result = planVersusReality(
        [picked("a"), picked("b")],
        [member("a"), member("c")],
      );

      expect(result.playedAsPicked.map((m) => m.playerId)).toEqual(["a"]);
      // The bucket no amount of API data can produce alone: the API cannot
      // report an absence it never knew was expected.
      expect(result.pickedButAbsent.map((m) => m.playerId)).toEqual(["b"]);
      expect(result.playedUnpicked.map((m) => m.playerId)).toEqual(["c"]);
    });

    it("puts everyone in playedUnpicked when no lineup was ever built", () => {
      const result = planVersusReality([], [member("a"), member("b")]);
      expect(result.playedUnpicked).toHaveLength(2);
      expect(result.pickedButAbsent).toEqual([]);
    });

    it("puts everyone in pickedButAbsent when the war never happened", () => {
      const result = planVersusReality([picked("a")], []);
      expect(result.pickedButAbsent.map((m) => m.playerId)).toEqual(["a"]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("targetCompliance (T6.10)", () => {
    // The headline case. Five members assigned targets, one has attacked; a
    // report that folded `unknown` into `ignored` would say four ignored their
    // orders, which is confidently wrong about four people.
    it("reports what cannot be judged as unknown, never as ignored", () => {
      const record = warRecord(
        [member("a"), member("b"), member("c")],
        [attack("a", 1, { defenderPosition: 3 })],
        [target("a", 3), target("b", 4), target("c", 5)],
      );

      const compliance = targetCompliance(record);
      expect(compliance).toEqual({
        judged: 1,
        followed: 1,
        ignored: 0,
        unknown: 2,
        unassigned: 0,
      });
    });

    it("counts an attack on the wrong base as ignored", () => {
      const record = warRecord(
        [member("a")],
        [attack("a", 1, { defenderPosition: 9 })],
        [target("a", 3)],
      );
      expect(targetCompliance(record)).toMatchObject({ judged: 1, ignored: 1, followed: 0 });
    });

    // Attacking without an assignment is not a fault — the plan was incomplete.
    // Counted separately so an unplanned war does not look like a mutiny.
    it("counts an unassigned attacker separately from a disobedient one", () => {
      const record = warRecord([member("a")], [attack("a", 1)]);
      expect(targetCompliance(record)).toMatchObject({ unassigned: 1, ignored: 0, judged: 0 });
    });

    it("ignores a member who neither attacked nor was assigned anything", () => {
      const record = warRecord([member("a")], []);
      expect(targetCompliance(record)).toEqual({
        judged: 0,
        followed: 0,
        ignored: 0,
        unknown: 0,
        unassigned: 0,
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("warContribution (T6.9)", () => {
    it("sums attacks available per war, not across wars they missed", () => {
      const contribution = warContribution([
        { members: [member("a"), member("b")], attacks: [attack("a", 1), attack("a", 2)] },
        { members: [member("a")], attacks: [attack("a", 1)] },
      ]);

      const a = contribution.find((c) => c.playerId === "a")!;
      const b = contribution.find((c) => c.playerId === "b")!;

      expect(a.warsPlayed).toBe(2);
      expect(a.attacksAvailable).toBe(4);
      expect(a.attacksUsed).toBe(3);
      expect(a.attacksMissed).toBe(1);

      // b was in one war of the two. Four available would be the multiplied-out
      // version, and it would report b as having missed four attacks in a war
      // they were never rostered for.
      expect(b.warsPlayed).toBe(1);
      expect(b.attacksAvailable).toBe(2);
      expect(b.attacksMissed).toBe(2);
    });

    it("counts wars a member sat out entirely", () => {
      const contribution = warContribution([
        { members: [member("a")], attacks: [] },
        { members: [member("a")], attacks: [attack("a", 1), attack("a", 2)] },
      ]);
      expect(contribution[0]!.warsMissedEntirely).toBe(1);
    });

    // Reliability above brilliance: the report is used to pick the next lineup,
    // and the missed attack is what loses the war.
    it("sorts fewest missed attacks first, then most stars", () => {
      const contribution = warContribution([
        {
          members: [member("reliable"), member("brilliant")],
          attacks: [
            attack("reliable", 1, { stars: 1 }),
            attack("reliable", 2, { stars: 1 }),
            attack("brilliant", 1, { stars: 3 }),
          ],
        },
      ]);

      expect(contribution.map((c) => c.playerId)).toEqual(["reliable", "brilliant"]);
    });

    it("only counts target compliance where it could be judged", () => {
      const contribution = warContribution([
        {
          members: [member("a")],
          attacks: [attack("a", 1, { defenderPosition: 3 })],
          targets: [target("a", 3)],
        },
        { members: [member("a")], attacks: [], targets: [target("a", 5)] },
      ]);

      expect(contribution[0]!.targetsJudged).toBe(1);
      expect(contribution[0]!.targetsFollowed).toBe(1);
    });

    it("returns nothing for no wars", () => {
      expect(warContribution([])).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  describe("enemyBoard (T6.3)", () => {
    const opponent = (position: number, th = 15): WarOpponentRow => ({
      tag: `#OPP${position}`,
      name: `Opponent ${position}`,
      mapPosition: position,
      thLevel: th,
    });

    it("names every base and marks the free ones", () => {
      const board = enemyBoard(3, [opponent(1), opponent(2), opponent(3)], [], [member("a")]);

      expect(board.map((b) => b.position)).toEqual([1, 2, 3]);
      expect(board[0]!.name).toBe("Opponent 1");
      expect(board.every((b) => b.free)).toBe(true);
    });

    // A base with no roster row must still appear. The leader assigns by
    // position, and an omitted base 3 is an unassignable base 3 — with the gap
    // looking like a smaller war rather than missing data.
    it("shows a base the sync has no roster row for", () => {
      const board = enemyBoard(3, [opponent(1)], [], []);

      expect(board).toHaveLength(3);
      expect(board[2]!.name).toBeNull();
      expect(board[2]!.position).toBe(3);
    });

    // Best, not latest and not summed. Two members on one base gives that base
    // one score, and the game scores it as the best of them.
    it("takes the BEST result on a base that was hit twice", () => {
      const board = enemyBoard(
        1,
        [opponent(1)],
        [
          attack("a", 1, { defenderPosition: 1, stars: 3, destruction: 100 }),
          attack("b", 1, { defenderPosition: 1, stars: 1, destruction: 45 }),
        ],
        [member("a"), member("b", { mapPosition: 2 })],
      );

      expect(board[0]!.bestStars).toBe(3);
      expect(board[0]!.bestDestruction).toBe(100);
      expect(board[0]!.attackedBy.map((a) => a.playerId)).toEqual(["a", "b"]);
      expect(board[0]!.free).toBe(false);
    });

    it("reports an untouched base as having no result rather than zero stars", () => {
      const board = enemyBoard(1, [opponent(1)], [], [member("a")]);
      // Zero would read as "somebody attacked and failed", which is a different
      // and much worse thing to tell a leader.
      expect(board[0]!.bestStars).toBeNull();
    });

    it("marks a base as taken once somebody is assigned to it", () => {
      const board = enemyBoard(2, [opponent(1), opponent(2)], [], [member("a")], [target("a", 2)]);

      expect(board[0]!.free).toBe(true);
      expect(board[1]!.free).toBe(false);
      expect(board[1]!.assignedTo.map((m) => m.name)).toEqual(["Player a"]);
    });

    // An attack the sync could not place belongs to no base. Bucketing it into
    // base 0 would show an attack on a base that does not exist.
    it("drops an attack whose defender position could not be resolved", () => {
      const board = enemyBoard(
        1,
        [opponent(1)],
        [attack("a", 1, { defenderPosition: null })],
        [member("a")],
      );
      expect(board[0]!.attackedBy).toEqual([]);
      expect(board[0]!.free).toBe(true);
    });
  });

  describe("isComparable", () => {
    it("needs a published lineup — a draft was never shown to anybody", () => {
      expect(isComparable(null)).toBe(false);
      expect(isComparable({ status: "draft" } as never)).toBe(false);
      expect(isComparable({ status: "published" } as never)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The repository against real Postgres, as the roles that call it.
//
// The schema test (war-schema.test.ts) proves the FUNCTIONS. This proves the
// code path a page actually takes to reach them — including that a refusal
// arrives as an error rather than as a silent no-op, which is the one way a
// definer function can lie to a page.
// ─────────────────────────────────────────────────────────────────────────────

const CLAN_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const CLAN_B = "bbbbbbbb-0000-4000-8000-0000000000bb";
const LEADER_A = "11111111-0000-4000-8000-0000000000a1";
const MEMBER_A = "22222222-0000-4000-8000-0000000000a2";
const PLAYER_A = "aaaaaaaa-0000-4000-8000-00000000f001";
const PLAYER_A2 = "aaaaaaaa-0000-4000-8000-00000000f002";
const WAR_A = "99999999-0000-4000-8000-0000000000a1";
const WAR_B = "99999999-0000-4000-8000-0000000000b1";

describe("repositories/war — against real Postgres", () => {
  let h: Harness;
  let client: SupabaseClient;

  beforeAll(async () => {
    h = await createHarness();
    client = createPgliteSupabase(h.db);
  });
  afterAll(async () => {
    await h?.close();
  });

  beforeEach(async () => {
    await h.asSuperuser();
    await h.db.exec(`
      truncate war_attacks, war_targets, war_members, war_lineup_members,
               war_lineups, wars, clan_roles, players, users, clans cascade;
      delete from auth.users;

      insert into auth.users (id, email) values
        ('${LEADER_A}', 'leader-a@example.com'),
        ('${MEMBER_A}', 'member-a@example.com');

      insert into users (id, email, status) values
        ('${LEADER_A}', 'leader-a@example.com', 'approved'),
        ('${MEMBER_A}', 'member-a@example.com', 'approved');

      insert into clans (id, tag, name) values
        ('${CLAN_A}', '#2PP0JCCL', 'Clan A'),
        ('${CLAN_B}', '#8QUCLJY0', 'Clan B');

      insert into clan_roles (user_id, clan_id, role) values
        ('${LEADER_A}', '${CLAN_A}', 'leader'),
        ('${MEMBER_A}', '${CLAN_A}', 'member');

      insert into players (id, clan_id, user_id, tag, name, th_level) values
        ('${PLAYER_A}',  '${CLAN_A}', '${MEMBER_A}', '#PY0LQGRJ', 'Member A',  16),
        ('${PLAYER_A2}', '${CLAN_A}', null,          '#PY0LQGRC', 'Member A2', 15);

      insert into wars (id, clan_id, opponent_name, team_size, state, our_stars,
                        their_stars, our_destruction, their_destruction, result, start_time)
      values
        ('${WAR_A}', '${CLAN_A}', 'Them', 2, 'inWar', 5, 3, 87.40, 61.20, 'win',
         '2026-07-29T06:00:00Z'),
        ('${WAR_B}', '${CLAN_B}', 'Others', 2, 'inWar', 1, 0, 10.00, 0.00, 'win',
         '2026-07-29T06:00:00Z');

      insert into war_members (war_id, player_id, map_position, th_level, attacks_allowed)
      values
        ('${WAR_A}', '${PLAYER_A}',  1, 16, 2),
        ('${WAR_A}', '${PLAYER_A2}', 2, 15, 2);

      insert into war_attacks (war_id, player_id, attack_order, stars, destruction,
                               defender_tag, defender_position)
      values ('${WAR_A}', '${PLAYER_A}', 1, 3, 100.00, '#C2V89UGL', 2);
    `);
  });

  describe("reads", () => {
    it("returns this clan's wars and never another's (R3)", async () => {
      await h.asUser(MEMBER_A);
      const wars = await warsForClan(client, CLAN_A);

      expect(wars.map((w) => w.id)).toEqual([WAR_A]);
      expect(wars[0]!.opponentName).toBe("Them");
    });

    // numeric(5,2) arrives from the driver as a string. Every consumer would
    // otherwise be comparing "87.40" against a number and quietly failing.
    it("returns destruction as a number, not a numeric string", async () => {
      await h.asUser(MEMBER_A);
      const war = (await currentWar(client, CLAN_A))!;
      expect(war.ourDestruction).toBe(87.4);
      expect(typeof war.ourDestruction).toBe("number");
    });

    // The filter that makes every child read below safe: a war id typed into
    // the URL from another clan resolves to nothing and goes no further.
    it("refuses to resolve another clan's war by id", async () => {
      await h.asUser(MEMBER_A);
      expect(await warById(client, CLAN_A, WAR_B)).toBeNull();
    });

    it("returns the roster with names and the attacks-allowed denominator", async () => {
      await h.asUser(MEMBER_A);
      const members = await membersOfWar(client, WAR_A);

      expect(members.map((m) => m.name)).toEqual(["Member A", "Member A2"]);
      expect(members[0]!.attacksAllowed).toBe(2);
      // The TH at the time of the war, from war_members, not today's from players.
      expect(members[0]!.thLevel).toBe(16);
    });

    it("returns the attacks with their resolved defender position", async () => {
      await h.asUser(MEMBER_A);
      const attacks = await attacksForWar(client, WAR_A);

      expect(attacks).toHaveLength(1);
      expect(attacks[0]!.defenderPosition).toBe(2);
      expect(attacks[0]!.destruction).toBe(100);
    });
  });

  describe("target writes through the definer functions", () => {
    it("lets leadership assign, and reads the plan back", async () => {
      await h.asUser(LEADER_A);
      expect(await assignTarget(client, WAR_A, PLAYER_A, 3, "hit the AQ")).toEqual({});

      const targets = await targetsForWar(client, WAR_A);
      expect(targets).toHaveLength(1);
      expect(targets[0]!.targetPosition).toBe(3);
      expect(targets[0]!.note).toBe("hit the AQ");
    });

    // The one way a definer function can lie to a page. These functions raise
    // for a refusal and return false for a decline; a repository that inspected
    // only `error` would report success on a write that never happened.
    it("surfaces a refusal as an error rather than a silent success", async () => {
      await h.asUser(MEMBER_A);
      const result = await assignTarget(client, WAR_A, PLAYER_A, 3, null);

      expect(result.error).toBeTruthy();
      expect(result.error).toMatch(/only a leader or co-leader/i);
      expect(await targetsForWar(client, WAR_A)).toHaveLength(0);
    });

    it("lets a member claim a free base for themselves (025)", async () => {
      await h.asUser(MEMBER_A);
      expect(await claimTarget(client, WAR_A, 4)).toEqual({});

      const targets = await targetsForWar(client, WAR_A);
      expect(targets).toHaveLength(1);
      // Resolved from auth.uid() inside the function — the repository has no
      // parameter through which to claim for anybody else.
      expect(targets[0]!.playerId).toBe(PLAYER_A);
      expect(targets[0]!.targetPosition).toBe(4);
    });

    it("refuses a claim on a base somebody else holds", async () => {
      await h.asUser(LEADER_A);
      await assignTarget(client, WAR_A, PLAYER_A2, 4, null);

      await h.asUser(MEMBER_A);
      const result = await claimTarget(client, WAR_A, 4);
      expect(result.error).toMatch(/already taken/i);
    });

    it("releases a claim, and clears an assignment, both softly (R4)", async () => {
      await h.asUser(MEMBER_A);
      await claimTarget(client, WAR_A, 4);
      expect(await releaseTarget(client, WAR_A)).toEqual({});
      expect(await targetsForWar(client, WAR_A)).toHaveLength(0);

      await h.asUser(LEADER_A);
      await assignTarget(client, WAR_A, PLAYER_A2, 5, null);
      expect(await clearTarget(client, WAR_A, PLAYER_A2)).toEqual({});
      expect(await targetsForWar(client, WAR_A)).toHaveLength(0);

      // Nothing was deleted — both rows are still there, soft-deleted.
      await h.asSuperuser();
      const rows = await h.db.query<{ n: number }>(
        `select count(*)::int as n from war_targets where deleted_at is not null`,
      );
      expect(rows.rows[0]!.n).toBe(2);
    });
  });

  describe("lineups", () => {
    it("has no lineup for a war nobody linked one to", async () => {
      await h.asUser(LEADER_A);
      expect(await lineupForWar(client, CLAN_A, WAR_A)).toBeNull();
    });
  });
});
