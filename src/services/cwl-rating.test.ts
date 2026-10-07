import { describe, expect, it } from "vitest";
import type { DayBase, DayBoard } from "./cwl-day";
import {
  attackLines,
  dayRating,
  defenceLines,
  heroicAttack,
  heroicDefence,
  oneDecimal,
  seasonRating,
  signed,
} from "./cwl-rating";

/** One of our bases: its number, its Town Hall, and optionally its attack and the hits on it. */
function base(
  n: number,
  options: {
    th?: number;
    /** [stars, target base number, target Town Hall] */
    attack?: [stars: number, targetBase: number | null, targetTh: number | null];
    /** Defaults to 100 for three stars and 60 otherwise. */
    destruction?: number;
    /** Stars clanmates had already taken from the target. Default 0: the first hit. */
    taken?: number | null;
    /** [stars, attacker's base number, attacker's Town Hall, destruction] per enemy hit, best first. */
    hits?: Array<[stars: number, byBase: number, byTh?: number, destruction?: number]>;
  } = {},
): DayBase {
  const { th = 17, attack, hits = [] } = options;
  return {
    playerId: `p${n}`,
    tag: `#U${n}`,
    name: `Us ${n}`,
    thLevel: th,
    base: n,
    attack: attack
      ? {
          stars: attack[0],
          destruction: options.destruction ?? (attack[0] === 3 ? 100 : 60),
          target: { tag: `#F${attack[1]}`, base: attack[1], name: `Foe ${attack[1]}`, thLevel: attack[2] },
          alreadyTaken: options.taken === undefined ? 0 : options.taken,
        }
      : null,
    defences: hits.map(([stars, byBase, byTh = 17, destruction]) => ({
      stars,
      destruction: destruction ?? (stars === 3 ? 100 : 50),
      by: { tag: `#F${byBase}`, base: byBase, name: `Foe ${byBase}`, thLevel: byTh },
    })),
  };
}

function board(bases: DayBase[], enemyKnown = true, enemyBases: number | null = null): DayBoard {
  return {
    bases,
    enemyKnown,
    ours: { used: bases.filter((b) => b.attack).length, of: bases.length },
    theirs: { used: null, of: enemyBases },
    basesHit: bases.filter((b) => b.defences.length).length,
    basesTripled: 0,
  };
}

const marks = (lines: Array<{ marks: number }>) => lines.reduce((t, l) => t + l.marks, 0);
/** A base's defence lines once the day is over. */
const defended = (b: DayBase) => defenceLines(b, true);

