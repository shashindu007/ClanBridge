// The reason navigation felt slow, and it was never the queries.
//
// Without a loading.tsx, the App Router has nowhere to suspend: a click on a
// nav link starts rendering the next page ON THE SERVER and the browser keeps
// showing the OLD page, unchanged, until that render finishes. Nothing moves.
// No spinner, no dimming, no route change — so a 700 ms page reads as a dead
// button, and the natural response is to click it again.
//
// This file is a Suspense boundary for everything inside (app). Next renders it
// the instant the navigation starts, then streams the real page in behind it.
// The work takes exactly as long as it did before; the difference is that the
// interface responds immediately, which is the part a member actually feels.
//
// It sits at the group root on purpose. One boundary here covers all 33 pages,
// and the layout's header — clan switcher, nav, admin link — is OUTSIDE it, so
// the chrome stays put and only the content area swaps. A per-page skeleton
// would be more precise and would also be 33 files to keep in step with 33
// layouts; this is the version that stays true.
//
// Part of T9.10.

function Bar({ className = "" }: { className?: string }) {
  return <div className={`bg-muted animate-pulse rounded ${className}`} />;
}

export default function AppLoading() {
  return (
    // aria-busy + role=status so a screen reader announces the wait rather than
    // reading out a page of meaningless placeholder boxes.
    <main
      role="status"
      aria-busy="true"
      aria-label="Loading"
      className="mx-auto max-w-page space-y-6 p-4 sm:p-6"
    >
      <div className="space-y-3">
        <Bar className="h-7 w-56" />
        <Bar className="h-4 w-80" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="cb-panel space-y-3 rounded-panel border p-5">
            <Bar className="h-4 w-24" />
            <Bar className="h-8 w-16" />
          </div>
        ))}
      </div>

      <div className="cb-panel space-y-3 rounded-panel border p-5">
        <Bar className="h-4 w-32" />
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4 py-2">
              <Bar className="h-4 flex-1" />
              <Bar className="h-4 w-16" />
              <Bar className="h-4 w-12" />
            </div>
          ))}
        </div>
      </div>

      <span className="sr-only">Loading…</span>
    </main>
  );
}
