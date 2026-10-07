import { describe, expect, it } from "vitest";
import type {
  WarMemberRow,
  WarOpponentAttackRow,
  WarOpponentRow,
  WarRatingAttackRow,
} from "@/repositories/war";
import { monthWarRating, warBoard, warRating, type WarBoard } from "./war-rating";

/** One of ours at base `n`, Town Hall 17 unless said. */
function member(n: number, th = 17, attacksAllowed = 2): WarMemberRow {
  return { playerId: `p${n}`, tag: `#U${n}`, name: `Us ${n}`, mapPosition: n, thLevel: th, attacksAllowed };
}

/** One of theirs at base `n`. */
function foe(n: number, th = 17): WarOpponentRow {
  return { tag: `#F${n}`, name: `Foe ${n}`, mapPosition: n, thLevel: th };
}

/** Player `n`'s `which` attack (1 or 2) on their base `target`. */
function attack(
  n: number,
  which: number,
  target: number,
  stars: number,
  options: { destruction?: number; warOrder?: number | null } = {},
): WarRatingAttackRow {
  return {
    playerId: `p${n}`,
    attackOrder: which,
    stars,
    destruction: options.destruction ?? (stars === 3 ? 100 : 60),
    defenderTag: `#F${target}`,
    defenderPosition: target,
    warOrder: options.warOrder === undefined ? n * 10 + which : options.warOrder,
  };
}

/** Their base `by` attacking our base `on`. */
function hit(by: number, on: number, stars: number, destruction?: number): WarOpponentAttackRow {
  return {
    attackerTag: `#F${by}`,
    attackOrder: 1,
    defenderTag: `#U${on}`,
    stars,
    destruction: destruction ?? (stars === 3 ? 100 : 50),
    warOrder: null,
  };
}

/** A war of `size` bases a side, everyone at Town Hall 17. */
function board(
  size: number,
  attacks: WarRatingAttackRow[],
  options: { hits?: WarOpponentAttackRow[]; defenceKnown?: boolean; members?: WarMemberRow[] } = {},
): WarBoard {
  const numbers = Array.from({ length: size }, (_, i) => i + 1);
  return warBoard({
    members: options.members ?? numbers.map((n) => member(n)),
    attacks,
    opponents: numbers.map((n) => foe(n)),
    opponentAttacks: options.hits ?? [],
    defenceKnown: options.defenceKnown ?? true,
    teamSize: size,
  });
}

const player = (rating: ReturnType<typeof warRating>, n: number) => rating.players.find((p) => p.name === `Us ${n}`)!;
const lines = (rating: ReturnType<typeof warRating>, n: number, which: number) =>
  player(rating, n).attacks[which - 1]!.lines;

