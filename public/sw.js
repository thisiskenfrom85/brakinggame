const CACHE_NAME = "braketrace-v2";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/data/chinese-gp-qualifying.json",
  "/assets/tracks/shanghai-f1.webp",
  "/assets/drivers/ALO.jpg",
  "/assets/drivers/HAM.jpg",
  "/assets/drivers/LEC.jpg",
  "/assets/drivers/NOR.jpg",
  "/assets/drivers/PIA.jpg",
  "/assets/drivers/RUS.jpg",
  "/assets/drivers/SAI.jpg",
  "/assets/drivers/VER.jpg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("/index.html"));
    })
  );
});
