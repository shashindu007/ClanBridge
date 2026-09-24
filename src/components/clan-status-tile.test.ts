// A clan tile on Home, rendered. It must answer "what is happening" and "what
// do I owe" in words in every state, carry gold only when told to, and be one
// link to the clan with the action button beside it rather than inside it.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClanStatusTile } from "@/components/clan-status-tile";
import type { ClanStatus } from "@/services/home";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));
vi.mock("next/image", () => ({
  default: ({ src, alt }: { src: string; alt: string }) => createElement("img", { src, alt }),
}));

const clan = {
  id: "c1",
  tag: "#2PP0JCCL",
  name: "Dark Hell",
  role: "co-leader",
  badgeUrl: null,
  color: "var(--clan-1)",
};

const fresh = { level: "fresh", label: "just now" } as never;

function render(status: ClanStatus, over: { gold?: boolean; clanLeft?: number | null } = {}) {
  return renderToStaticMarkup(
    createElement(ClanStatusTile, {
      clan,
      status,
      memberCount: 48,
      level: 17,
      warLeague: "Master League III",
      fresh,
      gold: over.gold ?? false,
      clanLeft: over.clanLeft ?? null,
    }),
  );
}

const war = (mine: ClanStatus["mine"]): ClanStatus => ({
  kind: "war",
  tone: "war",
  label: "WAR · 12h",
  mine,
  href: "/%232PP0JCCL/war",
});

describe("ClanStatusTile", () => {
  it("leads with the ribbon's words and the attacks you owe", () => {
    const out = render(war({ left: 2, allowed: 2 }), { gold: true });
    expect(out).toContain("WAR · 12h");
    expect(out).toContain("attacks left</span>");
    expect(out).toContain(">2</span>");
    expect(out).toContain('data-variant="gold"');
    expect(out).toContain('href="/%232PP0JCCL/war"');
  });

  it("is outline, not gold, when another tile has the gold", () => {
    const out = render(war({ left: 1, allowed: 2 }), { gold: false });
    expect(out).not.toContain('data-variant="gold"');
    expect(out).toContain('data-variant="outline"');
  });

  it("says so when every attack is used", () => {
    expect(render(war({ left: 0, allowed: 2 }))).toContain("All 2 attacks used");
  });

  it("says you are not in the war, and how many the clan has left for a leader", () => {
    expect(render(war(null), { clanLeft: 7 })).toContain("Not in this war · 7 unused in the clan");
  });

  it("is one link to the clan, with facts in a line", () => {
    const out = render({ kind: "idle", tone: "neutral", label: "NO WAR", mine: null, href: "/x/war" });
    expect(out).toContain('aria-label="Open Dark Hell"');
    expect(out).toContain('href="/%232PP0JCCL"');
    expect(out).toContain("No war on right now");
    expect(out).toContain(">members</dt>");
    expect(out).toContain("Master III");
    expect(out).not.toContain("<button");
  });
});
