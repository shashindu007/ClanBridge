import type { Metadata, Viewport } from "next";
import "./globals.css";

// T5.3 — manifest and theme colour are what make the PWA installable.
export const metadata: Metadata = {
  title: "ClanBridge",
  description: "Clan management for three Clash of Clans clans.",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* T9.8 — Supercell fan content disclaimer goes in a footer here,
            using the exact wording recorded at T0.12. */}
      </body>
    </html>
  );
}
