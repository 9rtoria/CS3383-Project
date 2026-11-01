/* Project3383 service worker: network-first navigation, cache-first static
 * assets. Authenticated API responses are never cached. Offline writes live
 * in localStorage and are replayed by the browser app. */
const VERSION = "project3383-v2";
const STATIC_CACHE = `${VERSION}-static`;
const PAGE_CACHE = `${VERSION}-pages`;
const PRECACHE = [
  "/",
  "/index.html",
  "/styles.css",
  "/i18n.js",
  "/sound.js",
  "/offline.js",
  "/app.js",
  "/share.html",
  "/share.js",
  "/auth.html",
  "/auth.js",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icon-maskable.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
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
    const sharePage = url.pathname.startsWith("/share/");
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === "/") {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put("/", copy));
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(request))
          || (await caches.match(sharePage ? "/share.html" : "/"))
          || (await caches.match("/index.html"))),
    );
    return;
  }

  if (/\.(?:svg|png|webmanifest|woff2?|css|js)$/.test(url.pathname)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
  }
});
