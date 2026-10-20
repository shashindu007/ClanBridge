import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { raidSeasonsSchema } from "@/integration/coc-schemas";
import { mapRaidSeasons } from "@/integration/mappers";
import type { RaidAttackRow, RaidOpponentRow, RaidParticipantRow } from "@/repositories/raids";
import {
  attackLines,
  leagueStep,
  monthRaidRating,
  raidWeekendRating,
  signed2,
  type RaidWeekendRating,
} from "./raid-rating";

const GOLD_I = 85_000_009;

/** The marks of one attack that took a district from `before`% to `after`%. */
const marks = (before: number, after: number, league = 0) =>
  Math.round(attackLines({ before, after, league }).reduce((t, l) => t + l.marks, 0) * 100) / 100;

function participant(n: number, over: Partial<RaidParticipantRow> = {}): RaidParticipantRow {
  return {
    playerId: `p${n}`,
    tag: `#P${n}`,
    name: `Player ${n}`,
    attacksUsed: 6,
    attackLimit: 5,
    bonusAttackLimit: 1,
    loot: 0,
    ...over,
  };
}

/** Player `n`'s attack on district `district` of raid 1, taking it to `after`%. */
function hit(n: number, district: number, attackNumber: number, after: number): RaidAttackRow {
  return {
    raidNumber: 1,
    districtId: district,
    districtName: `District ${district}`,
    districtHallLevel: 5,
    attackNumber,
    playerId: `p${n}`,
    tag: `#P${n}`,
    name: `Player ${n}`,
    destruction: after,
    stars: 0,
  };
}

const goldI: RaidOpponentRow = {
  raidNumber: 1,
  defenderTag: "#ENEMY",
  defenderName: "Enemy",
  capitalLeagueId: GOLD_I,
  capitalLeague: "Gold League I",
};

describe("one attack", () => {
  it("gives +1.00 for every 100% destroyed, by the attack's own share", () => {
    // A 0→38, B 38→78, C 78→100: 38, 40 and 22 of the district.
    expect(marks(0, 38)).toBe(0.38);
    expect(marks(38, 78)).toBe(0.4 + 0.5); // 40% is a big hit
    expect(marks(78, 100)).toBe(0.22 + 0.5); // and C finished it
  });

  it("gives +0.50 for 40% or more and +1.00 for 50% or more — the higher only", () => {
    expect(marks(0, 39)).toBe(0.39);
    expect(marks(0, 40)).toBe(0.9);
    expect(marks(0, 49)).toBe(0.99);
    expect(marks(0, 50)).toBe(1.5);
    expect(marks(0, 61)).toBe(1.61);
  });

  it("gives +3.00 more for a solo clear, on top of finishing and the big hit", () => {
    expect(marks(0, 100)).toBe(1 + 0.5 + 3 + 1);
  });

  it("takes −2.00 for under 20%, but not from an attack that finished the district", () => {
    expect(marks(0, 12)).toBe(-1.88);
    expect(marks(40, 59)).toBe(-1.81);
    // A clean-up of 8% that finishes is the job.
    expect(marks(92, 100)).toBe(0.58);
    expect(marks(40, 60)).toBe(0.2); // exactly 20% is not under it
  });

  it("gives +0.10 for each step of the raided clan's league", () => {
    expect(leagueStep(85_000_001, null)).toBe(1);
    expect(leagueStep(GOLD_I, null)).toBe(9);
    expect(leagueStep(85_000_022, null)).toBe(22);
    expect(leagueStep(85_000_000, "Unranked")).toBe(0);
    expect(leagueStep(null, "Crystal League II")).toBe(11);
    expect(leagueStep(null, null)).toBe(0);
    expect(marks(0, 38, 9)).toBe(0.38 + 0.9);
    expect(marks(0, 38, 22)).toBe(0.38 + 2.2);
  });
});

describe("one weekend", () => {
  const weekend = (over: Partial<Parameters<typeof raidWeekendRating>[0]> = {}) =>
    raidWeekendRating({
      state: "ended",
      captured: true,
      participants: [],
      attacks: [],
      opponents: [],
      ...over,
    });

  it("works each attack's share out from the attack before it on the same district", () => {
    const rating = weekend({
      participants: [participant(1), participant(2), participant(3)],
      attacks: [hit(3, 1, 3, 100), hit(1, 1, 1, 38), hit(2, 1, 2, 78)],
    });
    const share = (n: number) => rating.players.find((p) => p.playerId === `p${n}`)!.attacks[0]!.share;
    expect([share(1), share(2), share(3)]).toEqual([38, 40, 22]);
  });

  it("gives each attack the league of the clan it raided", () => {
    const rating = weekend({ participants: [participant(1)], attacks: [hit(1, 1, 1, 38)], opponents: [goldI] });
    expect(rating.players[0]!.attacks[0]!.lines).toContainEqual({ label: "Gold League I", marks: 0.9 });
  });

  it("gives +1.00 for every 10,000 capital gold", () => {
    const rating = weekend({ participants: [participant(1, { loot: 28_732 })] });
    expect(rating.players[0]!.weekendLines).toEqual([{ label: "28,732 capital gold", marks: 2.87 }]);
  });

  it("takes −4.00 for each attack not used, from a player who attacked at least once", () => {
    const rating = weekend({
      participants: [participant(1, { attacksUsed: 1 }), participant(2, { attacksUsed: 0 })],
      attacks: [hit(1, 1, 1, 44)],
    });
    const one = rating.players.find((p) => p.playerId === "p1")!;
    expect(one.weekendLines).toContainEqual({ label: "5 attacks not used", marks: -20 });
    // Never attacked: nothing either way.
    const none = rating.players.find((p) => p.playerId === "p2")!;
    expect(none.marks).toBe(0);
  });

  it("does not take marks for unused attacks while the weekend is still on", () => {
    const rating = weekend({
      state: "ongoing",
      participants: [participant(1, { attacksUsed: 1 })],
      attacks: [hit(1, 1, 1, 44)],
    });
    expect(rating.status).toBe("provisional");
    expect(rating.players[0]!.weekendLines).toEqual([]);
  });

  it("does not count the bonus attack for a player who never earned it", () => {
    const rating = weekend({
      participants: [participant(1, { attacksUsed: 5, bonusAttackLimit: 0 })],
    });
    expect(rating.players[0]!.weekendLines).toEqual([]);
  });

  it("shares out the clan's plus marks, and a minus total is a minus share", () => {
    const rating = weekend({
      participants: [participant(1), participant(2), participant(3, { attacksUsed: 1 })],
      attacks: [hit(1, 1, 1, 100), hit(2, 2, 1, 100), hit(3, 3, 1, 10)],
    });
    expect(rating.total).toBe(11);
    const [a, b, c] = rating.players;
    expect(a!.share + b!.share).toBeCloseTo(100);
    expect(c!.marks).toBe(0.1 - 2 - 20);
    // −21.9 of 11 would be −199%; a share never goes below −100%.
    expect(c!.share).toBe(-100);
  });

  it("does not rate a weekend whose attacks were never captured", () => {
    const rating = weekend({ captured: false, participants: [participant(1, { loot: 50_000 })] });
    expect(rating).toEqual({ status: "notRated", total: 0, players: [] });
  });
});

