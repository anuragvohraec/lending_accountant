const VERSION = '7';
const CACHE = 'munimji-' + VERSION;

const URLS = [
  './',
  './index.html',
  './manifest.json',
  './assets/index.js',
  './assets/index.css',
  './icons/icon-72.svg',
  './icons/icon-96.svg',
  './icons/icon-128.svg',
  './icons/icon-144.svg',
  './icons/icon-152.svg',
  './icons/icon-192.svg',
  './icons/icon-384.svg',
  './icons/icon-512.svg',
];

const APP_PATHS = ['/assets/', '/icons/'];

const ALLOWED_CDN_ORIGINS = [
  "unpkg.com",
  "fonts.googleapis.com",
  "://gstatic.com",
  "cdn.jsdelivr.net"
];

self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  } else if (e.data?.type === "GET_VERSION") {
    e.source.postMessage({ type: "VERSION", version: VERSION });
  }
});

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => {
     return cache.addAll(URLS);
 }));
 self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then((cacheNames) => {
        return Promise.all(cacheNames.map((cacheName) => {
          if (cacheName !== CACHE) return caches.delete(cacheName);
        }));
      }),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("fetch", (e) => {
    const requestUrl = new URL(e.request.url);
    const url_path = requestUrl.pathname;
    const url_origin = requestUrl.host;

    const isLocalAsset = APP_PATHS.some(p => url_path.includes(p));

    const isCDNAsset = ALLOWED_CDN_ORIGINS.includes(url_origin);

    if (isLocalAsset || isCDNAsset) {
        e.respondWith((async () => {
            const cachedResponse = await caches.match(e.request);
            if (cachedResponse) {
                return cachedResponse; 
            }
            
            try {
                const response = await fetch(e.request);
                
                if (response.status === 200 || response.status === 0) {
                    const cache = await caches.open(CACHE);
                    cache.put(e.request, response.clone());
                }
                return response;
            } catch (error) {
                throw error;
            }
        })());
        return; 
    }

    e.respondWith(
        caches.match(e.request).then((res) => {
            return res || fetch(e.request);
        })
    );
});
