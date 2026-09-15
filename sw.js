const CACHE_NAME = "pedidos-app-shell-v1";
const SHELL_ASSETS = [
  "./index.html",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// App shell: cache-first for our own files, network-first (no cache) for
// everything else (Firebase/Firestore/Storage calls must always hit the
// network, never be served from cache).
self.addEventListener("fetch", function (event) {
  const url = new URL(event.request.url);
  const isOwnAsset = url.origin === self.location.origin && event.request.method === "GET";
  if (!isOwnAsset) return; // let Firebase/Firestore requests pass through untouched

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      const network = fetch(event.request).then(function (resp) {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
        }
        return resp;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