// The worked example the clan agreed the rules on: the fixture's latest
// weekend, with every enemy taken to be in Gold League I.
describe("the agreed worked example", () => {
  const fixture = raidSeasonsSchema.parse(
    JSON.parse(readFileSync(join(process.cwd(), "fixtures", "capitalraids.json"), "utf8")),
  );
  const latest = mapRaidSeasons(fixture)[0]!;

  const rating = raidWeekendRating({
    state: "ended",
    captured: true,
    participants: latest.participants.map((p) => ({
      playerId: p.playerTag,
      tag: p.playerTag,
      name: p.name,
      attacksUsed: p.attacksUsed ?? null,
      attackLimit: p.attackLimit ?? null,
      bonusAttackLimit: p.bonusAttackLimit ?? null,
      loot: p.loot ?? null,
    })),
    attacks: latest.raids!.flatMap((raid) =>
      raid.attacks.map((a) => ({
        raidNumber: raid.raidNumber,
        districtId: a.districtId,
        districtName: a.districtName ?? null,
        districtHallLevel: a.districtHallLevel ?? null,
        attackNumber: a.attackNumber,
        playerId: a.playerTag,
        tag: a.playerTag,
        name: a.name ?? "",
        destruction: a.destruction,
        stars: a.stars,
      })),
    ),
    opponents: latest.raids!.map((raid) => ({
      raidNumber: raid.raidNumber,
      defenderTag: raid.defenderTag,
      defenderName: raid.defenderName ?? null,
      capitalLeagueId: GOLD_I,
      capitalLeague: "Gold League I",
    })),
  });
  const player = (name: string) => rating.players.find((p) => p.name === name)!;

  it("gives NETHAN +13.74", () => {
    // 2.47 destroyed, 1.50 for three finishes, 1.00 for the 61% and 0.50 for
    // the 47%, 5.40 league, 2.87 gold.
    expect(player("NETHAN").marks).toBe(13.74);
  });

  it("gives Jona 1 −17.12", () => {
    // 0.44 destroyed, 0.50 finished, 0.50 for 44% in one attack, 0.90 league,
    // 0.54 gold, −20.00 for five unused.
    expect(player("Jona 1").marks).toBe(-17.12);
  });
});

describe("the month", () => {
  const weekend = (status: RaidWeekendRating["status"], share: number, marksOf: number): RaidWeekendRating => ({
    status,
    total: 10,
    players: [
      {
        playerId: "p1",
        tag: "#P1",
        name: "Player 1",
        attacks: [],
        used: 6,
        offered: 6,
        loot: 0,
        weekendLines: [],
        attackMarks: marksOf,
        marks: marksOf,
        share,
      },
    ],
  });

  it("adds up the finished weekends' shares, and shows the running one beside them", () => {
    const month = monthRaidRating([
      { id: "w1", startTime: "2026-08-07T07:00:00.000Z", rating: weekend("counted", 20, 4) },
      { id: "w2", startTime: "2026-08-14T07:00:00.000Z", rating: weekend("counted", 30, 6) },
      { id: "w3", startTime: "2026-08-21T07:00:00.000Z", rating: weekend("provisional", 50, 9) },
    ]);
    const p = month.players[0]!;
    expect(p.rating).toBe(50);
    expect(p.marks).toBe(10);
    expect(p.weekendsCounted).toBe(2);
    expect(p.perWeekend).toBe(25);
    expect(p.provisional?.share).toBe(50);
    expect(month.started).toBe(true);
  });
});

describe("signed2", () => {
  it("prints marks to two decimals with a real minus", () => {
    expect(signed2(0.38)).toBe("+0.38");
    expect(signed2(13.24)).toBe("+13.24");
    expect(signed2(-17.62)).toBe("−17.62");
    expect(signed2(5)).toBe("+5.00");
    expect(signed2(0)).toBe("0");
  });
});
