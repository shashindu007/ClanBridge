"use client";

// "Your rank" on every Player rating page: a bubble pinned to the bottom of the
// screen, there however far down the list a member scrolls.
//
// It was a panel at the top of the page, which pushed the ranking itself below
// the fold and was gone the moment a member scrolled to look for themselves.
//
// × DOES NOT DELETE IT, IT SHRINKS IT to a round "Your rank" button in the same
// spot, one tap from coming back (user control and freedom: an undo, not a
// loss). Which of the two it is stays with the browser (localStorage), so it
// stays shrunk from tab to tab. The server always draws it open: that is the
// useSyncExternalStore server snapshot, so hydration never disagrees.

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { Trophy, X } from "lucide-react";
import { RankMedal } from "@/components/player-rank";

export interface DockEntry {
  key: string;
  name: string;
  rank: number;
  /** Earns a medal: a place with marks behind it. */
  medal: boolean;
  /** "#4 of 110 in the family · #2 of 12 in Dark Hell". */
  line: string;
  rating: string;
  /** Straight to the row. */
  href: string;
}

const KEY = "cb-rank-dock";
const EVENT = "cb-rank-dock";

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "collapsed";
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    if (collapsed) window.localStorage.setItem(KEY, "collapsed");
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode or blocked storage: the change still holds for this page.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

// Storage can be blocked, which would leave × doing nothing. This page's own
// memory carries the choice when it is.
let fallback = false;
const snapshot = () => readCollapsed() || fallback;

export function RankDock({ title, entries }: { title: string; entries: DockEntry[] }) {
  const collapsed = useSyncExternalStore(subscribe, snapshot, () => false);

  const set = useCallback((next: boolean) => {
    fallback = next;
    writeCollapsed(next);
  }, []);

  if (entries.length === 0) return null;

  if (collapsed) {
    const first = entries[0]!;
    return (
      <div className="cb-dock-wrap">
        <button
          type="button"
          aria-expanded={false}
          onClick={() => set(false)}
          className="cb-dock-pill"
          title="Show your rank"
        >
          <Trophy aria-hidden className="size-4" />
          Your rank
          <span className="cb-title tabular-nums">#{first.rank}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="cb-dock-wrap">
      <section
        aria-label="Your rank"
        className="cb-dock"
        onKeyDown={(e) => {
          if (e.key === "Escape") set(true);
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs font-medium tracking-wide uppercase">
            <Trophy aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">Your rank · {title}</span>
          </h2>
          <button
            type="button"
            aria-label="Hide your rank"
            aria-expanded={true}
            onClick={() => set(true)}
            className="cb-dock-close"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        <ul className="mt-1.5 max-h-44 space-y-1 overflow-y-auto">
          {entries.map((entry) => (
            <li key={entry.key} className="flex items-center gap-3">
              <RankMedal rank={entry.rank} medal={entry.medal} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{entry.name}</span>
                <span className="text-muted-foreground block truncate text-xs tabular-nums">{entry.line}</span>
              </span>
              <span className="cb-title shrink-0 text-lg tabular-nums">{entry.rating}</span>
              <Link
                href={entry.href}
                className="text-primary inline-flex min-h-11 shrink-0 items-center text-sm font-medium hover:underline"
              >
                Show in list
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
