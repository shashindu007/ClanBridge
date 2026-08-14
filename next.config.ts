import type { NextConfig } from "next";

// R1 — nothing here may proxy or rewrite to the Clash of Clans API.
// Pages and route handlers read PostgreSQL only. Only scripts/sync/ talks to Supercell.

/**
 * T10.8c — response headers.
 *
 * There were none before this, which mattered more once T10 put a password
 * field on a page: a login form that can be framed is a login form that can be
 * clickjacked, and a referrer carrying `?next=/…` to another origin describes
 * the product's URL structure to whoever is listening.
 *
 * NO CONTENT-SECURITY-POLICY, deliberately, and it is the obvious omission.
 * Next's App Router emits inline bootstrap scripts, so a real CSP needs a nonce
 * generated per request in middleware and threaded through. That is its own
 * change with its own way of silently breaking the app, and a CSP with
 * 'unsafe-inline' in it is a header that looks like protection and is not. It is
 * recorded as outstanding rather than half-done.
 */
const securityHeaders = [
  // Clickjacking. frame-ancestors would be the modern spelling, but that lives
  // in a CSP, which is exactly what is not here yet.
  { key: "X-Frame-Options", value: "DENY" },

  // Stops a browser guessing that a JSON error body or an uploaded base layout
  // is really HTML and running it as such.
  { key: "X-Content-Type-Options", value: "nosniff" },

  // Send the full URL to ourselves, the origin alone to anyone else. Clan tags
  // and season identifiers are in the path of nearly every page here.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },

  // Nothing in this product uses any of these, so nothing embedded in it should
  // be able to ask.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },

  // Vercel sets HSTS on its own domains, but this must hold on a custom domain
  // too. Two years, subdomains included. No `preload`: that is a submission to a
  // list baked into browsers and is genuinely hard to undo, so it should be a
  // deliberate act rather than a default inherited from a config file.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Clan, league and unit badges returned by the API as absolute URLs.
      { protocol: "https", hostname: "api-assets.clashofclans.com" },
      // T8.4 — add the Supabase Storage host here once the project exists (T0.7):
      // { protocol: "https", hostname: "<project-ref>.supabase.co" },
    ],
  },

  async headers() {
    // Every path, including /api and /auth. A header applied to pages only is a
    // header missing from the two routes that handle credentials.
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
