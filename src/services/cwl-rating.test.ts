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

function board(bases: DayBase[], enemyKnown = true): DayBoard {
  return {
    bases,
    enemyKnown,
    ours: { used: bases.filter((b) => b.attack).length, of: bases.length },
    theirs: { used: null, of: bases.length },
    basesHit: bases.filter((b) => b.defences.length).length,
    basesTripled: 0,
  };
}

const marks = (lines: Array<{ marks: number }>) => lines.reduce((t, l) => t + l.marks, 0);

describe("attack marks", () => {
  it("gives the clan's own example: our #14 (TH16) triples their #8 (TH17) = 14", () => {
    const lines = attackLines(base(14, { th: 16, attack: [3, 8, 17] }), true);
    expect(lines).toEqual([
      { label: "3 stars", marks: 5 },
      { label: "6 bases up", marks: 6 },
      { label: "1 TH up", marks: 3 },
    ]);
    expect(marks(lines)).toBe(14);
  });

  it("scores the stars: 3 is +5, 2 is +1, 1 is −3 and 0 is −10", () => {
    // On the mirror at the same Town Hall, which adds 2 whatever the stars.
    const of = (stars: number) => marks(attackLines(base(4, { attack: [stars, 4, 17] }), true)) - 2;
    expect([3, 2, 1, 0].map(of)).toEqual([5, 1, -3, -10]);
  });

  it("gives every Town Hall level up 3 marks and every base up 1", () => {
    expect(marks(attackLines(base(10, { th: 15, attack: [3, 7, 17] }), true))).toBe(5 + 3 + 6);
  });

  it("gives no up marks under 2 stars, and says why", () => {
    const lines = attackLines(base(14, { th: 16, attack: [1, 8, 17] }), true);
    expect(lines).toEqual([
      { label: "1 star", marks: -3 },
      { label: "6 bases up, under 2 stars", marks: 0 },
      { label: "1 TH up, under 2 stars", marks: 0 },
    ]);
  });

  it("gives the mirror and the same Town Hall a mark each, whatever the stars", () => {
    expect(marks(attackLines(base(4, { attack: [3, 4, 17] }), true))).toBe(5 + 1 + 1);
    expect(marks(attackLines(base(4, { attack: [0, 4, 17] }), true))).toBe(-10 + 1 + 1);
  });

  it("takes a mark for every base below and every Town Hall level below", () => {
    expect(attackLines(base(1, { attack: [3, 4, 16] }), true)).toEqual([
      { label: "3 stars", marks: 5 },
      { label: "3 bases below", marks: -3 },
      { label: "1 TH below", marks: -1 },
    ]);
    // …with or without a result. (One star hitting down also loses 6 — below.)
    expect(marks(attackLines(base(1, { attack: [1, 4, 15] }), true))).toBe(-3 - 3 - 2 - 6);
  });

  it("takes 2 for stopping at two stars on a higher base, and nothing more below that", () => {
    // Our #10 on their #7 at the same Town Hall: 3 bases up (for 2★ or more) and +1.
    const of = (stars: number) => attackLines(base(10, { attack: [stars, 7, 17] }), true);
    expect(marks(of(3))).toBe(5 + 3 + 1);
    expect(of(2)).toContainEqual({ label: "Hitting up without 3 stars", marks: -2 });
    expect(marks(of(2))).toBe(1 + 3 + 1 - 2);
    // Under two stars the up marks are not given: that is the whole cost.
    for (const stars of [1, 0]) {
      expect(of(stars).some((l) => l.label.startsWith("Hitting"))).toBe(false);
    }
    expect(marks(of(1))).toBe(-3 + 1);
    expect(marks(of(0))).toBe(-10 + 1);
  });

  it("takes more for not clearing a lower base: 3 without 3 stars, 6 without 2, 10 without any", () => {
    // Our #1 on their #4 at the same Town Hall: 3 bases below and +1.
    const of = (stars: number) => attackLines(base(1, { attack: [stars, 4, 17] }), true);
    expect(marks(of(3))).toBe(5 - 3 + 1);
    expect(of(2)).toContainEqual({ label: "Hitting down without 3 stars", marks: -3 });
    expect(marks(of(2))).toBe(1 - 3 + 1 - 3);
    expect(of(1)).toContainEqual({ label: "Hitting down without 2 stars", marks: -6 });
    expect(marks(of(1))).toBe(-3 - 3 + 1 - 6);
    expect(of(0)).toContainEqual({ label: "Hitting down without a star", marks: -10 });
    expect(marks(of(0))).toBe(-10 - 3 + 1 - 10);
  });

  it("takes nothing extra on the mirror, whatever the result", () => {
    for (const stars of [0, 1, 2, 3]) {
      const labels = attackLines(base(4, { attack: [stars, 4, 17] }), true).map((l) => l.label);
      expect(labels.some((l) => l.startsWith("Hitting"))).toBe(false);
    }
  });

  it("never lets the map give or take more than 10", () => {
    expect(attackLines(base(1, { attack: [3, 15, 14] }), true)).toEqual([
      { label: "3 stars", marks: 5 },
      { label: "14 bases below, counted as 10", marks: -10 },
      { label: "3 TH below", marks: -3 },
    ]);
    expect(attackLines(base(15, { attack: [3, 1, 17] }), true)).toEqual([
      { label: "3 stars", marks: 5 },
      { label: "14 bases up, counted as 10", marks: 10 },
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
    // 3 stars on a base already at 2: 5 − 2, then 6 bases and a Town Hall up.
    expect(marks(attackLines(base(14, { th: 16, attack: [3, 8, 17], taken: 2 }), true))).toBe(3 + 6 + 3);
  });

  it("gives an attack that added no new star no star marks and nothing for hitting up", () => {
    expect(attackLines(base(10, { th: 16, attack: [3, 4, 17], taken: 3 }), true)).toEqual([
      { label: "3 stars, none new", marks: 0 },
      { label: "6 bases up, no new star", marks: 0 },
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
    const of = (stars: number) => marks(defenceLines(base(5, { hits: [[stars, 2]] })));
    expect([0, 1, 2, 3].map(of)).toEqual([10, 5, 3, 0]);
  });

  it("counts only the best hit on a base attacked twice", () => {
    expect(defenceLines(base(5, { hits: [[2, 3], [0, 9]] }))).toEqual([{ label: "Held to 2 stars", marks: 3 }]);
  });

  it("gives nothing for a base nobody attacked", () => {
    expect(defenceLines(base(5))).toEqual([]);
  });

  it("takes 2 when a lower base 3-stars it, and not when a higher or mirror base does", () => {
    expect(defenceLines(base(5, { hits: [[3, 12]] }))).toEqual([
      { label: "3-starred", marks: 0 },
      { label: "By their #12, a lower base", marks: -2 },
    ]);
    expect(marks(defenceLines(base(5, { hits: [[3, 5]] })))).toBe(0);
    expect(marks(defenceLines(base(5, { hits: [[3, 1]] })))).toBe(0);
    // Two stars from below is not a triple.
    expect(marks(defenceLines(base(5, { hits: [[2, 12]] })))).toBe(3);
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
        base(1, { attack: [3, 3, 17] }), // 5 − 2 below + 1 same TH = 4
        base(2, { attack: [3, 2, 17], hits: [[1, 2]] }), // 5 + 1 + 1, held to 1★ +5 = 12
        base(3, { th: 16, attack: [3, 1, 17], hits: [[3, 3]] }), // 5 + 2 up + 3, heroic +5 = 15
        base(4, { attack: [3, 5, 17], hits: [[0, 4]] }), // 5 − 1 + 1, held to 0★ +10, heroic +5 = 20
      ]),
      "warEnded",
    );
    expect(day.players.map((p) => p.marks)).toEqual([4, 12, 15, 20]);
    expect(day.total).toBe(51);
    expect(day.players[0]!.share).toBeCloseTo((4 / 51) * 100, 6);
    expect(day.players.reduce((t, p) => t + p.share, 0)).toBeCloseTo(100, 6);
    expect(day.status).toBe("counted");
  });

  it("gives the heroic +5 to exactly one attack and one defence", () => {
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
    expect(day.players[0]!.attack.at(-1)).toEqual({ label: "Heroic attack", marks: 5 });
    expect(day.players[0]!.defence.at(-1)).toEqual({ label: "Heroic defence", marks: 5 });
    expect(day.players.map((p) => p.marks)).toEqual([7 + 5 + 10 + 5, 7 + 10, 7 + 3]);
  });

  it("makes a minus day a minus share", () => {
    const day = dayRating(board([base(1), base(2, { attack: [3, 2, 17] })]), "warEnded");
    expect(day.players.map((p) => p.marks)).toEqual([-10, 12]);
    expect(day.players[0]!.share).toBeCloseTo((-10 / 2) * 100, 6);
  });

  it("counts 0 for everyone when the clan's total is 0 or less", () => {
    const day = dayRating(board([base(1), base(2, { attack: [1, 2, 17] })]), "warEnded");
    expect(day.total).toBe(-10 + -1);
    expect(day.players.map((p) => p.share)).toEqual([0, 0]);
  });

  it("is provisional while the day runs, with no penalty yet for an attack not used", () => {
    const day = dayRating(board([base(1), base(2, { attack: [3, 2, 17] })]), "inWar");
    expect(day.status).toBe("provisional");
    expect(day.players.map((p) => p.marks)).toEqual([0, 12]);
  });

  it("counts a day the sync never saw finish once the season is over", () => {
    const day = dayRating(board([base(1)]), "inWar", true);
    expect(day.status).toBe("counted");
    expect(day.players[0]!.marks).toBe(-10);
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
    base(1, { attack: [3, 1, 17] }), // 7, heroic +5 = 12
    base(2, { attack: [2, 2, 17] }), // 3
  ]);
  const day2 = board([
    base(1, { attack: [2, 1, 17] }), // 3
    base(3, { attack: [3, 3, 17] }), // 12 — only fielded on day 2
  ]);
  const live = board([
    base(1), // not attacked yet
    base(2, { attack: [3, 2, 17] }), // 12
  ]);

  const season = seasonRating([
    { dayNumber: 1, state: "warEnded", board: day1 },
    { dayNumber: 2, state: "warEnded", board: day2 },
    { dayNumber: 3, state: "inWar", board: live },
    { dayNumber: 4, state: "preparation", board: board([base(1), base(2)]) },
  ]);

  it("adds the finished days' shares up, and leaves the running day out", () => {
    const us1 = season.players.find((p) => p.name === "Us 1")!;
    expect(us1.rating).toBeCloseTo(80 + 20, 6);
    expect(us1.marks).toBe(15);
    expect(us1.daysCounted).toBe(2);
    expect(us1.provisional?.marks).toBe(0);

    const us2 = season.players.find((p) => p.name === "Us 2")!;
    expect(us2.rating).toBeCloseTo(20, 6);
    expect(us2.provisional?.share).toBeCloseTo(100, 6);
  });

  it("gives the rating per day played, and the average destruction", () => {
    const us1 = season.players.find((p) => p.name === "Us 1")!;
    expect(us1.perDay).toBeCloseTo(50, 6);
    expect(us1.averageDestruction).toBe(80);

    const us3 = season.players.find((p) => p.name === "Us 3")!;
    expect(us3.perDay).toBeCloseTo(80, 6);
  });

  it("ranks by the rating", () => {
    expect(season.players.map((p) => p.name)).toEqual(["Us 1", "Us 3", "Us 2"]);
  });

  it("keeps a slot per day, empty where a player was not in the lineup", () => {
    const us3 = season.players.find((p) => p.name === "Us 3")!;
    expect(us3.days.map((d) => d?.marks ?? null)).toEqual([null, 12, null, null]);
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
});

describe("oneDecimal", () => {
  it("prints a share to one decimal, with a real minus and no minus zero", () => {
    expect([12.94, -1.61, -0.04, 0].map(oneDecimal)).toEqual(["12.9", "−1.6", "0.0", "0.0"]);
  });
});