describe("attack marks", () => {
  it("gives the clan's own example: our #14 (TH16) triples their #8 (TH17) = 15", () => {
    const lines = attackLines(base(14, { th: 16, attack: [3, 8, 17] }), true);
    expect(lines).toEqual([
      { label: "3 stars", marks: 5 },
      { label: "6 bases up", marks: 6 },
      { label: "Mirror or above", marks: 1 },
      { label: "1 TH up", marks: 3 },
    ]);
    expect(marks(lines)).toBe(15);
  });

  it("gives the mirror mark to any base above the mirror too, whatever the stars", () => {
    // Our #14 on their #5, #13, #14 and #15, with one star: no up marks, so only this moves.
    const of = (target: number) => attackLines(base(14, { attack: [1, target, 17] }), true);
    expect(of(5)).toContainEqual({ label: "Mirror or above", marks: 1 });
    expect(of(13)).toContainEqual({ label: "Mirror or above", marks: 1 });
    expect(of(14)).toContainEqual({ label: "Mirror", marks: 1 });
    expect(of(15).some((l) => l.label.startsWith("Mirror"))).toBe(false);
    // Never twice.
    expect(of(5).filter((l) => l.label.startsWith("Mirror"))).toHaveLength(1);
  });

  it("scores the stars: 3 is +5, 2 is +1, 1 is −3 and 0 is −10", () => {
    // On the mirror at the same Town Hall, which adds 2 whatever the stars.
    const of = (stars: number) => marks(attackLines(base(4, { attack: [stars, 4, 17] }), true)) - 2;
    expect([3, 2, 1, 0].map(of)).toEqual([5, 1, -3, -10]);
  });

  it("gives every Town Hall level up 3 marks and every base up 1", () => {
    expect(marks(attackLines(base(10, { th: 15, attack: [3, 7, 17] }), true))).toBe(5 + 3 + 1 + 6);
  });

  it("gives no up marks under 2 stars, and says why", () => {
    const lines = attackLines(base(14, { th: 16, attack: [1, 8, 17] }), true);
    expect(lines).toEqual([
      { label: "1 star", marks: -3 },
      { label: "6 bases up, under 2 stars", marks: 0 },
      { label: "Mirror or above", marks: 1 },
      { label: "1 TH up, under 2 stars", marks: 0 },
    ]);
  });

  it("gives the mirror and the same Town Hall a mark each, whatever the stars", () => {
    expect(marks(attackLines(base(4, { attack: [3, 4, 17] }), true))).toBe(5 + 1 + 1);
    expect(marks(attackLines(base(4, { attack: [0, 4, 17] }), true))).toBe(-10 + 1 + 1);
  });

  it("takes a mark for every base below and every Town Hall level below", () => {
    expect(attackLines(base(1, { attack: [3, 3, 16] }), true)).toEqual([
      { label: "3 stars", marks: 5 },
      { label: "2 bases below", marks: -2 },
      { label: "1 TH below", marks: -1 },
    ]);
    expect(attackLines(base(1, { attack: [3, 2, 17] }), true)[1]).toEqual({ label: "1 base below", marks: -1 });
    // …with or without a result. (One star hitting down also loses 6 — below.)
    expect(marks(attackLines(base(1, { attack: [1, 3, 15] }), true))).toBe(-3 - 2 - 2 - 6);
  });

  it("takes half a mark for stopping at two stars on a higher base, and nothing more below that", () => {
    // Our #10 on their #7 at the same Town Hall: 3 bases up (for 2★ or more),
    // +1 for not hitting down and +1 for the Town Hall.
    const of = (stars: number) => attackLines(base(10, { attack: [stars, 7, 17] }), true);
    expect(marks(of(3))).toBe(5 + 3 + 1 + 1);
    expect(of(2)).toContainEqual({ label: "Hitting up without 3 stars", marks: -0.5 });
    expect(marks(of(2))).toBe(1 + 3 + 1 + 1 - 0.5);
    // Under two stars the up marks are not given: that is the whole cost.
    for (const stars of [1, 0]) {
      expect(of(stars).some((l) => l.label.startsWith("Hitting"))).toBe(false);
    }
    expect(marks(of(1))).toBe(-3 + 1 + 1);
    expect(marks(of(0))).toBe(-10 + 1 + 1);
  });

  it("takes more for not clearing a lower base: 3 without 3 stars, 6 without 2, 10 without any", () => {
    // Our #1 on their #3 at the same Town Hall: 2 bases below and +1.
    const of = (stars: number) => attackLines(base(1, { attack: [stars, 3, 17] }), true);
    expect(marks(of(3))).toBe(5 - 2 + 1);
    expect(of(2)).toContainEqual({ label: "Hitting down without 3 stars", marks: -3 });
    expect(marks(of(2))).toBe(1 - 2 + 1 - 3);
    expect(of(1)).toContainEqual({ label: "Hitting down without 2 stars", marks: -6 });
    expect(marks(of(1))).toBe(-3 - 2 + 1 - 6);
    expect(of(0)).toContainEqual({ label: "Hitting down without a star", marks: -10 });
    expect(marks(of(0))).toBe(-10 - 2 + 1 - 10);
  });

  it("takes nothing extra on the mirror, whatever the result", () => {
    for (const stars of [0, 1, 2, 3]) {
      const labels = attackLines(base(4, { attack: [stars, 4, 17] }), true).map((l) => l.label);
      expect(labels.some((l) => l.startsWith("Hitting"))).toBe(false);
    }
  });

  it("never lets the map give more than 10 for bases up, or take more than 2 for bases below", () => {
    expect(attackLines(base(1, { attack: [3, 15, 14] }), true)).toEqual([
      { label: "3 stars", marks: 5 },
      { label: "14 bases below, counted as 2", marks: -2 },
      { label: "3 TH below", marks: -3 },
    ]);
    // Exactly 2 below is not "counted as" anything; 3 is.
    expect(attackLines(base(1, { attack: [3, 3, 17] }), true)[1]).toEqual({ label: "2 bases below", marks: -2 });
    expect(attackLines(base(1, { attack: [3, 4, 17] }), true)[1]).toEqual({
      label: "3 bases below, counted as 2",
      marks: -2,
    });
    expect(attackLines(base(15, { attack: [3, 1, 17] }), true)).toEqual([
      { label: "3 stars", marks: 5 },
      { label: "14 bases up, counted as 10", marks: 10 },
      { label: "Mirror or above", marks: 1 },
      { label: "Same TH", marks: 1 },
    ]);
    // Exactly 10 is not "counted as" anything.
    expect(attackLines(base(11, { attack: [3, 1, 17] }), true)[1]).toEqual({ label: "10 bases up", marks: 10 });
  });

  it("adds a mark to two stars at 90% or more, and to nothing else", () => {
    const of = (stars: number, destruction: number) =>
      marks(attackLines(base(4, { attack: [stars, 4, 17], destruction }), true)) - 2;
    expect(of(2, 90)).toBe(1 + 1);
    expect(of(2, 89.9)).toBe(1);
    expect(of(3, 100)).toBe(5);
    expect(of(1, 95)).toBe(-3);
  });

  it("takes 10 for an attack not used — once the day is over, not while it runs", () => {
    expect(attackLines(base(3), true)).toEqual([{ label: "Did not attack", marks: -10 }]);
    expect(attackLines(base(3), false)).toEqual([]);
  });

  it("scores the stars alone when the target is not known", () => {
    expect(attackLines(base(3, { attack: [3, null, null] }), true)).toEqual([{ label: "3 stars", marks: 5 }]);
  });
});

