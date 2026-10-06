// sw.js — Service Worker 離線快取
//
// 修改任何靜態資源後，記得把 CACHE_NAME 版本號往上加，否則使用者會一直吃到舊快取。
const CACHE_NAME = "chladni-v4";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/main.js",
  "./js/audio.js",
  "./img/%E5%B0%8D%E7%85%A7%E5%9C%96.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
