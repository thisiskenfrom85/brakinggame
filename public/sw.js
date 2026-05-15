const CACHE_NAME = "braketrace-v15";
const BASE_PATH = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const withBase = (path) => `${BASE_PATH}${path}`;
const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/assets/spec-secondary.svg",
  "/data/fixtures-2025-manifest.json",
  "/assets/audio/shanghai.m4a",
  "/assets/drivers/ALB.webp",
  "/assets/drivers/ALO.webp",
  "/assets/drivers/ANT.webp",
  "/assets/drivers/BEA.webp",
  "/assets/drivers/BOR.webp",
  "/assets/drivers/COL.webp",
  "/assets/drivers/DOO.webp",
  "/assets/drivers/GAS.webp",
  "/assets/drivers/HAD.webp",
  "/assets/drivers/HAM.webp",
  "/assets/drivers/HUL.webp",
  "/assets/drivers/LAW.webp",
  "/assets/drivers/LEC.webp",
  "/assets/drivers/NOR.webp",
  "/assets/drivers/OCO.webp",
  "/assets/drivers/PIA.webp",
  "/assets/drivers/RUS.webp",
  "/assets/drivers/SAI.webp",
  "/assets/drivers/STR.webp",
  "/assets/drivers/TSU.webp",
  "/assets/drivers/VER.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => {
        const manifestPath = withBase("/data/fixtures-2025-manifest.json");
        await Promise.allSettled(APP_SHELL.map((asset) => cache.add(withBase(asset))));

        const manifestResponse =
          (await fetch(manifestPath).catch(() => null)) ||
          (await cache.match(manifestPath));

        if (manifestResponse) {
          const manifest = await manifestResponse.json().catch(() => []);
          await Promise.allSettled(manifest.map((fixture) => cache.add(withBase(fixture.dataPath))));
        }
      })
      .then(() => self.skipWaiting())
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
        .catch(() => caches.match(withBase("/index.html")));
    })
  );
});