describe("new stars only", () => {
  it("takes a mark off for each star a clanmate had already taken", () => {
    expect(attackLines(base(4, { attack: [3, 4, 17], taken: 2 }), true)).toEqual([
      { label: "3 stars, 2 already taken", marks: 3 },
      { label: "Mirror", marks: 1 },
      { label: "Same TH", marks: 1 },
    ]);
    expect(attackLines(base(4, { attack: [3, 4, 17], taken: 1 }), true)[0]).toEqual({
      label: "3 stars, 1 already taken",
      marks: 4,
    });
    expect(attackLines(base(4, { attack: [2, 4, 17], taken: 1 }), true)[0]).toEqual({
      label: "2 stars, 1 already taken",
      marks: 0,
    });
  });

  it("still pays for hitting up when the attack added a star", () => {
    // 3 stars on a base already at 2: 5 − 2, then 6 bases up, the mirror mark and a Town Hall up.
    expect(marks(attackLines(base(14, { th: 16, attack: [3, 8, 17], taken: 2 }), true))).toBe(3 + 6 + 1 + 3);
  });

  it("gives an attack that added no new star no star marks and nothing for hitting up", () => {
    expect(attackLines(base(10, { th: 16, attack: [3, 4, 17], taken: 3 }), true)).toEqual([
      { label: "3 stars, none new", marks: 0 },
      { label: "6 bases up, no new star", marks: 0 },
      // Where the attack was aimed is still where it was aimed.
      { label: "Mirror or above", marks: 1 },
      { label: "1 TH up, no new star", marks: 0 },
    ]);
    // Not even the 90% mark: two stars on a base already at two.
    expect(attackLines(base(4, { attack: [2, 4, 17], destruction: 95, taken: 2 }), true)).toEqual([
      { label: "2 stars, none new", marks: 0 },
      { label: "Mirror", marks: 1 },
      { label: "Same TH", marks: 1 },
    ]);
  });

  it("leaves a bad result exactly as bad as it was", () => {
    expect(attackLines(base(4, { attack: [1, 4, 17], taken: 2 }), true)[0]).toEqual({ label: "1 star", marks: -3 });
    expect(attackLines(base(4, { attack: [0, 4, 17], taken: 2 }), true)[0]).toEqual({ label: "0 stars", marks: -10 });
  });

  it("rates a hit as the first when the order of attacks was never recorded", () => {
    expect(attackLines(base(4, { attack: [3, 4, 17], taken: null }), true)[0]).toEqual({ label: "3 stars", marks: 5 });
  });
});

