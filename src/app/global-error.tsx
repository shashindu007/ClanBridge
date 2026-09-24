"use client";

// The last resort: an error thrown by the ROOT layout itself.
//
// (app)/error.tsx catches everything that throws inside the authenticated
// shell, which is almost everything. It cannot catch a failure in
// app/layout.tsx, because that layout is what renders it. This file replaces the
// root layout entirely for that one case — which is why it declares its own
// <html> and <body>, and why Next requires it to be a Client Component.
//
// WHY THE STYLES ARE INLINE AND NOT FROM globals.css.
//
// The realistic reason to reach this file is that something about the root
// layout or its CSS did not come up. Reaching for the stylesheet that may be the
// problem, to style the page that reports the problem, is how a broken error
// page becomes an invisible one. So the colours below are written as hex
// literals — the same four values globals.css resolves its oklch tokens to,
// noted beside each — and the page has no dependency on anything but React.
//
// If the chrome ever changes, these do not follow automatically. That is the
// deliberate cost, and it is the right way round: this page being slightly out
// of date is survivable, and this page being unstyled is not. manifest.json's
// background_color carries the same value for the same reason and has the same
// property.
//
// The Fan Content notice is here too. The root layout owns it normally, and this
// file stands in for the root layout — so leaving it out would mean the one page
// rendered without it is the one shown when things break.

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          // --background / --foreground, dark. See the header on why literal.
          background: "#050d22",
          color: "#eef4fb",
        }}
      >
        <style>{`
          /* Dark is the default, as it is everywhere else (lib/theme.ts); the
             light values apply only when the OS asks for light. There is no
             stored choice to read here: the script that applies one lives in
             the root layout, and the root layout is precisely what has failed
             if this page is on screen. */
          @media (prefers-color-scheme: light) {
            body { background: #f1f6fc !important; color: #141f35 !important; }
            .cb-ge-panel { background: #fbfeff !important; border-color: #cfd8e5 !important; }
            .cb-ge-dim { color: #55647a !important; }
            .cb-ge-btn { background: #2063b0 !important; color: #ffffff !important; }
            .cb-ge-code { background: #e6eef7 !important; }
          }
          .cb-ge-btn:hover { filter: brightness(1.08); }
          .cb-ge-btn:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
        `}</style>

        <div style={{ flex: 1, padding: "16px" }}>
          <main
            className="cb-ge-panel"
            style={{
              maxWidth: "34rem",
              margin: "48px auto 0",
              background: "#0d1830",
              border: "1px solid #26324c",
              borderRadius: "12px",
              padding: "28px 24px",
            }}
          >
            {/* The same shield the rail and the login screen use, drawn inline —
                the icon library is a dependency this page does not take. */}
            <svg
              aria-hidden
              viewBox="0 0 132 132"
              width="34"
              height="34"
              fill="none"
              stroke="currentColor"
              strokeWidth={7}
              strokeLinejoin="round"
              style={{ opacity: 0.55 }}
            >
              <path d="M66 20 L98 33 v27 c0 21-15 36-32 45-17-9-32-24-32-45V33z" />
              <path d="M66 33 v59" />
              <path d="M40 47 h52" />
            </svg>

            <h1
              style={{
                fontSize: "1.4rem",
                fontWeight: 600,
                letterSpacing: "-0.02em",
                margin: "14px 0 8px",
              }}
            >
              ClanBridge could not start
            </h1>

            <p
              className="cb-ge-dim"
              style={{ margin: "0 0 18px", fontSize: "0.95rem", lineHeight: 1.6, color: "#9caec6" }}
            >
              Something failed before the app could draw anything. This is almost
              always temporary. Nothing has been lost — war and league history is
              collected by scheduled jobs that do not depend on this page working.
            </p>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              <button
                type="button"
                onClick={reset}
                className="cb-ge-btn"
                style={{
                  font: "inherit",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  cursor: "pointer",
                  border: "none",
                  borderRadius: "6px",
                  padding: "9px 16px",
                  // --primary, light.
                  background: "#5fbcf4",
                  color: "#0d1830",
                }}
              >
                Try again
              </button>
              {/* A plain anchor, NOT next/link, and the lint rule below is
                  disabled deliberately rather than worked around.

                  That rule exists to stop a full page reload where a client
                  navigation would do. Here the full reload is the entire point:
                  this boundary catches a failure in the root layout, so the
                  router, the layout and possibly the bundle are all suspect, and
                  next/link would try to recover using the very machinery that
                  just failed. An anchor asks the server for a fresh document. */}
              {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
              <a
                href="/"
                className="cb-ge-btn"
                style={{
                  font: "inherit",
                  fontSize: "0.9rem",
                  fontWeight: 500,
                  textDecoration: "none",
                  borderRadius: "6px",
                  padding: "9px 16px",
                  border: "1px solid #26324c",
                  background: "transparent",
                  color: "inherit",
                }}
              >
                Reload ClanBridge
              </a>
            </div>

            {error.digest && (
              <p
                className="cb-ge-dim"
                style={{ margin: "18px 0 0", fontSize: "0.85rem", color: "#9caec6" }}
              >
                Reference:{" "}
                <code
                  className="cb-ge-code"
                  style={{
                    background: "#1a263f",
                    borderRadius: "4px",
                    padding: "2px 6px",
                    fontSize: "0.8rem",
                  }}
                >
                  {error.digest}
                </code>{" "}
                — quote this if you report it.
              </p>
            )}
          </main>
        </div>

        <footer
          className="cb-ge-dim"
          style={{
            padding: "16px",
            textAlign: "center",
            fontSize: "0.85rem",
            color: "#9caec6",
          }}
        >
          This material is unofficial and is not endorsed by Supercell. For more
          information see Supercell&apos;s Fan Content Policy:{" "}
          <a
            href="https://www.supercell.com/en/fan-content-policy/"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "inherit" }}
          >
            www.supercell.com/fan-content-policy
          </a>
          .
        </footer>
      </body>
    </html>
  );
}
