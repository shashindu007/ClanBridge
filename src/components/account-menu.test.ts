// The account menu, rendered. It pins ONE rule: every destination has one name,
// and it is the name of the page it opens.
//
// The menu this replaced said "My bases" for a page titled "Your account",
// "Sign-in" for "Account" and "Help" for "Getting started", while the rail and
// Home called /roster "Rosters" and "CWL lineups" on the same screen. A member
// cannot learn a product whose signposts disagree with its pages. These labels
// are asserted against the page headings, so renaming one without the other
// fails here.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/account-menu";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children?: unknown }) =>
    createElement("a", { href, ...rest }, children as never),
}));

const render = (props: Partial<Parameters<typeof AccountMenu>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(AccountMenu, {
      username: "shashindu007",
      email: "someone@example.com",
      showAdmin: true,
      showLeadership: true,
      showParticipation: true,
      ...props,
    }),
  );

/** The visible text of the one link to `href`, or null when there is none. */
function linkText(html: string, href: string): string | null {
  const re = new RegExp(`<a href="${href.replace(/\//g, "\\/")}"[^>]*>(.*?)</a>`, "g");
  const matches = [...html.matchAll(re)];
  if (matches.length === 0) return null;
  expect(matches, `${href} is linked more than once`).toHaveLength(1);
  return matches[0][1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
}

/**
 * The h1 a page renders, read from its source: a literal <h1>, or the `title`
 * of the shared PageHeader, which renders the h1 for most pages now.
 */
function heading(page: string): string {
  const source = readFileSync(`src/app/(app)/${page}/page.tsx`, "utf8");
  const match =
    /<h1[^>]*>([^<]+)<\/h1>/.exec(source) ?? /<PageHeader[^>]*?\btitle="([^"]+)"/.exec(source);
  if (!match) throw new Error(`no literal heading in ${page}`);
  return match[1].replace(/&amp;/g, "&").trim();
}

describe("account menu", () => {
  it("names each page by its own title", () => {
    const html = render();
    expect(linkText(html, "/account")).toBe(heading("account"));
    expect(linkText(html, "/settings/account")).toBe(heading("settings/account"));
    expect(linkText(html, "/guide")).toBe(heading("guide"));
  });

  it("calls the leaders' pages what the rail calls them", () => {
    const html = render();
    expect(linkText(html, "/roster")).toBe("CWL lineups");
    expect(linkText(html, "/report")).toBe("Participation");
  });

  it("keeps Feedback and People reachable", () => {
    const html = render();
    expect(linkText(html, "/feedback")).toBe("Feedback");
    expect(linkText(html, "/people")).toBe("People");
  });

  it("does not link the notifications feed, which the bell already does", () => {
    expect(linkText(render(), "/notifications")).toBeNull();
  });

  it("shows leaders' and admin links only to those who have them", () => {
    const html = render({ showAdmin: false, showLeadership: false });
    expect(linkText(html, "/roster")).toBeNull();
    expect(linkText(html, "/admin")).toBeNull();
  });

  it("shows Participation to an ordinary member, not only to leaders", () => {
    const html = render({ showAdmin: false, showLeadership: false });
    expect(linkText(html, "/report")).toBe("Participation");
    expect(linkText(render({ showParticipation: false }), "/report")).toBeNull();
  });

  it("floats above the page as a menu, not as one more panel", () => {
    const html = render();
    expect(html).toContain("cb-popover");
    expect(html).not.toContain("cb-panel");
  });
});