describe("defence marks", () => {
  it("scores the enemy's best hit: 0★ +10, 1★ +5, 2★ +3, 3★ 0", () => {
    const of = (stars: number) => marks(defended(base(5, { hits: [[stars, 5]] })));
    expect([0, 1, 2, 3].map(of)).toEqual([10, 5, 3, 0]);
  });

  it("counts only the best hit on a base attacked twice", () => {
    expect(defended(base(5, { hits: [[2, 5], [0, 9]] }))).toEqual([{ label: "Held to 2 stars", marks: 3 }]);
  });

  it("gives 2 for a base nobody attacked — once the day is over, not while it runs", () => {
    expect(defenceLines(base(5), true)).toEqual([{ label: "Not attacked", marks: 2 }]);
    expect(defenceLines(base(5), false)).toEqual([]);
  });

  it("takes half a mark when a lower base 3-stars it, and not when a higher or mirror base does", () => {
    expect(defended(base(5, { hits: [[3, 12]] }))).toEqual([
      { label: "3-starred", marks: 0 },
      { label: "By their #12, a lower base", marks: -0.5 },
    ]);
    expect(marks(defended(base(5, { hits: [[3, 5]] })))).toBe(0);
    expect(defended(base(5, { hits: [[3, 1]] })).some((l) => l.label.includes("lower base"))).toBe(false);
    // Two stars from below is not a triple.
    expect(marks(defended(base(5, { hits: [[2, 12]] })))).toBe(3);
  });
});

describe("stars lost to a higher base", () => {
  it("gives half a mark back when the hit that scores came from higher on the map", () => {
    // Our #5, attacked by their #2.
    expect(defended(base(5, { hits: [[3, 2]] }))).toEqual([
      { label: "3-starred", marks: 0 },
      { label: "By their #2, a higher base", marks: 0.5 },
    ]);
    expect(marks(defended(base(5, { hits: [[2, 2]] })))).toBe(3 + 0.5);
    expect(marks(defended(base(5, { hits: [[1, 4]] })))).toBe(5 + 0.5);
  });

  it("gives nothing when they took no star, or came from the mirror or below", () => {
    const from = (stars: number, by: number) =>
      defended(base(5, { hits: [[stars, by]] })).some((l) => l.label.includes("higher base"));
    expect(from(0, 2)).toBe(false);
    expect(from(2, 5)).toBe(false);
    expect(from(2, 9)).toBe(false);
  });

  it("goes by the hit that scores, not by a weaker one from higher up", () => {
    // Their #9 took two stars; their #1 only one. The two stars are what count.
    const lines = defended(base(5, { hits: [[2, 9], [1, 1]] }));
    expect(lines).toEqual([{ label: "Held to 2 stars", marks: 3 }]);
  });
});

