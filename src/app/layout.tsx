import type { Metadata, Viewport } from "next";
import "./globals.css";

// T5.3 — manifest and theme colour are what make the PWA installable.
//
// T10.9 — THE ICONS ARE A PERFORMANCE FIX, not decoration.
//
// This project had no favicon at all. That is not a cosmetic gap here, because
// `[clanTag]` is a dynamic segment at the ROOT of the routing tree — so a
// browser's automatic request for /favicon.ico matched /[clanTag] with a
// "clan tag" of "favicon.ico" and rendered the whole (app) layout: session
// lookup, profile read, clan list, the lot, before failing to find that clan.
//
// Every page load fires that request. The dev log showed it plainly —
// `GET /favicon.ico 200 in 4777ms`, as slow as a real page, running in parallel
// with the real page and competing with it for the server. Roughly double the
// work on every navigation, for an icon.
//
// public/favicon.ico is served as a static file before routing ever happens, so
// the request now costs a millisecond. Declaring the icons here as well stops
// the browser guessing.
export const metadata: Metadata = {
  title: "ClanBridge",
  description: "Clan management for three Clash of Clans clans.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  // --wood-2, the mid tone of the header rail, in hex because the manifest and
  // the browser chrome cannot read a CSS custom property. It was slate-900,
  // left over from the shadcn defaults, which put a cold blue-black band above
  // a warm wooden header on every installed PWA. If the rail's colour changes,
  // this is the second place to change it.
  themeColor: "#412c1f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        {/* The page's light and texture. A real element rather than a
            `body::before`, because body paints an opaque --background and a
            negative-z pseudo-element would sit behind it and never be seen.
            Everything it draws is generated — see globals.css on why there is
            no image here and never will be. */}
        <div aria-hidden className="cb-backdrop" />

        {/* flex-1 so the footer sits at the bottom of the viewport on a short
            page instead of half way up it, which is where a page with one
            sentence on it used to leave the fan content notice. */}
        <div className="flex-1">{children}</div>

        <footer className="mt-8 border-t px-4 py-4 text-center">
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
