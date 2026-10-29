// The Content-Security-Policy, built per request by middleware.
//
// REPORT-ONLY FOR NOW. It is sent as Content-Security-Policy-Report-Only, so a
// source missing from the list below is logged in the browser console and
// nothing breaks. Once the live site's pages are clean, middleware switches the
// header name and nothing here changes. See next.config.ts.
//
// HOW THE SCRIPTS ARE ALLOWED.
//   - Next's own inline scripts get the per-request nonce. Next reads it back out
//     of the policy on the REQUEST headers (either header name) and stamps it on
//     every script it renders.
//   - The theme script in app/layout.tsx is allowed by its sha256 hash instead.
//     It is a constant, and reading a nonce there would need headers() in the
//     root layout, which would make every page render per request.
//   - 'strict-dynamic' lets those trusted scripts load Next's chunks, so the
//     list does not need to name each file.

import { THEME_INIT_SCRIPT } from "@/lib/theme";

/**
 * The header the policy travels in. Change this one name to enforce it: Next
 * reads the nonce from either spelling on the request.
 */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

/** Badges, league icons and unit art the API hands out as absolute URLs. */
const COC_ASSETS = "https://api-assets.clashofclans.com";

export interface CspOptions {
  /** `next dev` evaluates code with eval() for fast refresh. */
  dev: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL: auth, the database, and Storage images. */
  supabaseUrl?: string;
  /** 'sha256-…' sources for inline scripts that cannot carry the nonce. */
  scriptHashes?: string[];
}

export function buildCsp(nonce: string, options: CspOptions): string {
  const supabase = originOf(options.supabaseUrl);
  // Supabase Realtime is a websocket on the same host.
  const supabaseSocket = supabase?.replace(/^http/, "ws");
  const hashes = (options.scriptHashes ?? []).map((h) => `'${h}'`);

  const directives: Array<[string, Array<string | undefined | false>]> = [
    ["default-src", ["'self'"]],
    [
      "script-src",
      ["'self'", `'nonce-${nonce}'`, ...hashes, "'strict-dynamic'", options.dev && "'unsafe-eval'"],
    ],
    // Inline style attributes are everywhere (clan accents, progress bars), and
    // a style cannot run code, so this is the accepted trade.
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // data: and blob: are the compressed previews and the exported PNGs.
    ["img-src", ["'self'", "data:", "blob:", COC_ASSETS, supabase]],
    ["font-src", ["'self'", "data:"]],
    // The image export fetches every picture on the card to embed it, so the
    // asset host is needed here as well as under img-src.
    ["connect-src", ["'self'", supabase, supabaseSocket, COC_ASSETS]],
    ["worker-src", ["'self'"]],
    ["manifest-src", ["'self'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
  ];

  return directives
    .map(([name, sources]) => [name, ...sources.filter(Boolean)].join(" "))
    .join("; ");
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** A per-request nonce: 128 random bits, base64. */
export function createNonce(): string {
  return btoa(crypto.randomUUID());
}

/** 'sha256-…' for an inline script's exact text. Web Crypto, so it runs in middleware. */
export async function scriptHash(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCodePoint(byte);
  return `sha256-${btoa(binary)}`;
}

let themeHash: Promise<string> | undefined;

/** The theme script's hash, worked out once per server instance. */
export function themeScriptHash(): Promise<string> {
  themeHash ??= scriptHash(THEME_INIT_SCRIPT);
  return themeHash;
}