describe("the day's heroic attack", () => {
  const mirror = base(1, { attack: [3, 1, 17] });
  const thUp = base(2, { th: 16, attack: [3, 2, 17] });
  const mapUp = base(9, { attack: [3, 2, 17] });
  const twoStars = base(5, { th: 15, attack: [2, 5, 17] });

  it("is the most stars, then the furthest above their own Town Hall, then up the map", () => {
    expect(heroicAttack([mirror, thUp, mapUp, twoStars])?.name).toBe("Us 2");
    expect(heroicAttack([mirror, mapUp, twoStars])?.name).toBe("Us 9");
    expect(heroicAttack([mirror, twoStars])?.name).toBe("Us 1");
    expect(heroicAttack([twoStars])?.name).toBe("Us 5");
  });

  it("falls to the most destruction when everything else is level", () => {
    const a = base(3, { attack: [2, 3, 17], destruction: 70 });
    const b = base(4, { attack: [2, 4, 17], destruction: 85 });
    expect(heroicAttack([a, b])?.name).toBe("Us 4");
  });

  it("is nobody when the best attack was one star, or added no new star", () => {
    expect(heroicAttack([base(1, { attack: [1, 1, 18] }), base(2)])).toBeNull();
    expect(heroicAttack([base(1, { attack: [3, 1, 17], taken: 3 })])).toBeNull();
  });
});

describe("the day's heroic defence", () => {
  it("is the fewest stars given, then the least destruction, then the strongest attacker", () => {
    const oneStar = base(1, { hits: [[1, 3, 17, 40]] });
    const held = base(2, { hits: [[0, 5, 17, 30]] });
    const heldHigherTh = base(3, { hits: [[0, 6, 18, 30]] });
    const heldLess = base(4, { hits: [[0, 9, 16, 12]] });
    expect(heroicDefence([oneStar, held])?.name).toBe("Us 2");
    expect(heroicDefence([oneStar, held, heldHigherTh])?.name).toBe("Us 3");
    expect(heroicDefence([oneStar, held, heldHigherTh, heldLess])?.name).toBe("Us 4");
  });

  it("is nobody when every base attacked was 3-starred, or none was attacked", () => {
    expect(heroicDefence([base(1, { hits: [[3, 1]] }), base(2)])).toBeNull();
  });
});

