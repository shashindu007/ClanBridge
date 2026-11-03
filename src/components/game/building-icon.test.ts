// A building square must always draw SOMETHING, like UnitIcon: the Fan Kit
// picture when the manifest has it, and its kind's token when it does not.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BuildingIcon } from "@/components/game/building-icon";
import type { ArtManifest } from "@/lib/game-art";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }),
}));

const EMPTY: ArtManifest = { source: null, files: {} };
const WITH_CANNON: ArtManifest = {
  source: { fanKit: "test", generatedAt: "2026-11-03" },
  files: {
    "building-cannon": { src: "/game/buildings/building-cannon.webp", width: 104, height: 104 },
  },
};

const render = (props: Parameters<typeof BuildingIcon>[0]) =>
  renderToStaticMarkup(createElement(BuildingIcon, props));

describe("BuildingIcon", () => {
  it("draws its kind's token when there is no art", () => {
    const glyph = (kind: string) => render({ name: "Thing", village: "home", kind, manifest: EMPTY });
    expect(glyph("Defense")).toContain("lucide-castle");
    expect(glyph("trap")).toContain("lucide-bomb");
    expect(glyph("Wall")).toContain("lucide-brick-wall");
    expect(glyph("Resource")).toContain("lucide-coins");
    expect(glyph("Army")).toContain("lucide-tent");
    expect(glyph("Other")).toContain("lucide-box");
  });

  it("uses the Fan Kit picture when there is one, for its own village only", () => {
    const home = render({ name: "Cannon", village: "home", kind: "Defense", manifest: WITH_CANNON });
    expect(home).toContain("/game/buildings/building-cannon.webp");
    const builder = render({ name: "Cannon", village: "builder", kind: "Defense", manifest: WITH_CANNON });
    expect(builder).not.toContain("building-cannon.webp");
    expect(builder).toContain("cb-unit-token");
  });

  it("puts the level on the plate, gold when maxed, and none for level 0", () => {
    const maxed = render({
      name: "Cannon",
      village: "home",
      kind: "Defense",
      level: 21,
      maxed: true,
      manifest: EMPTY,
    });
    expect(maxed).toContain("cb-unit-level-max");
    expect(maxed).toContain(">21<");
    const none = render({ name: "Cannon", village: "home", kind: "Defense", level: 0, manifest: EMPTY });
    expect(none).not.toContain("cb-unit-level");
  });
});
