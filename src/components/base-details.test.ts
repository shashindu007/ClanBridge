// T11B.9 — the Base details panels, rendered to static markup.
//
// The same approach as player-report-sections.test.ts: a Server Component with
// no state and no effects, so renderToStaticMarkup holds all of it. The reading
// used for the populated cases is the real TH17 fixture put through the sync
// job's own progressRow(), so the page is tested against what the job stores.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BaseDetails, villageParam } from "@/components/base-details";
import { playerSchema } from "@/integration/coc-schemas";
import { mapPlayerProgress } from "@/integration/mappers";
import type { BaseProgress, ProgressReading } from "@/repositories/player-progress";
import type { Village } from "@/types/domain";
import { progressRow } from "../../scripts/sync/players";

const row = progressRow(
  { id: "p", tag: "#PY0LQGRJ", clanId: null },
  mapPlayerProgress(
    playerSchema.parse(
      JSON.parse(readFileSync(join(process.cwd(), "fixtures", "player.json"), "utf8")),
    ),
  ),
);

const latest: ProgressReading = {
  capturedAt: "2026-09-16T06:11:00.000Z",
  thLevel: row.th_level,
  thWeaponLevel: row.th_weapon_level,
  bhLevel: row.bh_level,
  units: row.units,
};

function render(progress: BaseProgress, village: Village = "home"): string {
  return renderToStaticMarkup(
    createElement(BaseDetails, { progress, village, path: "/account/bases/%23PY0LQGRJ/details" }),
  );
}

describe("BaseDetails", () => {
  it("names the sync job when the village has never been read", () => {
    const html = render({ latest: null, baseline: null });
    expect(html).toContain("No details for this base yet");
    expect(html).toContain("sync:players");
  });

  it("shows the Town Hall, weapon and overall figure for the home village", () => {
    const html = render({ latest, baseline: null });
    expect(html).toContain("Town Hall 17");
    expect(html).toContain("weapon 4");
    expect(html).toContain("Heroes");
    expect(html).toContain("Barbarian King");
    // The Town Hall cap, not the game's 110.
    expect(html).toContain("100 / 100");
    expect(html).not.toContain("100 / 110");
  });

  it("switches to the Builder Base through a link, not client state", () => {
    const home = render({ latest, baseline: null }, "home");
    expect(home).toContain('href="/account/bases/%23PY0LQGRJ/details?village=builder"');

    const builder = render({ latest, baseline: null }, "builder");
    expect(builder).toContain("Builder Hall 10");
    expect(builder).toContain("Battle Machine");
    expect(builder).not.toContain("Barbarian King");
  });

  it("marks units whose cap is not known yet, and explains the mark", () => {
    const html = render({ latest, baseline: null });
    // Ruin Witch and Angry Spell are newer than the pinned game data.
    expect(html).toContain("Ruin Witch");
    expect(html).toContain("not known yet");
  });

  it("says there is nothing to compare before a second reading exists", () => {
    const html = render({ latest, baseline: null });
    expect(html).toContain("Only one reading so far");
  });

  it("lists upgrades between the baseline and the latest reading", () => {
    const baseline: ProgressReading = {
      ...latest,
      capturedAt: "2026-09-01T06:11:00.000Z",
      units: latest.units.map((u) =>
        u.name === "Barbarian King" ? { ...u, level: 98 } : u,
      ),
    };
    const html = render({ latest, baseline });
    expect(html).toContain("Upgraded lately");
    expect(html).toContain("98 → 100");
  });

  it("does not call anything rushed — it names what is below the previous cap", () => {
    const behind: ProgressReading = {
      ...latest,
      units: latest.units.map((u) =>
        u.name === "Archer Queen" ? { ...u, level: 50 } : u,
      ),
    };
    const html = render({ latest: behind, baseline: null });
    expect(html).toContain("Below the Town Hall 16 cap");
    expect(html.toLowerCase()).not.toContain("rushed");
  });

  it("says so when a village has no Builder Base units at all", () => {
    const homeOnly: ProgressReading = {
      ...latest,
      bhLevel: null,
      units: latest.units.filter((u) => u.village === "home"),
    };
    expect(render({ latest: homeOnly, baseline: null }, "builder")).toContain(
      "has not unlocked the Builder Base",
    );
  });
});

describe("villageParam", () => {
  it("accepts builder and treats everything else as home", () => {
    expect(villageParam("builder")).toBe("builder");
    expect(villageParam("home")).toBe("home");
    expect(villageParam(undefined)).toBe("home");
    expect(villageParam(["builder"])).toBe("home");
    expect(villageParam("<script>")).toBe("home");
  });
});
