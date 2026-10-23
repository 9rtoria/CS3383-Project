/* Drift service worker: network-first navigation, cache-first static assets.
 * Authenticated API responses are never cached. The app keeps write queues in
 * localStorage so a reload cannot silently discard untrusted JSON responses. */
const VERSION = "drift-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = "/offline";
const PRECACHE = ["/offline", "/icon.svg", "/icon-maskable.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === "/") {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match("/")) || caches.match(OFFLINE_URL)),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/") || /\.(?:svg|png|woff2?|css|js)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