describe("dayRating", () => {
  it("is each player's share of the clan's marks: 4 of (47 + 4)", () => {
    const day = dayRating(
      board([
        base(1, { attack: [3, 3, 17], hits: [[3, 1]] }), // 5 − 2 below + 1 same TH, 3-starred 0 = 4
        base(2, { th: 16, attack: [3, 2, 17], hits: [[2, 2]] }), // 5 + 1 + 3 TH up, held to 2★ +3 = 12
        base(3, { th: 15, attack: [3, 2, 17], hits: [[3, 3]] }), // 5 + 1 up + 1 + 6, heroic +4 = 17
        base(4, { attack: [2, 4, 17], hits: [[0, 4]] }), // 1 + 1 + 1, held to 0★ +10, heroic +5 = 18
      ]),
      "warEnded",
    );
    expect(day.players.map((p) => p.marks)).toEqual([4, 12, 17, 18]);
    expect(day.total).toBe(51);
    expect(day.players[0]!.share).toBeCloseTo((4 / 51) * 100, 6);
    expect(day.players.reduce((t, p) => t + p.share, 0)).toBeCloseTo(100, 6);
    expect(day.status).toBe("counted");
  });

  it("gives the heroic marks — 4 for the attack, 5 for the defence — to exactly one of each", () => {
    const day = dayRating(
      board([
        base(1, { attack: [3, 1, 17], hits: [[0, 1]] }),
        base(2, { attack: [3, 2, 17], hits: [[0, 2]] }),
        base(3, { attack: [3, 3, 17], hits: [[2, 3]] }),
      ]),
      "warEnded",
    );
    expect(day.players.filter((p) => p.heroicAttack).map((p) => p.name)).toEqual(["Us 1"]);
    expect(day.players.filter((p) => p.heroicDefence).map((p) => p.name)).toEqual(["Us 1"]);
    expect(day.players[0]!.attack.at(-1)).toEqual({ label: "Heroic attack", marks: 4 });
    expect(day.players[0]!.defence.at(-1)).toEqual({ label: "Heroic defence", marks: 5 });
    expect(day.players.map((p) => p.marks)).toEqual([7 + 4 + 10 + 5, 7 + 10, 7 + 3]);
  });

  it("divides by the plus marks only: +15 and +13 with a −10.5 is out of 28", () => {
    const day = dayRating(
      board([
        base(1, { attack: [3, 1, 17] }), // C: 7, heroic attack +4, left alone +2 = 13
        base(2, { attack: [3, 2, 17], hits: [[2, 2]] }), // A: 7, held to 2★ +3, heroic defence +5 = 15
        base(3, { hits: [[3, 5]] }), // B: no attack −10, 3-starred from below −0.5 = −10.5
      ]),
      "warEnded",
    );
    expect(day.players.map((p) => p.marks)).toEqual([13, 15, -10.5]);
    expect(day.total).toBe(28);
    expect(day.players.map((p) => p.share)).toEqual([
      expect.closeTo((13 / 28) * 100, 6),
      expect.closeTo((15 / 28) * 100, 6),
      expect.closeTo((-10.5 / 28) * 100, 6),
    ]);
    // The plus shares are the whole of it, whoever went under.
    const plus = day.players.filter((p) => p.marks > 0).reduce((t, p) => t + p.share, 0);
    expect(plus).toBeCloseTo(100, 6);
  });

  it("never lets a minus player push anyone's share past 100%", () => {
    // +13 and −8: out of everyone's marks that was 13 of 5, or 260%.
    const day = dayRating(board([base(1), base(2, { attack: [3, 2, 17] })]), "warEnded");
    expect(day.players.map((p) => p.marks)).toEqual([-8, 13]);
    expect(day.total).toBe(13);
    expect(day.players[1]!.share).toBe(100);
    expect(day.players[0]!.share).toBeCloseTo((-8 / 13) * 100, 6);
  });

  it("never makes a day's share worse than −100%", () => {
    // 7 above zero in the whole clan and a player on −10.5: −150% before the limit.
    const day = dayRating(
      board([
        base(1, { attack: [1, 1, 17], hits: [[2, 1]] }), // −3 + 1 + 1, held to 2★ +3, heroic defence +5 = 7
        base(2, { hits: [[3, 5]] }), // no attack −10, 3-starred from below −0.5 = −10.5
      ]),
      "warEnded",
    );
    expect(day.players.map((p) => p.marks)).toEqual([7, -10.5]);
    expect(day.total).toBe(7);
    expect(day.players.map((p) => p.share)).toEqual([100, -100]);
  });

  it("counts 0 for everyone when nobody finished the day above zero", () => {
    const day = dayRating(
      board([base(1, { hits: [[3, 1]] }), base(2, { attack: [1, 2, 17], hits: [[3, 2]] })]),
      "warEnded",
    );
    expect(day.players.map((p) => p.marks)).toEqual([-10, -1]);
    expect(day.total).toBe(0);
    expect(day.players.map((p) => p.share)).toEqual([0, 0]);
  });

  it("is provisional while the day runs: nothing yet for an attack not used or a base left alone", () => {
    const day = dayRating(board([base(1), base(2, { attack: [3, 2, 17] })]), "inWar");
    expect(day.status).toBe("provisional");
    expect(day.players.map((p) => p.marks)).toEqual([0, 11]);
  });

  it("counts a day the sync never saw finish once the season is over", () => {
    const day = dayRating(board([base(1)]), "inWar", true);
    expect(day.status).toBe("counted");
    expect(day.players[0]!.marks).toBe(-10 + 2);
  });

  it("does not rate a preparation day, or a day whose enemy lineup was never recorded", () => {
    const empty = { total: 0, players: [], orderMissing: false };
    expect(dayRating(board([base(1)]), "preparation")).toEqual({ status: "notStarted", ...empty });
    expect(dayRating(board([base(1, { attack: [3, null, null] })], false), "warEnded")).toEqual({
      status: "notRated",
      ...empty,
    });
  });

  it("says when a base was hit twice and the order was never recorded", () => {
    const known = board([base(1, { attack: [3, 1, 17] })]);
    const unknown = board([base(1, { attack: [3, 1, 17], taken: null })]);
    expect(dayRating(known, "warEnded").orderMissing).toBe(false);
    expect(dayRating(unknown, "warEnded").orderMissing).toBe(true);
  });
});

