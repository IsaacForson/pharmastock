// PharmaStock service worker (hand-written). Bump VERSION to drop old caches on deploy.
const VERSION = "v2";
const STATIC = `ps-static-${VERSION}`;
const PAGES = `ps-pages-${VERSION}`;
const PRECACHE = ["/offline", "/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest"];
// Pages kept for offline use (last successful copy). The till shell (/pos) is the important one: it sells from the
// catalogue in IndexedDB, and its JS chunks are kept by the /_next/static cache below after one online visit.
const CACHEABLE = [/^\/dashboard$/, /^\/pos$/];
const SIGNED_OUT = /^\/(login|signup)(\/|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ps-") && k !== STATIC && k !== PAGES).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "clear-pages") event.waitUntil(caches.delete(PAGES));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never touch POSTs (server actions, sync)
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(STATIC).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  if (req.mode === "navigate") event.respondWith(navigate(req, url));
});

async function navigate(req, url) {
  try {
    const res = await fetch(req);
    const finalPath = new URL(res.url || req.url).pathname;
    // Signed out (or session expired -> redirected to login): drop cached pages from this device.
    if (SIGNED_OUT.test(finalPath)) await caches.delete(PAGES);
    else if (res.ok && !res.redirected && res.type === "basic" && CACHEABLE.some((r) => r.test(url.pathname)) && !url.search) {
      const copy = res.clone();
      caches.open(PAGES).then((c) => c.put(url.pathname, copy));
    }
    return res;
  } catch {
    const cached = (await caches.match(url.pathname, { cacheName: PAGES })) || (await caches.match(req));
    return cached || (await caches.match("/offline")) || new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } });
  }
}
