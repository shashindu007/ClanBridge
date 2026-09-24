// The keys game art is filed under, and what happens when it is not there.
//
// The keys are the contract between three things that never import each other:
// scripts/game-art.ts writes files named by them, the manifest lists them, and
// every page asks for them. A key that drifts on one side is art that silently
// never shows — so the derivations are pinned here with the real names the game
// data and the API use.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ART_MANIFEST,
  artKeyForLeague,
  artKeyForTownHall,
  artKeyForUnit,
  artSlug,
  resolveArt,
  type ArtManifest,
} from "@/lib/game-art";
import { TownHall } from "@/components/game/town-hall";
import { ClanBadge } from "@/components/game/clan-badge";
import { GameArt } from "@/components/game/game-art";

// next/image wants a router config it has no use for here; what is under test
// is whether an <img> renders at all, and with which src.
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }),
}));

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

const withArt: ArtManifest = {
  source: { fanKit: "test", generatedAt: "2026-09-24" },
  files: {
    "th-17": { src: "/game/townhall/th-17.webp", width: 160, height: 160 },
  },
};

describe("artSlug", () => {
  it("keeps abbreviations one word and joins the rest with dashes", () => {
    expect(artSlug("P.E.K.K.A")).toBe("pekka");
    expect(artSlug("Barbarian King")).toBe("barbarian-king");
    expect(artSlug("Minion Prince")).toBe("minion-prince");
    expect(artSlug("  Dragon  Duke ")).toBe("dragon-duke");
  });
});

describe("keys", () => {
  it("files a Town Hall by level, and nothing for no level", () => {
    expect(artKeyForTownHall(17)).toBe("th-17");
    expect(artKeyForTownHall(null)).toBeNull();
    expect(artKeyForTownHall(0)).toBeNull();
    expect(artKeyForTownHall(3.5)).toBeNull();
  });

  it("files units by family, so the two villages never collide", () => {
    expect(artKeyForUnit("Barbarian King", "hero")).toBe("hero-barbarian-king");
    expect(artKeyForUnit("Battle Machine", "builderHero")).toBe("hero-battle-machine");
    expect(artKeyForUnit("Baby Dragon", "elixirTroop")).toBe("troop-baby-dragon");
    expect(artKeyForUnit("Baby Dragon", "builderTroop")).toBe("builder-troop-baby-dragon");
    expect(artKeyForUnit("Rage Spell", "elixirSpell")).toBe("spell-rage-spell");
    expect(artKeyForUnit("L.A.S.S.I", "pet")).toBe("pet-lassi");
  });

  it("reads a league's division from its roman numeral", () => {
    expect(artKeyForLeague("Crystal League I")).toBe("league-crystal-1");
    expect(artKeyForLeague("Master League III")).toBe("league-master-3");
    expect(artKeyForLeague("Champion League II")).toBe("league-champion-2");
    expect(artKeyForLeague("Legend League")).toBe("league-legend");
  });

  it("has no picture for no league", () => {
    expect(artKeyForLeague("Unranked")).toBeNull();
    expect(artKeyForLeague(null)).toBeNull();
    expect(artKeyForLeague("")).toBeNull();
  });
});

describe("resolveArt", () => {
  it("answers from the manifest, never from a guess", () => {
    expect(resolveArt("th-17", withArt)?.src).toBe("/game/townhall/th-17.webp");
    expect(resolveArt("th-16", withArt)).toBeNull();
    expect(resolveArt(null, withArt)).toBeNull();
  });

  // The committed manifest is whatever the script last wrote. Whatever it holds,
  // every entry must point under /game/ — the one folder the art rules allow.
  it("only ever points into public/game", () => {
    for (const entry of Object.values(ART_MANIFEST.files)) {
      expect(entry.src.startsWith("/game/")).toBe(true);
    }
  });
});

describe("drawn without art", () => {
  const empty: ArtManifest = { source: null, files: {} };

  it("a Town Hall is a chip that still says Town Hall", () => {
    const out = html(createElement(TownHall, { level: 17, manifest: empty }));
    expect(out).toContain("TH 17");
    expect(out).toContain('aria-label="Town Hall 17"');
    expect(out).not.toContain("<img");
  });

  it("GameArt draws the caller's fallback", () => {
    const out = html(
      createElement(GameArt, {
        art: "th-17",
        size: 40,
        alt: "",
        manifest: empty,
        fallback: createElement("b", null, "fallback"),
      }),
    );
    expect(out).toBe("<b>fallback</b>");
  });

  it("a clan with no badge gets a shield with its initial, not a broken image", () => {
    const out = html(createElement(ClanBadge, { src: null, name: "dark hell" }));
    expect(out).toContain("<svg");
    expect(out).toContain(">D</text>");
    expect(out).toContain('aria-hidden="true"');
  });
});

describe("drawn with art", () => {
  it("a Town Hall shows its picture and keeps its name", () => {
    const out = html(createElement(TownHall, { level: 17, manifest: withArt }));
    expect(out).toContain('src="/game/townhall/th-17.webp"');
    expect(out).toContain('aria-label="Town Hall 17"');
  });

  it("a badge from the API is an image, named when asked", () => {
    const out = html(
      createElement(ClanBadge, {
        src: "https://api-assets.clashofclans.com/badges/200/x.png",
        name: "Dark Hell",
        label: "Dark Hell",
      }),
    );
    expect(out).toContain('src="https://api-assets.clashofclans.com/badges/200/x.png"');
    expect(out).toContain('aria-label="Dark Hell"');
  });
});