describe("seasonRating", () => {
  const day1 = board([
    base(1, { attack: [3, 1, 17] }), // 7, heroic +4, left alone +2 = 13
    base(2, { attack: [2, 2, 17] }), // 3, left alone +2 = 5
  ]);
  const day2 = board([
    base(1, { attack: [2, 1, 17] }), // 5
    base(3, { attack: [3, 3, 17] }), // 13 — only fielded on day 2
  ]);
  const live = board([
    base(1), // not attacked yet
    base(2, { attack: [3, 2, 17] }), // 7, heroic +4 = 11 — nothing for a base left alone yet
  ]);

  const season = seasonRating([
    { dayNumber: 1, state: "warEnded", board: day1 },
    { dayNumber: 2, state: "warEnded", board: day2 },
    { dayNumber: 3, state: "inWar", board: live },
    { dayNumber: 4, state: "preparation", board: board([base(1), base(2)]) },
  ]);

  it("adds the finished days' shares up, and leaves the running day out", () => {
    const us1 = season.players.find((p) => p.name === "Us 1")!;
    expect(us1.rating).toBeCloseTo(((13 + 5) / 18) * 100, 6);
    expect(us1.marks).toBe(18);
    expect(us1.daysCounted).toBe(2);
    expect(us1.provisional?.marks).toBe(0);

    const us2 = season.players.find((p) => p.name === "Us 2")!;
    expect(us2.rating).toBeCloseTo((5 / 18) * 100, 6);
    expect(us2.provisional?.share).toBeCloseTo(100, 6);
  });

  it("gives the rating per day played, and the average destruction", () => {
    const us1 = season.players.find((p) => p.name === "Us 1")!;
    expect(us1.perDay).toBeCloseTo(50, 6);
    expect(us1.averageDestruction).toBe(80);

    const us3 = season.players.find((p) => p.name === "Us 3")!;
    expect(us3.perDay).toBeCloseTo((13 / 18) * 100, 6);
  });

  it("ranks by the rating", () => {
    expect(season.players.map((p) => p.name)).toEqual(["Us 1", "Us 3", "Us 2"]);
  });

  it("keeps a slot per day, empty where a player was not in the lineup", () => {
    const us3 = season.players.find((p) => p.name === "Us 3")!;
    expect(us3.days.map((d) => d?.marks ?? null)).toEqual([null, 13, null, null]);
    expect(season.days.map((d) => d.status)).toEqual(["counted", "counted", "provisional", "notStarted"]);
    expect(season.started).toBe(true);
  });

  it("orders players level on rating and marks by average destruction, not by name", () => {
    const level = seasonRating([
      {
        dayNumber: 1,
        state: "warEnded",
        board: board([
          base(1, { attack: [2, 1, 17], destruction: 60 }), // 3
          base(2, { attack: [2, 2, 17], destruction: 80 }), // 3
          base(3, { attack: [3, 3, 17] }), // the heroic attack, so the other two stay level
        ]),
      },
    ]);
    expect(level.players.map((p) => p.name)).toEqual(["Us 3", "Us 2", "Us 1"]);
  });

  it("orders by the running day while nothing has finished yet", () => {
    const first = seasonRating([{ dayNumber: 1, state: "inWar", board: live }]);
    expect(first.started).toBe(false);
    expect(first.players.map((p) => [p.name, p.rating, p.perDay])).toEqual([
      ["Us 2", 0, null],
      ["Us 1", 0, null],
    ]);
  });
});

describe("signed", () => {
  it("prints marks with their sign", () => {
    expect([5, -3, 0].map(signed)).toEqual(["+5", "−3", "0"]);
  });

  it("prints a decimal only where there is one, and never the drift of adding tenths", () => {
    expect([12.2, -3.5, 8.0, 0.3, 0.1 + 0.2, 12.200000000000001].map(signed)).toEqual([
      "+12.2",
      "−3.5",
      "+8",
      "+0.3",
      "+0.3",
      "+12.2",
    ]);
  });
});