describe("two attacks", () => {
  // Our #5 and #6 both use both attacks; nobody else attacks. Enemy hits every
  // base once for 3 stars from its mirror, so defence is 0 and stays out of the way.
  const everyHit = Array.from({ length: 10 }, (_, i) => hit(i + 1, i + 1, 3));

  it("scores each, adds them, and counts the better one 1.5 times", () => {
    // #6 on their #1: 5 + 5 up + 1 + rank 5.2 + same TH 1 = 17.2, and the heroic +4 = 21.2.
    // #6 on their #6: 5 + mirror 1 + rank (1 + 4.2 × 4/9) + 1.
    const rated = warRating(board(10, [attack(6, 1, 1, 3), attack(6, 2, 6, 3)], { hits: everyHit }), "inWar");
    const p = player(rated, 6);
    expect(p.attacks.map((a) => a.marks)).toEqual([21.2, 9.9]);
    expect(p.attacks.map((a) => a.best)).toEqual([true, false]);
    expect(p.bonus).toEqual({ label: "Best attack × 1.5", marks: 10.6 });
    expect(p.attackMarks).toBe(41.7);
  });

  it("gives no bonus when the better attack is not above zero", () => {
    const rated = warRating(board(10, [attack(5, 1, 5, 1), attack(5, 2, 5 + 1, 0)], { hits: everyHit }), "inWar");
    const p = player(rated, 5);
    // 1★ on the mirror: −3 + 1 + 1 = −1. 0★ a base below: −10 − 1 − 10 + 1 = −20.
    expect(p.attacks.map((a) => a.marks)).toEqual([-1, -20]);
    expect(p.bonus).toBeNull();
    expect(p.attacks.some((a) => a.best)).toBe(false);
    expect(p.attackMarks).toBe(-21);
  });

  it("counts the first as the better one when the two are level", () => {
    // Our #12 takes two stars from their #1 and their #2: eleven and ten bases
    // up, both counted as 10, so 1 + 10 + 1 − 0.5 + 1 each. Our #1's three stars
    // take the heroic attack, which would otherwise split them.
    const rated = warRating(
      board(12, [attack(12, 1, 1, 2), attack(12, 2, 2, 2), attack(1, 1, 3, 3)]),
      "inWar",
    );
    const p = player(rated, 12);
    expect(p.attacks.map((a) => a.marks)).toEqual([12.5, 12.5]);
    expect(p.attacks.map((a) => a.best)).toEqual([true, false]);
    expect(p.bonus?.marks).toBe(6.3);
  });

  it("takes 10 for each attack not used — once the war is over, not while it runs", () => {
    const one = [attack(5, 1, 5, 3)];
    const over = warRating(board(10, one, { hits: everyHit }), "warEnded");
    expect(player(over, 5).missed).toEqual({ label: "1 attack not used", marks: -10 });
    expect(player(over, 6).missed).toEqual({ label: "2 attacks not used", marks: -20 });
    expect(player(over, 6).marks).toBe(-20);

    const running = warRating(board(10, one, { hits: everyHit }), "inWar");
    expect(player(running, 5).missed).toBeNull();
    expect(player(running, 6).marks).toBe(0);
  });

  it("reads how many attacks a member had from the war, not from a constant", () => {
    const members = [member(1, 17, 1), member(2), member(3)];
    const rated = warRating(board(3, [], { members, hits: [hit(1, 1, 3), hit(2, 2, 3), hit(3, 3, 3)] }), "warEnded");
    expect(player(rated, 1).missed).toEqual({ label: "1 attack not used", marks: -10 });
    expect(player(rated, 2).missed).toEqual({ label: "2 attacks not used", marks: -20 });
  });
});

describe("the same base hit by several of ours", () => {
  it("keeps full marks for an attack that adds a star", () => {
    // Our #5 takes two stars from their #5 first; our #6 then triples it.
    const rated = warRating(
      board(10, [attack(5, 1, 5, 2, { warOrder: 3 }), attack(6, 1, 5, 3, { warOrder: 9 })]),
      "inWar",
    );
    expect(lines(rated, 6, 1)[0]).toEqual({ label: "3 stars", marks: 5 });
    // …and everything for hitting up with it.
    expect(lines(rated, 6, 1)).toContainEqual({ label: "1 base up", marks: 1 });
    expect(lines(rated, 6, 1).some((l) => l.label.startsWith("Their #5 of 10"))).toBe(true);
  });

  it("gives an attack that adds no new star no star marks and nothing for hitting up", () => {
    const rated = warRating(
      board(10, [attack(5, 1, 5, 3, { warOrder: 3 }), attack(6, 1, 5, 3, { warOrder: 9 })]),
      "inWar",
    );
    expect(lines(rated, 6, 1)).toEqual([
      { label: "3 stars, none new", marks: 0 },
      { label: "1 base up, no new star", marks: 0 },
      { label: "Mirror or above", marks: 1 },
      { label: "Same TH", marks: 1 },
    ]);
    // The one who was there first is untouched by it.
    expect(lines(rated, 5, 1)[0]).toEqual({ label: "3 stars", marks: 5 });
  });

  it("goes by the order of the war, not by who is listed first", () => {
    const rated = warRating(
      board(10, [attack(5, 1, 5, 3, { warOrder: 9 }), attack(6, 1, 5, 3, { warOrder: 3 })]),
      "inWar",
    );
    expect(lines(rated, 5, 1)[0]).toEqual({ label: "3 stars, none new", marks: 0 });
    expect(lines(rated, 6, 1)[0]).toEqual({ label: "3 stars", marks: 5 });
  });

  it("scores each as a first hit when the order was never recorded, and says so", () => {
    const rated = warRating(
      board(10, [attack(5, 1, 5, 3, { warOrder: null }), attack(6, 1, 5, 3, { warOrder: null })]),
      "inWar",
    );
    expect(lines(rated, 5, 1)[0]).toEqual({ label: "3 stars", marks: 5 });
    expect(lines(rated, 6, 1)[0]).toEqual({ label: "3 stars", marks: 5 });
    expect(rated.orderMissing).toBe(true);
    // A base hit once needs no order to know nothing was taken before.
    expect(warRating(board(10, [attack(5, 1, 5, 3, { warOrder: null })]), "inWar").orderMissing).toBe(false);
  });
});

