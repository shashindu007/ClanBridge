// The theme, in one place, because three separate things have to agree about it:
// the blocking script in the document head, the toggle in the account menu, and
// the browser chrome colour.
//
// WHY THIS EXISTS AT ALL. globals.css has carried a complete dark palette since
// the chrome was designed — every token re-stepped for a dark surface, contrast
// re-measured and written into the comments, plus dark variants for the
// backdrop, the panels and the hero. All of it was unreachable: `@custom-variant
// dark` targets a `.dark` class, and nothing in the application ever added one.
// There was no toggle and, decisively, no `prefers-color-scheme` query — so a
// member whose phone was in dark mode still got full-strength parchment.
//
// That is not a cosmetic gap for THIS product. Clash runs on a clock: war days
// end at arbitrary hours and CWL reminders fire late, so the single most common
// time to open this app is in bed with the lights off.
//
// A CLASS, NOT A MEDIA QUERY, and the choice is load-bearing. Wrapping the
// existing `.dark` block in `@media (prefers-color-scheme: dark)` would have
// been fewer lines, but it would also have made the OS the only vote — and a
// member may well want light during the day on a phone that is permanently dark,
// or the reverse. Driving `.dark` from a stored choice keeps every line of
// already-measured CSS working unchanged, makes Tailwind's own `dark:` variants
// work (button.tsx, badge.tsx and input.tsx already ship some), and adds the
// third state the OS cannot express.
//
// DARK IS THE DEFAULT, not the OS. "Store night" was designed dark-first — the
// light palette is its daytime counterpart — and the time this app is most often
// opened is late, in the dark. So with nothing stored the answer is dark, and
// the server renders `<html class="dark">` so the very first byte agrees: the
// init script below only ever REMOVES the class, for a member who chose light or
// chose Auto on a light phone. No script, blocked storage, a thumbnail capture —
// every failure lands on dark, which is what the page was built for.

/**
 * What the member chose. `system` is not a resolved value — it means "ask the
 * OS every time", which is why it is stored rather than collapsed to light or
 * dark at the moment of choosing. It is no longer the default; see DEFAULT_THEME.
 */
export type ThemePreference = "light" | "dark" | "system";

/** What that choice resolves to right now. Only ever two. */
export type ResolvedTheme = "light" | "dark";

/**
 * The localStorage key.
 *
 * Prefixed, because this origin is shared with anything else that ever wants
 * browser storage here, and an unprefixed "theme" is the most collidable key
 * name there is.
 */
export const THEME_STORAGE_KEY = "clanbridge:theme";

/** What a member who has never chosen gets. See the header. */
export const DEFAULT_THEME: ThemePreference = "dark";

/** In the order the toggle shows them: the default first. */
export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "dark",
  "light",
  "system",
] as const;

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * The browser chrome colour for each theme — the `theme-color` meta, which
 * paints the status bar on an installed PWA.
 *
 * `--rail-2`, the mid tone of the header rail. Hex rather than a custom property
 * because neither the manifest nor the meta tag can read CSS. The rail is the
 * same night-blue in both modes — the chrome is the brand — so the two entries
 * are the same colour, and public/manifest.json carries it too. If the rail's
 * colour changes, these change with it.
 */
export const THEME_COLOR: Record<ResolvedTheme, string> = {
  light: "#0a142f",
  dark: "#0a142f",
};

/**
 * The script that runs before the first paint.
 *
 * IT MUST BE SYNCHRONOUS AND IT MUST BE IN <head>. Anything later — a
 * useEffect, a deferred script, a component — runs after the browser has already
 * painted, so a member who chose dark gets a full frame of bright parchment
 * first. That flash is worse than no dark mode, because it happens on every
 * single navigation that reloads the document.
 *
 * Wrapped in try/catch and written to survive every way storage can fail: a
 * private window, blocked site data, a thumbnail capture. The catch falls
 * through to doing nothing, which leaves the `dark` class the server rendered —
 * the default, and so the correct degradation.
 *
 * Deliberately terse. It is inlined into every HTML response, and it is easier
 * to keep correct as six lines than as sixty.
 */
export const THEME_INIT_SCRIPT = `
(function(){try{
var k=${JSON.stringify(THEME_STORAGE_KEY)};
var p=localStorage.getItem(k);
var d=p==="light"?false:p==="system"?window.matchMedia("(prefers-color-scheme: dark)").matches:true;
var r=document.documentElement;
r.classList.toggle("dark",d);
r.style.colorScheme=d?"dark":"light";
}catch(e){}})();
`.trim();

/**
 * Apply a preference to the document. Used by the toggle, and by the
 * `matchMedia` listener that keeps `system` honest when the OS flips.
 *
 * Sets THREE things, and all three matter:
 *
 *   the class        every `.dark` rule in globals.css and every Tailwind
 *                    `dark:` utility hangs off it
 *   color-scheme     native form controls, scrollbars and the canvas the
 *                    browser paints behind the page. Without it a dark page
 *                    gets light scrollbars and a white flash between documents
 *   theme-color      the status bar on an installed PWA. Updated here as well
 *                    as declared in the layout, because the layout's version is
 *                    keyed to the OS and cannot know about an explicit choice
 *                    that disagrees with it
 */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const dark =
    preference === "dark" ||
    (preference === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";

  const resolved: ResolvedTheme = dark ? "dark" : "light";

  // The layout writes one unmedia'd tag; this updates it in place, or creates
  // it if a page somehow rendered without one. Today both themes share a rail
  // colour, so this is a no-op in effect — it stays so that giving the light
  // theme its own chrome is a one-line change to THEME_COLOR.
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]:not([media])',
  );
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = THEME_COLOR[resolved];

  return resolved;
}

/** Read the stored choice. Falls back to DEFAULT_THEME, including when storage throws. */
export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Store a choice. Never throws — a member in a private window still gets the
 * theme they picked for this session, they simply do not get it remembered.
 */
export function writeThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* no storage: applied but not remembered */
  }
}