describe("the target's place on their map", () => {
  // Every base at TH17, so only the map moves.
  const of = (own: number, target: number, stars = 3, enemyBases: number | null = 15, taken: number | null = 0) =>
    attackLines(base(own, { attack: [stars, target, 17], taken }), true, enemyBases);

  it("gives 3 stars on their last base 1, and 0.3 more for each place higher", () => {
    expect(of(15, 15)).toContainEqual({ label: "Their #15 of 15", marks: 1 });
    expect(of(14, 14)).toContainEqual({ label: "Their #14 of 15", marks: 1.3 });
    expect(of(8, 8)).toContainEqual({ label: "Their #8 of 15", marks: 3.1 });
    expect(of(1, 1)).toContainEqual({ label: "Their #1 of 15", marks: 5.2 });
  });

  it("makes a mirror at the top worth more than a mirror at the bottom", () => {
    expect(marks(of(1, 1))).toBeCloseTo(7 + 5.2, 6);
    expect(marks(of(15, 15))).toBeCloseTo(7 + 1, 6);
  });

  it("adds to the marks for reaching up or dropping down, and replaces none", () => {
    // Our #15 on their #1: 5 + 10 (14 up, counted as 10) + 1 mirror or above + 1 same TH + 5.2.
    expect(marks(of(15, 1))).toBeCloseTo(22.2, 6);
    // Our #1 on their #15: 5 − 2 (14 below, counted as 2) + 1 same TH + 1.
    expect(marks(of(1, 15))).toBeCloseTo(5, 6);
  });

  it("is only for 3 stars", () => {
    for (const stars of [2, 1, 0]) {
      expect(of(1, 1, stars).some((l) => l.label.startsWith("Their #"))).toBe(false);
    }
  });

  it("is not given to a third star on a base a clanmate had already tripled", () => {
    expect(of(1, 1, 3, 15, 3).some((l) => l.label.startsWith("Their #"))).toBe(false);
    // …but is to one that took the base from two stars to three.
    expect(of(1, 1, 3, 15, 2)).toContainEqual({ label: "Their #1 of 15", marks: 5.2 });
  });

  it("keeps 0.3 a base in a 30-base war, so their #1 is worth 9.7", () => {
    expect(of(1, 1, 3, 30)).toContainEqual({ label: "Their #1 of 30", marks: 9.7 });
    expect(of(30, 30, 3, 30)).toContainEqual({ label: "Their #30 of 30", marks: 1 });
  });

  it("is left out when the lineup size or the target is not known", () => {
    expect(of(1, 1, 3, null).some((l) => l.label.startsWith("Their #"))).toBe(false);
    const unknown = attackLines(base(1, { attack: [3, null, null] }), true, 15);
    expect(unknown).toEqual([{ label: "3 stars", marks: 5 }]);
  });

  it("reaches the day's marks, to one decimal", () => {
    const day = dayRating(
      board(
        [
          base(1, { attack: [3, 1, 17] }), // 7 + 5.2, heroic +4, left alone +2 = 18.2
          base(2, { attack: [3, 2, 17] }), // 7 + 4.9 + 2 = 13.9
          base(15, { attack: [3, 15, 17] }), // 7 + 1 + 2 = 10
        ],
        true,
        15,
      ),
      "warEnded",
    );
    expect(day.players.map((p) => p.marks)).toEqual([18.2, 13.9, 10]);
    expect(day.total).toBe(42.1);
    expect(day.players.reduce((t, p) => t + p.share, 0)).toBeCloseTo(100, 6);
  });
});

describe("oneDecimal", () => {
  it("prints a share to one decimal, with a real minus and no minus zero", () => {
    expect([12.94, -1.61, -0.04, 0].map(oneDecimal)).toEqual(["12.9", "−1.6", "0.0", "0.0"]);
  });
});