describe("the target's place on their map", () => {
  const rank = (size: number, target: number) => {
    const rated = warRating(board(size, [attack(target, 1, target, 3)]), "inWar");
    return lines(rated, target, 1).find((l) => l.label.startsWith("Their #"));
  };

  it("is +1 for their last base and +5.2 for their first, whatever the war's size", () => {
    for (const size of [5, 15, 30, 40, 50]) {
      expect(rank(size, size)).toEqual({ label: `Their #${size} of ${size}`, marks: 1 });
      expect(rank(size, 1)).toEqual({ label: `Their #1 of ${size}`, marks: 5.2 });
    }
  });

  it("spaces the bases evenly between", () => {
    // 40 bases: 4.2 over 39 steps. Their #20 is 20 steps from the bottom.
    expect(rank(40, 20)?.marks).toBe(3.2);
    expect(rank(15, 8)?.marks).toBe(3.1);
  });
});

describe("defence", () => {
  it("scores the enemy's best hit on a base, and the war's heroic defence", () => {
    const rated = warRating(
      board(3, [], { hits: [hit(1, 1, 1, 40), hit(2, 1, 0, 20), hit(3, 2, 3), hit(1, 3, 2, 80)] }),
      "inWar",
    );
    expect(player(rated, 1).defence).toEqual([
      { label: "Held to 1 star", marks: 5 },
      { label: "Heroic defence", marks: 5 },
    ]);
    // 3-starred by their #3, a lower base than our #2.
    expect(player(rated, 2).defence).toEqual([
      { label: "3-starred", marks: 0 },
      { label: "By their #3, a lower base", marks: -0.5 },
    ]);
    // Two stars lost to their #1, a higher base than our #3.
    expect(player(rated, 3).defence).toEqual([
      { label: "Held to 2 stars", marks: 3 },
      { label: "By their #1, a higher base", marks: 0.5 },
    ]);
    expect(rated.attackOnly).toBe(false);
  });

  it("gives a base nobody attacked +2 once the war is over", () => {
    const rated = warRating(board(3, [], { hits: [hit(1, 1, 3)] }), "warEnded");
    expect(player(rated, 2).defence).toEqual([{ label: "Not attacked", marks: 2 }]);
  });

  it("has no defence marks at all for a war whose enemy attacks were never recorded", () => {
    const rated = warRating(board(3, [attack(1, 1, 1, 3)], { defenceKnown: false, hits: [hit(1, 1, 0)] }), "warEnded");
    expect(rated.attackOnly).toBe(true);
    expect(rated.players.every((p) => p.defence.length === 0 && !p.heroicDefence)).toBe(true);
    // Not even the +2 for a base left alone: nobody looked.
    expect(player(rated, 2).marks).toBe(-20);
  });
});

