// T5.4 — Service worker: push events and notification clicks.
//
// This file must be served from the origin root (/sw.js) for its scope to cover the
// whole app, which is why it lives in public/ rather than src/.
//
// On iPhone, push only works after the user adds the app to the Home Screen from
// Safari — not from Chrome, and not from a normal Safari tab. T5.7 explains this;
// without it members will report that notifications "do not work".
//
// Do not add offline caching here. The data is worthless when stale and the pages
// are database reads; a cache-first service worker would show a member yesterday's
// missed-attack list, which is the one thing it must never do.
//
// The payload shape is PushPayload in src/lib/push.ts: { title, body, url, tag }.
// Keep the two in step by hand — this file is served raw to the browser and never
// passes through the compiler, so nothing checks that boundary for you.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  // A push with no data, or with data that is not our JSON, must still produce a
  // notification. If this handler finishes without showing one, Chrome shows its
  // own "This site has been updated in the background" — which looks broken and
  // is not something a member can act on.
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "ClanBridge";
  const options = {
    body: payload.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Replaces rather than stacks. Four sync ticks during one CWL day would
    // otherwise leave four identical "attacks remaining" notifications sitting
    // on the lock screen.
    tag: payload.tag || "clanbridge",
    renotify: Boolean(payload.tag),
    // Only `data` survives the trip from here to notificationclick, so the
    // destination has to travel in it.
    data: { url: payload.url || "/" },
  };

  // waitUntil, or the worker may be terminated before the notification is shown.
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: "window",
        // Includes tabs this worker does not yet control. On the first visit
        // after install the open tab is uncontrolled, and without this the click
        // opens a second window on top of the one already there.
        includeUncontrolled: true,
      });

      const url = new URL(target, self.location.origin);

      // Focus a window already on that page, else reuse any window, and only
      // open a new one as a last resort. A member who taps three notifications
      // should not end up with three copies of the app.
      const exact = clientList.find((c) => c.url === url.href);
      if (exact) return exact.focus();

      const anyWindow = clientList[0];
      if (anyWindow && "navigate" in anyWindow) {
        await anyWindow.focus();
        return anyWindow.navigate(url.href);
      }

      return self.clients.openWindow(url.href);
    })(),
  );
});

// The push service can revoke a subscription without telling the server. When it
// does the browser fires this, and the old endpoint is already dead — so the only
// useful response is to re-subscribe and hand the server the new one.
//
// event.newSubscription is populated in Chrome and absent elsewhere, hence the
// fallback that subscribes again with the key the old subscription carried.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription || null;

      let fresh = event.newSubscription || null;
      if (!fresh && old && old.options && old.options.applicationServerKey) {
        fresh = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: old.options.applicationServerKey,
        });
      }

      if (!fresh) return;

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscription: fresh.toJSON(),
          replaces: old ? old.endpoint : undefined,
        }),
      });
    })(),
  );
});
