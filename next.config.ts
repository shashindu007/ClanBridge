import type { NextConfig } from "next";

// R1 — nothing here may proxy or rewrite to the Clash of Clans API.
// Pages and route handlers read PostgreSQL only. Only scripts/sync/ talks to Supercell.
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // Clan, league and unit badges returned by the API as absolute URLs.
      { protocol: "https", hostname: "api-assets.clashofclans.com" },
      // T8.4 — add the Supabase Storage host here once the project exists (T0.7):
      // { protocol: "https", hostname: "<project-ref>.supabase.co" },
    ],
  },
};

export default nextConfig;