describe("warRating", () => {
  it("gives the heroic attack to exactly one attack of the war", () => {
    const rated = warRating(board(10, [attack(1, 1, 1, 3), attack(1, 2, 2, 3), attack(2, 1, 3, 3)]), "inWar");
    const heroic = rated.players.flatMap((p) => p.attacks).filter((a) => a.lines.some((l) => l.label === "Heroic attack"));
    expect(heroic).toHaveLength(1);
    expect(rated.players.filter((p) => p.heroicAttack).map((p) => p.name)).toEqual(["Us 1"]);
  });

  it("shares out the plus marks only, and never worse than −100%", () => {
    const rated = warRating(board(3, [attack(1, 1, 1, 3), attack(1, 2, 2, 3)], { defenceKnown: false }), "warEnded");
    expect(rated.players.map((p) => p.marks > 0)).toEqual([true, false, false]);
    expect(rated.total).toBe(player(rated, 1).marks);
    expect(player(rated, 1).share).toBe(100);
    // −20 of a plus total a little over 30 — well inside the floor.
    expect(player(rated, 2).share).toBeCloseTo((-20 / rated.total) * 100, 6);

    const bad = warRating(board(3, [attack(1, 1, 1, 2)], { defenceKnown: false }), "warEnded");
    // 2★ mirror same TH 3, heroic +4, × 1.5, one attack unused −10: 0.5 above zero.
    expect(player(bad, 1).marks).toBe(0.5);
    expect(player(bad, 2).share).toBe(-100);
  });

  it("is not started in preparation, provisional on battle day, counted once over", () => {
    const b = board(3, [attack(1, 1, 1, 3)]);
    expect(warRating(b, "preparation")).toMatchObject({ status: "notStarted", players: [] });
    expect(warRating(b, "inWar").status).toBe("provisional");
    expect(warRating(b, "warEnded").status).toBe("counted");
  });
});

describe("monthWarRating", () => {
  const war = (id: string, state: string, attacks: WarRatingAttackRow[], size = 3) => ({
    id,
    startTime: `2026-09-${id}T18:30:00.000Z`,
    opponentName: `Rival ${id}`,
    state,
    board: board(size, attacks, { defenceKnown: false }),
  });

  const month = monthWarRating([
    war("11", "warEnded", [attack(1, 1, 1, 3), attack(1, 2, 2, 3), attack(2, 1, 3, 2), attack(2, 2, 1, 2)]),
    war("13", "warEnded", [attack(1, 1, 1, 3), attack(1, 2, 2, 3)]),
    war("15", "inWar", [attack(3, 1, 3, 3)]),
  ]);

  it("adds up the shares of the finished wars, and leaves the one being fought out", () => {
    const us1 = month.players.find((p) => p.name === "Us 1")!;
    expect(us1.warsCounted).toBe(2);
    expect(us1.rating).toBeCloseTo(us1.wars[0]!.share + us1.wars[1]!.share, 6);
    expect(us1.perWar).toBeCloseTo(us1.rating / 2, 6);
    expect(us1.provisional?.marks).toBe(0);

    const us3 = month.players.find((p) => p.name === "Us 3")!;
    expect(us3.provisional?.share).toBe(100);
    // Two finished wars with both attacks unused.
    expect(us3.marks).toBe(-40);
  });

  it("ranks by rating and heads each war with what it was", () => {
    expect(month.players.map((p) => p.name)).toEqual(["Us 1", "Us 2", "Us 3"]);
    expect(month.wars.map((w) => [w.id, w.status, w.attackOnly])).toEqual([
      ["11", "counted", true],
      ["13", "counted", true],
      ["15", "provisional", true],
    ]);
    expect(month.started).toBe(true);
  });

  it("averages destruction over every attack of the finished wars", () => {
    const us2 = month.players.find((p) => p.name === "Us 2")!;
    expect(us2.averageDestruction).toBe(60);
    expect(month.players.find((p) => p.name === "Us 3")!.averageDestruction).toBeNull();
  });
});
