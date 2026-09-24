// The rail, actually rendered.
//
// Written because the bug it covers was reported from a screenshot rather than
// caught here: switching to "DH CWL ONLY" left "Dark Heaven" lit, because the
// layout read the path from a request header and a layout is not re-rendered on
// a client-side navigation. Every pure part of that was already tested and every
// one of those tests passed. What was missing was a test that renders the thing
// and asks which pill came out marked.
//
// react-dom/server rather than a DOM testing library: the suite runs in node
// with no jsdom, and what matters here is the MARKUP — which href, which
// aria-current. useEffect does not run under renderToStaticMarkup, so the
// scroll-into-view is deliberately out of scope; it is a convenience on top of
// a switcher that is correct without it.
//
// Named .ts rather than .tsx so it is picked up by the existing vitest include
// patterns without touching the config. createElement instead of JSX is the
// whole cost of that.

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let pathname = "/";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

// next/link needs a router it has no business having here, and everything under
// test is the href and the class it puts on the anchor.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children?: unknown;
  } & Record<string, unknown>) => createElement("a", { href, ...rest }, children as never),
}));

const { ClanSectionTabs, ClanMenu } = await import("@/components/clan-nav-rail");

const CLANS = [
  { id: "a", tag: "#2PP0JCCL", name: "Dark Heaven", role: "leader", color: "var(--clan-1)" },
  { id: "b", tag: "#2G8YQYRGJ", name: "DH CWL ONLY", role: "leader", color: "var(--clan-2)" },
  { id: "c", tag: "#2Y9J20JCY", name: "Dark Hell", role: "leader", color: "var(--clan-3)" },
];

const render = (el: ReactElement) => renderToStaticMarkup(el);

/** The name inside the one anchor carrying aria-current="page". */
function currentLabel(html: string): string | null {
  // Anchors are self-contained; the marked one is the only aria-current there is.
  const match = /<a[^>]*aria-current="page"[^>]*>(.*?)<\/a>/s.exec(html);
  if (!match) return null;
  return match[1]!.replace(/<[^>]*>/g, "").trim();
}

beforeEach(() => {
  pathname = "/";
});

/** The clan the menu marks current: the one link with aria-current, by its data-clan. */
function currentClan(html: string): string | null {
  const match = /<a(?=[^>]*aria-current="page")[^>]*data-clan="([^"]*)"/.exec(html);
  return match ? match[1]! : null;
}

/** What the closed menu says — the answer to "which clan am I looking at?". */
function summaryLabel(html: string): string | null {
  const match = /<span[^>]*data-clan-summary[^>]*>(.*?)<\/span>/s.exec(html);
  return match ? match[1]!.trim() : null;
}

describe("ClanMenu — the reported bug", () => {
  // THE REGRESSION, stated the way it was reported: pick DH CWL ONLY, and
  // Dark Heaven stays lit.
  it("marks the clan in the path, not the first one in the list", () => {
    pathname = "/%232G8YQYRGJ";
    const html = render(createElement(ClanMenu, { clans: CLANS }));
    expect(currentClan(html)).toBe("DH CWL ONLY");
    expect(summaryLabel(html)).toBe("DH CWL ONLY");
  });

  it("follows the path to each clan in turn", () => {
    for (const clan of CLANS) {
      pathname = `/${encodeURIComponent(clan.tag)}`;
      const html = render(createElement(ClanMenu, { clans: CLANS }));
      expect(currentClan(html)).toBe(clan.name);
      expect(summaryLabel(html)).toBe(clan.name);
    }
  });

  // The menu must stay on the clan on the pages INSIDE a clan, not only its
  // dashboard — otherwise a member on /members is shown no current clan at all.
  it("stays on the clan while inside its pages", () => {
    pathname = "/%232G8YQYRGJ/war/lineup";
    expect(currentClan(render(createElement(ClanMenu, { clans: CLANS })))).toBe("DH CWL ONLY");
  });

  it("marks nothing on a cross-clan page, and says Clans", () => {
    for (const path of ["/roster", "/report", "/admin", "/guide"]) {
      pathname = path;
      const html = render(createElement(ClanMenu, { clans: CLANS }));
      expect(currentClan(html)).toBeNull();
      expect(summaryLabel(html)).toBe("Clans");
    }
  });

  it("marks exactly one clan, never two", () => {
    pathname = "/%232Y9J20JCY";
    const html = render(createElement(ClanMenu, { clans: CLANS }));
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  });

  it("links every clan, and the way back to all of them", () => {
    const html = render(createElement(ClanMenu, { clans: CLANS }));
    for (const clan of CLANS) expect(html).toContain(`href="/${encodeURIComponent(clan.tag)}"`);
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain("All clans</a>");
  });

  it("renders nothing for a member with no clans", () => {
    expect(render(createElement(ClanMenu, { clans: [] }))).toBe("");
  });
});

describe("ClanSectionTabs — the half that was worse", () => {
  // The tabs built their hrefs from the same stale tag, so after switching clans
  // every one of them pointed back into the clan the member had just left.
  it("builds every href under the clan in the path", () => {
    pathname = "/%232G8YQYRGJ/members";
    const html = render(createElement(ClanSectionTabs, { clans: CLANS }));

    expect(html).toContain('href="/%232G8YQYRGJ/members"');
    expect(html).toContain('href="/%232G8YQYRGJ/war"');
    expect(html).toContain('href="/%232G8YQYRGJ/cwl"');
    // The clan that used to leak through.
    expect(html).not.toContain("2PP0JCCL");
  });

  it("marks the section the member is on", () => {
    pathname = "/%232G8YQYRGJ/members";
    expect(
      currentLabel(render(createElement(ClanSectionTabs, { clans: CLANS }))),
    ).toBe("Members");
  });

  it("renders the second row inside a section that has one", () => {
    pathname = "/%232G8YQYRGJ/war/lineup";
    const html = render(createElement(ClanSectionTabs, { clans: CLANS }));
    expect(html).toContain('href="/%232G8YQYRGJ/war/history"');
    expect(html).toContain('href="/%232G8YQYRGJ/war/report"');
  });

  it("renders nothing at all outside a clan", () => {
    for (const path of ["/roster", "/report", "/admin", "/settings/account"]) {
      pathname = path;
      expect(render(createElement(ClanSectionTabs, { clans: CLANS }))).toBe("");
    }
  });

  // A layout renders around a page that calls notFound(), so without this gate a
  // tag the member does not belong to would produce a full set of tabs whose
  // every link 404s.
  it("renders nothing for a tag that is not one of the member's clans", () => {
    pathname = "/%232NOTMINE";
    expect(render(createElement(ClanSectionTabs, { clans: CLANS }))).toBe("");
  });

  it("carries each destination's hint as its title, for a first-time reader", () => {
    pathname = "/%232G8YQYRGJ";
    const html = render(createElement(ClanSectionTabs, { clans: CLANS }));
    expect(html).toContain("Donations, ratios, who has gone quiet");
  });
});
