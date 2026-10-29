import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildCsp, createNonce, scriptHash, themeScriptHash } from "./csp";
import { THEME_INIT_SCRIPT } from "./theme";

function directive(csp: string, name: string): string[] {
  const found = csp.split("; ").find((d) => d.startsWith(`${name} `));
  return found ? found.split(" ").slice(1) : [];
}

const SUPABASE = "https://abcd.supabase.co";

describe("buildCsp", () => {
  const csp = buildCsp("NONCE", { dev: false, supabaseUrl: SUPABASE, scriptHashes: ["sha256-X"] });

  it("allows scripts only by nonce, hash, and what they load", () => {
    expect(directive(csp, "script-src")).toEqual([
      "'self'",
      "'nonce-NONCE'",
      "'sha256-X'",
      "'strict-dynamic'",
    ]);
  });

  it("never allows inline scripts or eval in production", () => {
    expect(csp).not.toContain("'unsafe-eval'");
    expect(directive(csp, "script-src")).not.toContain("'unsafe-inline'");
  });

  it("adds eval for next dev only", () => {
    const dev = buildCsp("N", { dev: true, supabaseUrl: SUPABASE });
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });

  it("lets the page reach Supabase over https and websocket, and nothing else external but game art", () => {
    expect(directive(csp, "connect-src")).toEqual([
      "'self'",
      SUPABASE,
      "wss://abcd.supabase.co",
      "https://api-assets.clashofclans.com",
    ]);
  });

  it("shows Storage pictures and game art", () => {
    expect(directive(csp, "img-src")).toEqual(
      expect.arrayContaining([SUPABASE, "https://api-assets.clashofclans.com", "blob:", "data:"]),
    );
  });

  it("keeps the framing and plugin locks", () => {
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'self'"]);
  });

  it("uses the origin only, and leaves Supabase out when the URL is missing or bad", () => {
    const withPath = buildCsp("N", { dev: false, supabaseUrl: `${SUPABASE}/rest/v1` });
    expect(directive(withPath, "img-src")).toContain(SUPABASE);

    for (const supabaseUrl of [undefined, "not a url"]) {
      const none = buildCsp("N", { dev: false, supabaseUrl });
      expect(none).not.toContain("undefined");
      expect(directive(none, "connect-src")).toEqual(["'self'", "https://api-assets.clashofclans.com"]);
    }
  });
});

describe("nonces and hashes", () => {
  it("makes a different nonce every time", () => {
    expect(createNonce()).not.toBe(createNonce());
  });

  it("hashes a script the way the browser does", async () => {
    const expected = createHash("sha256").update("alert(1)").digest("base64");
    expect(await scriptHash("alert(1)")).toBe(`sha256-${expected}`);
  });

  it("hashes the theme script exactly as app/layout.tsx inlines it", async () => {
    expect(await themeScriptHash()).toBe(await scriptHash(THEME_INIT_SCRIPT));
  });
});
