const CACHE = "race-tracker-v10";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first: always try to fetch the latest version first. Only fall
// back to the cached copy if the network request fails (e.g. offline) —
// this was previously cache-first ("return cached || network"), which meant
// the app would keep showing whatever was cached from a *previous* visit
// and silently refresh the cache in the background for *next* time. That
// made every deploy look like it hadn't taken effect, even after a hard
// refresh, because the service worker intercepted the request before it
// ever reached the network.
self.addEventListener("fetch", (e) => {
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.status === 200 && e.request.method === "GET") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
