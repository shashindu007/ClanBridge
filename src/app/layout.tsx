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
        <footer className="border-t px-4 py-4 text-center">
          {/* T9.8 — the exact notice named in Supercell's Fan Content Policy
              ("Insert disclaimers"), recorded at T0.12. Not paraphrased: the
              policy asks for this wording "or a substantially similar
              notice", and copying it removes any question of whether a
              rewrite still qualifies.
              https://www.supercell.com/en/fan-content-policy/

              In the root layout, not the (app) group, so it also covers
              /login and /pending — every page that shows Clash of Clans
              data, not only the ones behind a session. text-sm rather than
              text-xs: the policy requires the notice be "in a font legible
              to end users," and this project already treats text-xs as the
              floor for de-emphasised text elsewhere, not for anything a
              policy requires to be readable. */}
          <p className="text-muted-foreground text-sm">
            This material is unofficial and is not endorsed by Supercell. For
            more information see Supercell&apos;s Fan Content Policy:{" "}
            <a
              href="https://www.supercell.com/en/fan-content-policy/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              www.supercell.com/fan-content-policy
            </a>
            .
          </p>
        </footer>
      </body>
    </html>
  );
}
