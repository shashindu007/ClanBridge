// The shared kit, rendered statically. What these pin are the promises each
// piece makes to whoever uses it: a ribbon always has words, a fact always has
// its label, a linked tile is one link and never a link inside a link.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Swords, Users } from "lucide-react";
import { Disclosure, FactRow, ListRow, Tile } from "@/components/kit";
import { Ribbon } from "@/components/game/ribbon";
import { WarScoreboard } from "@/components/war-scoreboard";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) =>
    createElement("a", { href, ...rest }, children),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }),
}));

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

/** createElement for a component whose children are required, passed as children. */
function withChildren<P extends { children: React.ReactNode }>(
  type: React.ComponentType<P>,
  props: Omit<P, "children">,
  ...children: React.ReactNode[]
) {
  return createElement(type as React.ComponentType<Omit<P, "children">>, props, ...children);
}
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

describe("Ribbon", () => {
  it("carries its words, and its tone only as decoration", () => {
    const out = html(withChildren(Ribbon, { tone: "war", icon: Swords }, "WAR · 12h"));
    expect(out).toContain("WAR · 12h");
    expect(out).toContain('data-tone="war"');
    expect(out).toContain("--ribbon:var(--ribbon-war)");
  });
});

describe("FactRow", () => {
  it("names every value in a description list", () => {
    const out = html(
      createElement(FactRow, {
        items: [
          { label: "members", value: 48, icon: Users },
          { label: "level", value: 17 },
        ],
      }),
    );
    expect(out.startsWith("<dl")).toBe(true);
    expect(count(out, "<dt")).toBe(2);
    expect(count(out, "<dd")).toBe(2);
    expect(out).toContain(">members</dt>");
    expect(out).toContain("48");
  });

  it("links a fact above a tile's stretched link", () => {
    const out = html(
      createElement(FactRow, { items: [{ label: "online", value: 3, href: "/people" }] }),
    );
    expect(out).toContain('href="/people"');
    expect(out).toContain("z-10");
  });
});

describe("Tile", () => {
  it("is one link, named, when it has an href", () => {
    const out = html(
      withChildren(Tile, { href: "/2G8YQYRGJ", label: "Open DH CWL ONLY" }, "DH CWL ONLY"),
    );
    expect(count(out, "<a ")).toBe(1);
    expect(out).toContain('aria-label="Open DH CWL ONLY"');
  });

  it("never nests a link inside its link", () => {
    const out = html(
      withChildren(
        Tile,
        { href: "/clan", label: "Open clan" },
        createElement("a", { href: "/clan/war", className: "relative z-10" }, "Attack"),
      ),
    );
    // Two anchors, side by side: the stretched one closes before the button.
    expect(count(out, "<a ")).toBe(2);
    expect(out.indexOf("</a>")).toBeLessThan(out.indexOf('href="/clan/war"'));
  });

  it("puts the accent on the top edge and leaves room for art", () => {
    const out = html(
      withChildren(Tile, { accent: "var(--clan-1)", art: createElement("i", null, "badge") }, "x"),
    );
    expect(out).toContain("--tile-accent:var(--clan-1)");
    expect(out).toContain("-top-7");
  });
});

describe("Disclosure", () => {
  it("shows its title and count while folded", () => {
    const out = html(withChildren(Disclosure, { title: "Their bases", count: 30 }, "table"));
    expect(out).toContain("<details");
    expect(out).not.toContain("<details open");
    expect(out).toContain("Their bases");
    expect(out).toContain(">30<");
  });

  it("opens by default when asked", () => {
    const out = html(withChildren(Disclosure, { title: "Our lineup", defaultOpen: true }, "t"));
    expect(out).toContain("<details open");
  });
});

describe("ListRow", () => {
  it("makes the primary action gold, and only that one", () => {
    const primary = html(
      createElement(ListRow, {
        icon: Swords,
        title: "Attack",
        action: { href: "/w", label: "Attack", primary: true },
      }),
    );
    const plain = html(
      createElement(ListRow, { icon: Swords, title: "See", action: { href: "/w", label: "See" } }),
    );
    expect(primary).toContain('data-variant="gold"');
    expect(plain).toContain('data-variant="outline"');
  });
});

describe("WarScoreboard", () => {
  it("shows both clans' badges, or a shield for an opponent without one", () => {
    const out = html(
      createElement(WarScoreboard, {
        us: { name: "Dark Hell", stars: 30, destruction: 88, badgeUrl: "https://api-assets.clashofclans.com/badges/70/a.png" },
        them: { name: "Foes", stars: 28, destruction: 80, badgeUrl: null },
        accent: "var(--clan-1)",
      }),
    );
    expect(out).toContain('src="https://api-assets.clashofclans.com/badges/70/a.png"');
    expect(out).toContain("<svg");
    expect(out).toContain("VS");
  });
});
