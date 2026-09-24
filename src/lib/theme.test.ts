// The theme, including the part of it that is a string.
//
// THE INIT SCRIPT IS THE REASON THIS FILE EXISTS. It is inlined into every HTML
// response as source text, so nothing type-checks it and nothing imports it —
// which means a rename of THEME_STORAGE_KEY would compile, lint, deploy, and
// quietly stop the script finding what writeThemePreference() had stored. The
// symptom is a flash of the wrong theme on every full page load, which nobody
// reports as a bug because it looks like slowness. Asserting that the two halves
// agree is the only thing that can catch it.
//
// Node environment with hand-built stubs, matching clan-nav-rail.test.ts: the
// suite has no jsdom, and what is under test here is small enough that a real
// DOM would be more setup than subject.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  DEFAULT_THEME,
  isThemePreference,
  readThemePreference,
  THEME_COLOR,
  THEME_INIT_SCRIPT,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  writeThemePreference,
} from "@/lib/theme";

/** A document just real enough for applyTheme: a root, a head, one meta. */
function stubDom(prefersDark: boolean) {
  const classes = new Set<string>();
  const style: Record<string, string> = {};
  const metas: Array<{ name: string; content: string; media?: string }> = [];

  const root = {
    classList: {
      toggle(token: string, force: boolean) {
        if (force) classes.add(token);
        else classes.delete(token);
      },
    },
    style,
  };

  const document = {
    documentElement: root,
    head: { appendChild: (m: (typeof metas)[number]) => void metas.push(m) },
    createElement: () => ({ name: "", content: "" }),
    // Only the one selector applyTheme uses: the unmedia'd theme-color tag.
    querySelector: (selector: string) =>
      selector.includes("theme-color")
        ? (metas.find((m) => m.name === "theme-color" && !m.media) ?? null)
        : null,
  };

  vi.stubGlobal("document", document);
  vi.stubGlobal("window", {
    matchMedia: (query: string) => ({
      matches: query.includes("dark") && prefersDark,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });

  return {
    isDark: () => classes.has("dark"),
    colorScheme: () => style.colorScheme,
    themeColor: () => metas.find((m) => m.name === "theme-color")?.content,
    themeCount: () => metas.filter((m) => m.name === "theme-color").length,
  };
}

/** A localStorage that can be made to fail the way a private window does. */
function stubStorage(initial: string | null, throws = false) {
  const store = new Map<string, string>();
  if (initial !== null) store.set(THEME_STORAGE_KEY, initial);

  vi.stubGlobal("localStorage", {
    getItem(key: string) {
      if (throws) throw new Error("storage is blocked");
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (throws) throw new Error("storage is blocked");
      store.set(key, value);
    },
  });

  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the blocking init script", () => {
  // The whole point of this block. See the file header.
  it("reads the same storage key the module writes", () => {
    expect(THEME_INIT_SCRIPT).toContain(JSON.stringify(THEME_STORAGE_KEY));
  });

  it("is wrapped in try/catch, because storage throws in a private window", () => {
    expect(THEME_INIT_SCRIPT).toContain("try{");
    expect(THEME_INIT_SCRIPT).toContain("catch");
  });

  it("toggles the class every .dark rule in globals.css hangs off", () => {
    expect(THEME_INIT_SCRIPT).toContain('classList.toggle("dark"');
  });

  it("sets colorScheme, so scrollbars and form controls follow", () => {
    expect(THEME_INIT_SCRIPT).toContain("colorScheme");
  });

  it("consults the OS only for an explicit Auto", () => {
    expect(THEME_INIT_SCRIPT).toContain('p==="system"');
    expect(THEME_INIT_SCRIPT).toContain("prefers-color-scheme: dark");
  });

  // An IIFE: it runs at parse time in <head> with nothing else to call it, and
  // it must not leave anything on window.
  it("is a self-invoking expression that leaks no globals", () => {
    expect(THEME_INIT_SCRIPT.startsWith("(function()")).toBe(true);
    expect(THEME_INIT_SCRIPT.trimEnd().endsWith("})();")).toBe(true);
  });
});

// The script is a string, so run it: a stub <html> that starts the way the
// server renders it (class "dark"), and whatever storage and OS the case needs.
function runInitScript(stored: string | null, prefersDark: boolean, storageThrows = false) {
  const classes = new Set<string>(["dark"]);
  const style: Record<string, string> = { colorScheme: "dark" };
  const documentElement = {
    classList: {
      toggle(token: string, force: boolean) {
        if (force) classes.add(token);
        else classes.delete(token);
      },
    },
    style,
  };
  const localStorage = {
    getItem: () => {
      if (storageThrows) throw new Error("storage is blocked");
      return stored;
    },
  };
  const window = {
    matchMedia: (q: string) => ({ matches: q.includes("dark") && prefersDark }),
  };
  new Function("document", "localStorage", "window", THEME_INIT_SCRIPT)(
    { documentElement },
    localStorage,
    window,
  );
  return { dark: classes.has("dark"), colorScheme: style.colorScheme };
}

describe("what the init script decides", () => {
  it("is dark with nothing stored, whatever the OS says", () => {
    expect(runInitScript(null, false)).toEqual({ dark: true, colorScheme: "dark" });
    expect(runInitScript(null, true).dark).toBe(true);
  });

  it("takes the class away for a member who chose light", () => {
    expect(runInitScript("light", true)).toEqual({ dark: false, colorScheme: "light" });
  });

  it("follows the OS only on Auto", () => {
    expect(runInitScript("system", false).dark).toBe(false);
    expect(runInitScript("system", true).dark).toBe(true);
  });

  it("keeps an explicit dark on a light phone", () => {
    expect(runInitScript("dark", false).dark).toBe(true);
  });

  it("leaves the server's dark in place when storage throws", () => {
    expect(runInitScript("light", false, true)).toEqual({ dark: true, colorScheme: "dark" });
  });
});

describe("isThemePreference", () => {
  it("accepts exactly the three preferences", () => {
    for (const value of THEME_PREFERENCES) {
      expect(isThemePreference(value)).toBe(true);
    }
    expect(THEME_PREFERENCES).toHaveLength(3);
  });

  it("rejects anything else, including the resolved-looking near misses", () => {
    for (const value of ["", "Dark", "auto", "os", null, undefined, 1, {}]) {
      expect(isThemePreference(value)).toBe(false);
    }
  });
});

describe("reading and writing the preference", () => {
  it("defaults to dark when nothing is stored", () => {
    stubStorage(null);
    expect(DEFAULT_THEME).toBe("dark");
    expect(readThemePreference()).toBe("dark");
  });

  it("returns a stored preference", () => {
    stubStorage("dark");
    expect(readThemePreference()).toBe("dark");
  });

  it("falls back to the default for a stored value that is not a preference", () => {
    // A value written by an older build, or by hand in devtools.
    stubStorage("midnight");
    expect(readThemePreference()).toBe(DEFAULT_THEME);
  });

  it("falls back to the default when storage throws", () => {
    stubStorage("light", true);
    expect(readThemePreference()).toBe(DEFAULT_THEME);
  });

  it("does not throw when storage refuses the write", () => {
    stubStorage(null, true);
    // A member in a private window still gets the theme they picked for this
    // session; it simply is not remembered.
    expect(() => writeThemePreference("dark")).not.toThrow();
  });

  it("round-trips through storage", () => {
    const store = stubStorage(null);
    writeThemePreference("light");
    expect(store.get(THEME_STORAGE_KEY)).toBe("light");
    expect(readThemePreference()).toBe("light");
  });
});

describe("applyTheme", () => {
  it("resolves an explicit choice against the OS, not with it", () => {
    // The case a media query alone cannot express, and the reason this is a
    // class rather than a prefers-color-scheme block.
    const dom = stubDom(true);
    expect(applyTheme("light")).toBe("light");
    expect(dom.isDark()).toBe(false);

    const dom2 = stubDom(false);
    expect(applyTheme("dark")).toBe("dark");
    expect(dom2.isDark()).toBe(true);
  });

  it("follows the OS on system", () => {
    const dark = stubDom(true);
    expect(applyTheme("system")).toBe("dark");
    expect(dark.isDark()).toBe(true);

    const light = stubDom(false);
    expect(applyTheme("system")).toBe("light");
    expect(light.isDark()).toBe(false);
  });

  it("sets colorScheme to match, so the browser's own chrome follows", () => {
    const dom = stubDom(false);
    applyTheme("dark");
    expect(dom.colorScheme()).toBe("dark");
    applyTheme("light");
    expect(dom.colorScheme()).toBe("light");
  });

  it("writes the status bar colour for the resolved theme", () => {
    const dom = stubDom(false);
    applyTheme("dark");
    expect(dom.themeColor()).toBe(THEME_COLOR.dark);
    applyTheme("light");
    expect(dom.themeColor()).toBe(THEME_COLOR.light);
  });

  it("reuses the meta tag rather than appending one per call", () => {
    const dom = stubDom(false);
    applyTheme("dark");
    applyTheme("light");
    applyTheme("dark");
    // One tag. A new tag per toggle would leave the browser reading whichever
    // it saw first.
    expect(dom.themeCount()).toBe(1);
  });
});

describe("THEME_COLOR", () => {
  // --rail-2, written out because no meta tag can read a custom property.
  // app/layout.tsx reads it from here; manifest.json carries the same value.
  it("is a six-digit hex per theme", () => {
    expect(THEME_COLOR.light).toMatch(/^#[0-9a-f]{6}$/);
    expect(THEME_COLOR.dark).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("matches the installed app's manifest", async () => {
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
    expect(manifest.theme_color).toBe(THEME_COLOR.dark);
  });
});
