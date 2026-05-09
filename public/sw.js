const CACHE_NAME = "braketrace-v3";
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/data/chinese-gp-qualifying.json",
  "/assets/tracks/shanghai-f1.webp",
  "/assets/drivers/ALO.webp",
  "/assets/drivers/HAM.webp",
  "/assets/drivers/LEC.webp",
  "/assets/drivers/NOR.webp",
  "/assets/drivers/PIA.webp",
  "/assets/drivers/RUS.webp",
  "/assets/drivers/SAI.webp",
  "/assets/drivers/VER.webp"
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
