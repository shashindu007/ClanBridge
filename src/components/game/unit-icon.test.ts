// A unit square must always draw SOMETHING: the Fan Kit picture when the
// manifest has it, and its kind's common icon when it does not — never an
// empty box.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { UnitIcon } from "@/components/game/unit-icon";
import type { ArtManifest } from "@/lib/game-art";

vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }),
}));

const EMPTY: ArtManifest = { source: null, files: {} };
const WITH_KING: ArtManifest = {
  source: { fanKit: "test", generatedAt: "2026-09-27" },
  files: {
    "hero-barbarian-king": { src: "/game/heroes/hero-barbarian-king.webp", width: 128, height: 128 },
  },
};

const render = (props: Parameters<typeof UnitIcon>[0]) =>
  renderToStaticMarkup(createElement(UnitIcon, props));

describe("UnitIcon", () => {
  it("draws its kind's common icon when there is no art", () => {
    const troop = render({ name: "Hog Rider", group: "elixirTroop", level: 12, manifest: EMPTY });
    expect(troop).toContain("cb-unit-token");
    expect(troop).toContain("lucide-swords");
    expect(troop).toContain(">12</span>");
    expect(troop).not.toContain("<img");

    expect(render({ name: "Frosty", group: "pet", manifest: EMPTY })).toContain("lucide-paw-print");
    expect(render({ name: "Rage Spell", group: "elixirSpell", manifest: EMPTY })).toContain(
      "lucide-flask-conical",
    );
    expect(render({ name: "Grand Warden", group: "hero", manifest: EMPTY })).toContain("lucide-crown");
  });

  it("draws the Fan Kit picture when the manifest has it", () => {
    const html = render({ name: "Barbarian King", group: "hero", manifest: WITH_KING });
    expect(html).toContain('src="/game/heroes/hero-barbarian-king.webp"');
    expect(html).not.toContain("cb-unit-token");
  });

  it("gilds the level plate when maxed, and drops it when locked", () => {
    const maxed = render({ name: "Wizard", group: "elixirTroop", level: 13, maxed: true, manifest: EMPTY });
    expect(maxed).toContain("cb-unit-level-max");

    const locked = render({ name: "Wizard", group: "elixirTroop", level: 0, locked: true, manifest: EMPTY });
    expect(locked).not.toContain("cb-unit-level");
    expect(locked).toContain("grayscale");
  });
});
