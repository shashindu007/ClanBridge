// 065 — the career panel, rendered the way player-report-sections.test.ts
// renders its component: renderToStaticMarkup from a .ts file, createElement
// rather than JSX.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlayerCareer } from "@/components/player-career";
import type { PlayerProfileRow } from "@/repositories/profiles";

const PROFILE: PlayerProfileRow = {
  warPreference: "in",
  expLevel: 231,
  bestTrophies: 5600,
  attackWins: 12,
  defenseWins: 3,
  warStars: 1240,
  capitalContributions: 4_200_000,
  builderBaseTrophies: 3100,
  bestBuilderBaseTrophies: 3400,
  achievements: [
    { name: "Bigger Coffers", stars: 3, value: 17, target: 10, info: "Upgrade a Gold Storage", village: "home" },
    { name: "Gold Grab", stars: 2, value: 400, target: 1000, village: "home" },
    { name: "Master Engineering", stars: 1, value: 4, target: 8, village: "builder" },
    { name: "Aggressive Capitalism", stars: 2, value: 900, target: 2000, village: "capital" },
  ],
  capturedAt: "2026-10-29T06:11:00.000Z",
};

const render = (profile: PlayerProfileRow | null) =>
  renderToStaticMarkup(createElement(PlayerCareer, { profile }));

describe("PlayerCareer", () => {
  it("says it has not been read yet, rather than showing zeros", () => {
    const html = render(null);
    expect(html).toContain("Not read yet");
    expect(html).not.toContain("War stars");
  });

  it("shows the lifetime numbers, labelled as lifetime", () => {
    const html = render(PROFILE);
    expect(html).toContain("Lifetime, from the game");
    expect(html).toContain("1,240");
    expect(html).toContain("4,200,000");
    expect(html).toContain("5,600");
  });

  it("counts achievements with three stars, and shows the next goal only for unfinished ones", () => {
    const html = render(PROFILE);
    expect(html).toContain("1 of 4 with three stars");
    expect(html).toContain("400 of 1,000");
    // Finished: the value alone, not "17 of 10".
    expect(html).not.toContain("17 of 10");
    expect(html).toContain("Builder Base");
    expect(html).toContain("Clan Capital");
  });

  it("leaves the achievements out when the game sent none", () => {
    expect(render({ ...PROFILE, achievements: [] })).not.toContain("Achievements");
  });
});
