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

/**
 * Player `n`'s `which` attack (1 or 2) on their base `target`. The order of
 * the war defaults to the player then the attack, so lower numbers go first.
 */
function attack(
  n: number,
  which: number,
  target: number,
  stars: number,
  options: { destruction?: number; warOrder?: number | null; seenAt?: string | null } = {},
): WarRatingAttackRow {
  return {
    playerId: `p${n}`,
    attackOrder: which,
    stars,
    destruction: options.destruction ?? (stars === 3 ? 100 : 60),
    defenderTag: `#F${target}`,
    defenderPosition: target,
    warOrder: options.warOrder === undefined ? n * 10 + which : options.warOrder,
    seenAt: options.seenAt ?? null,
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

type Rated = ReturnType<typeof warRating>;
const player = (rated: Rated, n: number) => rated.players.find((p) => p.name === `Us ${n}`)!;
const lines = (rated: Rated, n: number, which: number) => player(rated, n).attacks[which - 1]!.lines;
/** Which of player `n`'s attacks are the best on their enemy base. */
const best = (rated: Rated, n: number) => player(rated, n).attacks.map((a) => a.best);

/** Every base hit once for 3 stars by its mirror: defence is 0 and out of the way. */
const mirrored = (size: number) => Array.from({ length: size }, (_, i) => hit(i + 1, i + 1, 3));

describe("two attacks", () => {
  it("scores each attack and adds them", () => {
    // Our #6 on their #2: 5 + 4 up + 1 + rank 1.8 + same TH 1, and the heroic +4.
    // Our #6 on their #6: 5 + mirror 1 + rank 1.4 + 1.
    const rated = warRating(board(10, [attack(6, 1, 2, 3), attack(6, 2, 6, 3)], { hits: mirrored(10) }), "inWar");
    const p = player(rated, 6);
    expect(p.attacks.map((a) => a.marks)).toEqual([16.8, 8.4]);
    // Each is the only attack on its base, so each is the best there.
    expect(p.attacks.map((a) => a.bonus?.marks)).toEqual([8.4, 4.2]);
    expect(p.attackMarks).toBe(37.8);
  });

  it("takes 4 for an attack that got no star, where CWL takes 10", () => {
    const rated = warRating(board(10, [attack(5, 1, 5, 0)], { hits: mirrored(10) }), "inWar");
    expect(lines(rated, 5, 1)).toEqual([
      { label: "0 stars", marks: -4 },
      { label: "Mirror", marks: 1 },
      { label: "Same TH", marks: 1 },
    ]);
    // The other results are CWL's.
    const of = (stars: number) => lines(warRating(board(10, [attack(5, 1, 5, stars)]), "inWar"), 5, 1)[0]!.marks;
    expect([3, 2, 1].map(of)).toEqual([5, 1, -3]);
  });

  it("takes 4 for each attack not used — once the war is over, not while it runs", () => {
    const one = [attack(5, 1, 5, 3)];
    const over = warRating(board(10, one, { hits: mirrored(10) }), "warEnded");
    expect(player(over, 5).missed).toEqual({ label: "1 attack not used", marks: -4 });
    expect(player(over, 6).missed).toEqual({ label: "2 attacks not used", marks: -8 });
    expect(player(over, 6).marks).toBe(-8);

    const running = warRating(board(10, one, { hits: mirrored(10) }), "inWar");
    expect(player(running, 5).missed).toBeNull();
    expect(player(running, 6).marks).toBe(0);
  });

  it("reads how many attacks a member had from the war, not from a constant", () => {
    const members = [member(1, 17, 1), member(2), member(3)];
    const rated = warRating(board(3, [], { members, hits: mirrored(3) }), "warEnded");
    expect(player(rated, 1).missed).toEqual({ label: "1 attack not used", marks: -4 });
    expect(player(rated, 2).missed).toEqual({ label: "2 attacks not used", marks: -8 });
  });
});

describe("the best attack on each enemy base", () => {
  it("is the one with the most stars", () => {
    // Our #5 takes two stars from their #5; our #6 then triples it.
    const rated = warRating(
      board(10, [attack(5, 1, 5, 2, { warOrder: 3 }), attack(6, 1, 5, 3, { warOrder: 9 })]),
      "inWar",
    );
    expect(best(rated, 5)).toEqual([false]);
    expect(best(rated, 6)).toEqual([true]);
    expect(player(rated, 5).attacks[0]!.bonus).toBeNull();
    expect(player(rated, 6).attacks[0]!.bonus?.label).toBe("Best attack on their #5 × 1.5");
  });

  it("is the FIRST of two with the same stars: the second found the base already cleared", () => {
    const first = warRating(
      board(10, [attack(5, 1, 5, 3, { warOrder: 3 }), attack(6, 1, 5, 3, { warOrder: 9 })]),
      "inWar",
    );
    expect([best(first, 5), best(first, 6)]).toEqual([[true], [false]]);

    // The other way round, whoever is listed first.
    const second = warRating(
      board(10, [attack(5, 1, 5, 3, { warOrder: 9 }), attack(6, 1, 5, 3, { warOrder: 3 })]),
      "inWar",
    );
    expect([best(second, 5), best(second, 6)]).toEqual([[false], [true]]);
  });

  it("is the first even when a later one with the same stars destroyed more", () => {
    const rated = warRating(
      board(10, [
        attack(5, 1, 5, 2, { warOrder: 3, destruction: 55 }),
        attack(6, 1, 5, 2, { warOrder: 9, destruction: 95 }),
      ]),
      "inWar",
    );
    expect([best(rated, 5), best(rated, 6)]).toEqual([[true], [false]]);
  });

  it("is the only attack on a base that was attacked once", () => {
    const rated = warRating(board(10, [attack(5, 1, 5, 3)]), "inWar");
    expect(best(rated, 5)).toEqual([true]);
  });

  it("is per enemy base, not per player: both of a player's attacks, or neither", () => {
    // Our #6 opens their #2 and #3 with two stars each; our #7 then clears both.
    const rated = warRating(
      board(10, [
        attack(6, 1, 2, 2, { warOrder: 1 }),
        attack(6, 2, 3, 2, { warOrder: 2 }),
        attack(7, 1, 2, 3, { warOrder: 5 }),
        attack(7, 2, 3, 3, { warOrder: 6 }),
      ]),
      "inWar",
    );
    expect(best(rated, 6)).toEqual([false, false]);
    expect(best(rated, 7)).toEqual([true, true]);
    expect(player(rated, 7).attacks.every((a) => a.bonus !== null)).toBe(true);
  });

  it("is exactly one for every enemy base that was attacked", () => {
    const attacks = [
      attack(1, 1, 1, 3),
      attack(1, 2, 4, 1),
      attack(2, 1, 1, 3),
      attack(2, 2, 4, 2),
      attack(3, 1, 4, 2),
      attack(3, 2, 9, 0),
      attack(4, 1, 1, 2),
    ];
    const rated = warRating(board(10, attacks), "inWar");
    const bestOn = new Map<string, number>();
    for (const p of rated.players) {
      for (const a of p.attacks) if (a.best) bestOn.set(a.target!.tag, (bestOn.get(a.target!.tag) ?? 0) + 1);
    }
    expect([...bestOn.entries()].sort()).toEqual([
      ["#F1", 1],
      ["#F4", 1],
      ["#F9", 1],
    ]);
    // Their #1: our #1 was first to three. Their #4: our #2 was first to two.
    expect([best(rated, 1), best(rated, 2), best(rated, 3), best(rated, 4)]).toEqual([
      [true, false],
      [false, true],
      [false, true],
      [false],
    ]);
  });

  it("counts 1.5 times only when the attack is above zero", () => {
    // One star on the mirror: −3 + 1 + 1. The best attack on that base, and worth no more for it.
    const rated = warRating(board(10, [attack(5, 1, 5, 1)]), "inWar");
    expect(player(rated, 5).attacks[0]).toMatchObject({ marks: -1, best: true, bonus: null });
    expect(player(rated, 5).attackMarks).toBe(-1);
  });
});

describe("who was first, in a war from before the order was recorded", () => {
  const at = (hour: number) => `2026-09-10T${String(hour).padStart(2, "0")}:00:00.000Z`;

  it("goes by when the sync first saw each attack", () => {
    // Listed first, seen second.
    const rated = warRating(
      board(10, [
        attack(5, 1, 5, 3, { warOrder: null, seenAt: at(12) }),
        attack(6, 1, 5, 3, { warOrder: null, seenAt: at(10) }),
      ]),
      "inWar",
    );
    expect([best(rated, 5), best(rated, 6)]).toEqual([[false], [true]]);
    expect(lines(rated, 5, 1)[0]).toEqual({ label: "3 stars, none new", marks: 0 });
    expect(lines(rated, 6, 1)[0]).toEqual({ label: "3 stars", marks: 5 });
    expect(rated.orderMissing).toBe(false);
  });

  it("cannot tell two attacks seen in the same run apart: the higher destruction, then the lower base", () => {
    const together = { warOrder: null, seenAt: at(10) };
    const level = warRating(board(10, [attack(5, 1, 5, 3, together), attack(6, 1, 5, 3, together)]), "inWar");
    // Neither is scored as having seen the other…
    expect(lines(level, 5, 1)[0]).toEqual({ label: "3 stars", marks: 5 });
    expect(lines(level, 6, 1)[0]).toEqual({ label: "3 stars", marks: 5 });
    // …and there is still only one best attack: our #6, the lower base.
    expect([best(level, 5), best(level, 6)]).toEqual([[false], [true]]);
    expect(level.orderMissing).toBe(true);

    const uneven = warRating(
      board(10, [
        attack(5, 1, 5, 2, { ...together, destruction: 90 }),
        attack(6, 1, 5, 2, { ...together, destruction: 70 }),
      ]),
      "inWar",
    );
    expect([best(uneven, 5), best(uneven, 6)]).toEqual([[true], [false]]);
  });

  it("does the same with no order and no time at all", () => {
    const unknown = { warOrder: null, seenAt: null };
    const rated = warRating(board(10, [attack(5, 1, 5, 3, unknown), attack(6, 1, 5, 3, unknown)]), "inWar");
    expect(lines(rated, 5, 1)[0]).toEqual({ label: "3 stars", marks: 5 });
    expect([best(rated, 5), best(rated, 6)]).toEqual([[false], [true]]);
    expect(rated.orderMissing).toBe(true);
    // A base hit once needs no order to know nothing was taken before.
    expect(warRating(board(10, [attack(5, 1, 5, 3, unknown)]), "inWar").orderMissing).toBe(false);
  });
});

describe("the same base hit by several of ours", () => {
  it("keeps full marks for an attack that adds a star", () => {
    const rated = warRating(
      board(10, [attack(5, 1, 5, 2, { warOrder: 3 }), attack(6, 1, 5, 3, { warOrder: 9 })]),
      "inWar",
    );
    expect(lines(rated, 6, 1)[0]).toEqual({ label: "3 stars", marks: 5 });
    // …and everything for hitting up with it.
    expect(lines(rated, 6, 1)).toContainEqual({ label: "1 base up", marks: 1 });
    expect(lines(rated, 6, 1)).toContainEqual({ label: "Their #5 of 10", marks: 1.5 });
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
});

describe("the target's place on their map", () => {
  const rank = (size: number, target: number, stars = 3) => {
    const rated = warRating(board(size, [attack(target, 1, target, stars)]), "inWar");
    return lines(rated, target, 1).find((l) => l.label.startsWith("Their #"));
  };

  it("is +1 for their last base, whatever the war's size", () => {
    for (const size of [5, 20, 40, 50]) {
      expect(rank(size, size)).toEqual({ label: `Their #${size} of ${size}`, marks: 1 });
    }
  });

  it("adds 0.1 for each place higher, so a bigger war's top base is worth more", () => {
    expect(rank(5, 1)?.marks).toBe(1.4);
    expect(rank(20, 1)?.marks).toBe(2.9);
    expect(rank(40, 1)?.marks).toBe(4.9);
    expect(rank(50, 1)?.marks).toBe(5.9);
    expect(rank(40, 26)?.marks).toBe(2.4);
    expect(rank(40, 24)?.marks).toBe(2.6);
  });

  it("is only for three stars", () => {
    expect(rank(40, 1, 2)).toBeUndefined();
    expect(rank(40, 1, 0)).toBeUndefined();
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
    expect(player(rated, 2).marks).toBe(-8);
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
    expect(player(rated, 2).share).toBeCloseTo((-8 / rated.total) * 100, 6);

    const bad = warRating(board(3, [attack(1, 1, 1, 2)], { defenceKnown: false }), "warEnded");
    // 2★ mirror same TH 3, heroic +4, the best on its base × 1.5, one attack unused −4.
    expect(player(bad, 1).marks).toBe(6.5);
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
    expect(us3.marks).toBe(-16);
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
