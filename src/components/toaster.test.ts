// The toast, actually rendered.
//
// Same approach as clan-nav-rail.test.ts: react-dom/server with next/navigation
// mocked, asserting the MARKUP. There is no jsdom in this suite and none is
// needed — what matters is which role and which aria-live attribute come out,
// and those are the two things a live region gets wrong silently.
//
// useEffect does not run under renderToStaticMarkup, so the param-stripping and
// the auto-dismiss timer are out of scope here by construction. What is in scope
// is the part that must be right on the FIRST paint: the region exists even when
// empty, because a screen reader that starts watching after the text has already
// landed announces nothing at all.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let params = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => params,
  usePathname: () => "/%232PP0JCCL/members",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const { Toaster } = await import("@/components/toaster");

const render = (query = "") => {
  params = new URLSearchParams(query);
  return renderToStaticMarkup(createElement(Toaster));
};

beforeEach(() => {
  params = new URLSearchParams();
});

describe("Toaster", () => {
  // THE LIVE-REGION RULE. The container has to be in the document before the
  // message arrives, or assistive technology has nothing to observe. Rendering
  // the whole thing conditionally is the usual way this is built wrong.
  it("renders the live region even with nothing to say", () => {
    const html = render();
    expect(html).toContain("aria-live");
    expect(html).not.toContain("role=\"status\"");
    expect(html).not.toContain("role=\"alert\"");
  });

  it("shows a success as a polite status", () => {
    const html = render("ok=roster-added");
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('role="status"');
    expect(html).toContain("Added to the roster.");
    expect(html).toContain("Done");
  });

  // Assertive, because a failed write is worth interrupting what is being read.
  it("shows a failure as an assertive alert", () => {
    const html = render("error=forbidden");
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("You do not have permission to do that.");
    expect(html).toContain("That did not work");
  });

  // The pass-through, end to end: the roster double-booking guard sends a
  // sentence naming the clashing clan, and it must reach the member unchanged.
  it("passes an unmapped message straight through", () => {
    const html = render(`error=${encodeURIComponent("Already in the DH v2 roster.")}`);
    expect(html).toContain("Already in the DH v2 roster.");
  });

  // An error and a success cannot both be true, and showing two toasts for one
  // action would be worse than showing the wrong one. Failure wins.
  it("prefers the failure when both params are present", () => {
    const html = render("ok=roster-added&error=forbidden");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Added to the roster.");
  });

  it("carries a dismiss control", () => {
    expect(render("ok=voted")).toContain('aria-label="Dismiss"');
  });

  // globals.css requires every status colour to ship with an icon AND a word,
  // because --warning is deliberately sub-3:1 and one reader in eight cannot
  // separate red from green. Colour alone is never the signal.
  it("never signals with colour alone", () => {
    for (const [query, word] of [
      ["ok=voted", "Done"],
      ["error=forbidden", "That did not work"],
    ] as const) {
      const html = render(query);
      expect(html, word).toContain(word);
      expect(html, "an icon must accompany the colour").toContain("<svg");
    }
  });
});
