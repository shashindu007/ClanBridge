import { describe, expect, it } from "vitest";
import type { DayBase, DayBoard } from "./cwl-day";
import { attackLines, dayRating, defenceLines, oneDecimal, seasonRating, signed } from "./cwl-rating";

/** One of our bases: its number, its Town Hall, and optionally its attack and the hits on it. */
function base(
  n: number,
  options: {
    th?: number;
    /** [stars, target base number, target Town Hall] */
    attack?: [stars: number, targetBase: number | null, targetTh: number | null];
    /** [stars, attacker's base number] per enemy hit, best first. */
    hits?: Array<[stars: number, byBase: number]>;
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
          destruction: attack[0] === 3 ? 100 : 60,
          target: { tag: `#F${attack[1]}`, base: attack[1], name: `Foe ${attack[1]}`, thLevel: attack[2] },
        }
      : null,
    defences: hits.map(([stars, byBase]) => ({
      stars,
      destruction: stars === 3 ? 100 : 50,
      by: { tag: `#F${byBase}`, base: byBase, name: `Foe ${byBase}`, thLevel: 17 },
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
    // A lower Town Hall and a base below, so only the stars and the −1 move.
    const of = (stars: number) => marks(attackLines(base(1, { attack: [stars, 5, 16] }), true)) + 1;
    expect([3, 2, 1, 0].map(of)).toEqual([5, 1, -3, -10]);
  });

  it("gives every Town Hall level up 3 marks and every base up 1", () => {
    expect(marks(attackLines(base(10, { th: 15, attack: [2, 7, 17] }), true))).toBe(1 + 3 + 6);
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

  it("takes one mark for a base below, however far below, and gives nothing for a lower Town Hall", () => {
    expect(marks(attackLines(base(1, { attack: [3, 2, 16] }), true))).toBe(5 - 1);
    expect(marks(attackLines(base(1, { attack: [3, 15, 14] }), true))).toBe(5 - 1);
  });

  it("takes 10 for an attack not used — once the day is over, not while it runs", () => {
    expect(attackLines(base(3), true)).toEqual([{ label: "Did not attack", marks: -10 }]);
    expect(attackLines(base(3), false)).toEqual([]);
  });

  it("scores the stars alone when the target is not known", () => {
    expect(attackLines(base(3, { attack: [3, null, null] }), true)).toEqual([{ label: "3 stars", marks: 5 }]);
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

describe("dayRating", () => {
  it("is each player's share of the clan's marks: 4 of (47 + 4)", () => {
    // 4 marks: 3★ on a base below with a lower Town Hall. The rest: 47.
    const day = dayRating(
      board([
        base(1, { attack: [3, 5, 16] }), // 5 − 1 = 4
        base(2, { th: 14, attack: [3, 1, 17], hits: [[0, 2]] }), // 5 + 1 + 9 + 10 = 25
        base(3, { th: 15, attack: [3, 1, 17], hits: [[1, 3]] }), // 5 + 2 + 6 + 5 = 18
        base(4, { attack: [2, 4, 17], hits: [[1, 4]] }), // 1 + 1 + 1 + 5 = 8
        base(5, { attack: [1, 9, 16], hits: [[3, 5]] }), // −3 − 1 + 0 = −4
      ]),
      "warEnded",
    );
    expect(day.players.map((p) => p.marks)).toEqual([4, 25, 18, 8, -4]);
    expect(day.total).toBe(51);
    expect(day.players[0]!.share).toBeCloseTo((4 / 51) * 100, 6);
    // A minus day is a minus share, and the shares still add up to 100.
    expect(day.players[4]!.share).toBeCloseTo((-4 / 51) * 100, 6);
    expect(day.players.reduce((t, p) => t + p.share, 0)).toBeCloseTo(100, 6);
    expect(day.status).toBe("counted");
  });

  it("counts 0 for everyone when the clan's total is 0 or less", () => {
    const day = dayRating(board([base(1), base(2, { attack: [3, 2, 17] })]), "warEnded");
    expect(day.total).toBe(-10 + 7);
    expect(day.players.map((p) => p.share)).toEqual([0, 0]);
  });

  it("is provisional while the day runs, with no penalty yet for an attack not used", () => {
    const day = dayRating(board([base(1), base(2, { attack: [3, 2, 17] })]), "inWar");
    expect(day.status).toBe("provisional");
    expect(day.players.map((p) => p.marks)).toEqual([0, 7]);
  });

  it("counts a day the sync never saw finish once the season is over", () => {
    const day = dayRating(board([base(1)]), "inWar", true);
    expect(day.status).toBe("counted");
    expect(day.players[0]!.marks).toBe(-10);
  });

  it("does not rate a preparation day, or a day whose enemy lineup was never recorded", () => {
    expect(dayRating(board([base(1)]), "preparation")).toEqual({ status: "notStarted", total: 0, players: [] });
    expect(dayRating(board([base(1, { attack: [3, null, null] })], false), "warEnded")).toEqual({
      status: "notRated",
      total: 0,
      players: [],
    });
  });
});

describe("seasonRating", () => {
  const day1 = board([
    base(1, { attack: [3, 1, 17] }), // 7
    base(2, { attack: [2, 2, 17] }), // 3
  ]);
  const day2 = board([
    base(1, { attack: [2, 1, 17] }), // 3
    base(3, { attack: [3, 3, 17] }), // 7 — only fielded on day 2
  ]);
  const live = board([
    base(1), // not attacked yet
    base(2, { attack: [3, 2, 17] }), // 7
  ]);

  const season = seasonRating([
    { dayNumber: 1, state: "warEnded", board: day1 },
    { dayNumber: 2, state: "warEnded", board: day2 },
    { dayNumber: 3, state: "inWar", board: live },
    { dayNumber: 4, state: "preparation", board: board([base(1), base(2)]) },
  ]);

  it("adds the finished days' shares up, and leaves the running day out", () => {
    const us1 = season.players.find((p) => p.name === "Us 1")!;
    expect(us1.rating).toBeCloseTo(70 + 30, 6);
    expect(us1.marks).toBe(10);
    expect(us1.daysCounted).toBe(2);
    expect(us1.provisional?.marks).toBe(0);

    const us2 = season.players.find((p) => p.name === "Us 2")!;
    expect(us2.rating).toBeCloseTo(30, 6);
    expect(us2.provisional?.share).toBeCloseTo(100, 6);
  });

  it("ranks by the rating", () => {
    expect(season.players.map((p) => p.name)).toEqual(["Us 1", "Us 3", "Us 2"]);
  });

  it("keeps a slot per day, empty where a player was not in the lineup", () => {
    const us3 = season.players.find((p) => p.name === "Us 3")!;
    expect(us3.days.map((d) => d?.marks ?? null)).toEqual([null, 7, null, null]);
    expect(season.days.map((d) => d.status)).toEqual(["counted", "counted", "provisional", "notStarted"]);
    expect(season.started).toBe(true);
  });

  it("orders by the running day while nothing has finished yet", () => {
    const first = seasonRating([{ dayNumber: 1, state: "inWar", board: live }]);
    expect(first.started).toBe(false);
    expect(first.players.map((p) => [p.name, p.rating])).toEqual([
      ["Us 2", 0],
      ["Us 1", 0],
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
