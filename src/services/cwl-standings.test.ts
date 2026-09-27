// The group table. Medals are paid on this ranking, so the two rules the game
// ranks by — ten bonus stars per win, then destruction — are pinned here.

import { describe, expect, it } from "vitest";
import type { GroupClan, GroupWar } from "@/repositories/cwl";
import { groupStandings, ourStanding } from "@/services/cwl-standings";

const clan = (tag: string): GroupClan => ({ tag, name: `Clan ${tag}`, badgeUrl: null, clanLevel: 10 });

function war(
  clanTag: string,
  opponentTag: string,
  stars: [number, number],
  destruction: [number, number],
  state = "warEnded",
): GroupWar {
  return {
    warTag: `#W${clanTag}${opponentTag}`,
    dayNumber: 1,
    state,
    teamSize: 15,
    clanTag,
    opponentTag,
    clanStars: stars[0],
    opponentStars: stars[1],
    clanDestruction: destruction[0],
    opponentDestruction: destruction[1],
    clanAttacks: 15,
    opponentAttacks: 15,
  };
}

describe("groupStandings", () => {
  it("adds ten stars per win and ranks on the total", () => {
    const table = groupStandings(
      [clan("#A"), clan("#B"), clan("#C")],
      [
        // A beats B narrowly; C loses to B heavily.
        war("#A", "#B", [30, 29], [90, 95]),
        war("#C", "#B", [20, 40], [60, 100]),
      ],
      "#A",
    );
    const b = table.find((s) => s.tag === "#B")!;
    const a = table.find((s) => s.tag === "#A")!;
    expect(b).toMatchObject({ attackStars: 69, stars: 79, wins: 1, losses: 1, rank: 1 });
    expect(a).toMatchObject({ attackStars: 30, stars: 40, wins: 1, rank: 2, isUs: true });
    expect(ourStanding(table)?.rank).toBe(2);
  });

  it("breaks a star tie on total destruction", () => {
    const table = groupStandings(
      [clan("#A"), clan("#B")],
      [war("#A", "#B", [30, 30], [95, 96])],
      "#A",
    );
    // Level on stars; B wins the war on destruction and so takes the +10.
    expect(table[0]!.tag).toBe("#B");
    expect(table[0]!.stars).toBe(40);
  });

  it("counts a live war's stars but gives its bonus to nobody yet", () => {
    const table = groupStandings(
      [clan("#A"), clan("#B")],
      [war("#A", "#B", [12, 3], [40, 10], "inWar")],
      "#A",
    );
    expect(table[0]).toMatchObject({ tag: "#A", stars: 12, wins: 0, played: 1 });
  });

  it("ignores preparation, and still lists a clan with no score", () => {
    const table = groupStandings(
      [clan("#A"), clan("#B"), clan("#C")],
      [war("#A", "#B", [0, 0], [0, 0], "preparation")],
      "#C",
    );
    expect(table).toHaveLength(3);
    expect(table.every((s) => s.stars === 0 && s.played === 0)).toBe(true);
  });
});
