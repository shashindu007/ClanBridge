"use client";

// Three buttons, in the account menu: Dark, Light, Auto.
//
// THREE AND NOT TWO. A two-state switch has to pick a starting side, and
// whichever it picks is wrong for half the members — someone whose phone flips
// to dark at sunset wants the app to follow, and someone who reads in bright
// daylight on a permanently-dark phone does not. Dark is the default and comes
// first (lib/theme.ts says why); "Auto" says what it does, rather than being an
// implied third state hidden behind a long press.
//
// Rendered as a segmented control rather than a dropdown because there are three
// options, all of them one word, and the current one should be visible without
// opening anything. It sits inside the account menu's <details>, which is
// already open when this is on screen.
//
// A SKELETON UNTIL MOUNTED. The server cannot know which theme is active — the
// choice lives in localStorage and is applied by the blocking script in the
// document head — so rendering a "current" state on the server would guarantee a
// wrong one for anybody not on the default, and React would then hydrate over it. The
// placeholder occupies the same space so the menu does not jump.

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  applyTheme,
  readThemePreference,
  writeThemePreference,
  type ThemePreference,
} from "@/lib/theme";

const OPTIONS: ReadonlyArray<{
  value: ThemePreference;
  label: string;
  hint: string;
  Icon: typeof Sun;
}> = [
  { value: "dark", label: "Dark", hint: "Always dark (the default)", Icon: Moon },
  { value: "light", label: "Light", hint: "Always light", Icon: Sun },
  { value: "system", label: "Auto", hint: "Follow this device's setting", Icon: Monitor },
];

/**
 * @param compact  T12.5 — no visible "Appearance" heading and no padding, for
 *                 the landing page header where the control sits in a row. The
 *                 radiogroup keeps its aria-label either way, so a screen reader
 *                 hears the same name in both places.
 */
export function ThemeToggle({ compact = false }: { compact?: boolean } = {}) {
  const [preference, setPreference] = useState<ThemePreference | null>(null);

  useEffect(() => {
    setPreference(readThemePreference());
  }, []);

  // Keep "Auto" honest while the page is open. Without this, a member on Auto
  // whose phone flips to dark at sunset keeps the light theme until they
  // navigate — and the one thing Auto promises is that it does not need them to.
  //
  // Guarded on the preference so an explicit choice is never overridden by the
  // OS changing underneath it.
  useEffect(() => {
    if (preference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  function choose(next: ThemePreference) {
    setPreference(next);
    writeThemePreference(next);
    applyTheme(next);
  }

  return (
    <div className={compact ? "" : "px-2.5 py-2"}>
      {!compact && (
        <p className="text-muted-foreground mb-1.5 text-xs font-medium">Appearance</p>
      )}
      <div
        role="radiogroup"
        aria-label="Appearance"
        // Compact sits on the night-blue rail, which is the same in both
        // themes — so it takes the rail's colours, not the page's. The page's
        // --muted is a pale chip in light mode, and on the dark rail it left
        // the unchosen labels grey-on-grey.
        className={`flex gap-0.5 rounded-control p-0.5 ${compact ? "bg-white/8" : "bg-muted/60"}`}
      >
        {OPTIONS.map(({ value, label, hint, Icon }) => {
          // null while unmounted — nothing is marked current, which is honest
          // rather than wrong. See the header.
          const active = preference === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              title={hint}
              onClick={() => choose(value)}
              className={
                "flex flex-1 items-center justify-center gap-1.5 rounded-chip px-2 py-1.5 text-xs font-medium transition-colors " +
                (compact
                  ? active
                    ? "bg-white/15 text-rail-ink shadow-[inset_0_-2px_0_var(--gold)]"
                    : "text-rail-ink-dim hover:text-rail-ink"
                  : active
                    ? "bg-tile text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground")
              }
            >
              <Icon aria-hidden className="size-3.5" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
