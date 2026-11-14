"use strict";

const CACHE_PREFIX = "rasmalai-offline-";
const PAGE_CACHE = `${CACHE_PREFIX}pages-v1`;
const ASSET_CACHE = `${CACHE_PREFIX}assets-v1`;
const OFFLINE_ROUTES = new Set([
  "/games",
  "/games/ludo",
  "/games/tic-tac-toe",
  "/games/snakes-and-ladders",
]);

function gamePath(pathname) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return OFFLINE_ROUTES.has(normalized) ? normalized : null;
}

function staticAssetPath(pathname) {
  return pathname.startsWith("/_next/static/");
}

async function cacheStaticReferences(pageCache, assetCache, pathname, response) {
  const pageResponse = response.clone();
  const html = await response.text();
  const references = new Set();
  for (const match of html.matchAll(/(?:src|href)=["'](\/_next\/static\/[^"']+)["']/g)) {
    try {
      const url = new URL(match[1], self.location.origin);
      if (url.origin === self.location.origin && staticAssetPath(url.pathname)) references.add(url.href);
    } catch { /* ignore malformed document references */ }
  }
  const pageUrl = new URL(pathname, self.location.origin).href;
  await pageCache.put(pageUrl, pageResponse);
  await Promise.all([...references].map(async (url) => {
    try {
      if (await assetCache.match(url)) return;
      const asset = await fetch(url, { credentials: "same-origin" });
      if (asset.ok) await assetCache.put(url, asset);
    } catch { /* a failed optional asset must not block the offline page */ }
  }));
}

async function precacheOfflinePages() {
  const pageCache = await caches.open(PAGE_CACHE);
  const assetCache = await caches.open(ASSET_CACHE);
  await Promise.all([...OFFLINE_ROUTES].map(async (pathname) => {
    try {
      const response = await fetch(new Request(new URL(pathname, self.location.origin), {
        headers: { Accept: "text/html" },
        credentials: "same-origin",
        cache: "reload",
      }));
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return;
      await cacheStaticReferences(pageCache, assetCache, pathname, response);
    } catch { /* install can complete when an individual game page is unavailable */ }
  }));
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    await precacheOfflinePages();
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== PAGE_CACHE && name !== ASSET_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" && !url.search) {
    const pathname = gamePath(url.pathname);
    if (!pathname) return;
    const networkResponse = fetch(request);
    // Register the cache refresh while the fetch event is still being dispatched.
    // `waitUntil()` cannot reliably be called later from an awaited continuation.
    const cacheRefresh = networkResponse.then(async (response) => {
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return;
      await cacheStaticReferences(await caches.open(PAGE_CACHE), await caches.open(ASSET_CACHE), pathname, response.clone());
    }).catch(() => {});
    event.waitUntil(cacheRefresh);
    event.respondWith((async () => {
      try {
        return await networkResponse;
      } catch {
        const pageCache = await caches.open(PAGE_CACHE);
        const saved = await pageCache.match(new URL(pathname, self.location.origin).href);
        return saved ?? new Response("This offline game has not been saved on this device yet. Open it once while connected, then try again.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
    })());
    return;
  }

  if (!staticAssetPath(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(ASSET_CACHE);
    const cached = await cache.match(url.href);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) event.waitUntil(cache.put(url.href, response.clone()));
    return response;
  })());
});
