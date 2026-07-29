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

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (_event) => {
  // TODO T5.6: parse the payload and call self.registration.showNotification()
});

self.addEventListener("notificationclick", (_event) => {
  // TODO T5.6: close the notification and focus or open the deep link it carries
});
