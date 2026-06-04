const CACHE = 'lending-accountant-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return
  if (e.request.url.includes('/@vite/')) return

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fetchPromise = fetch(e.request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone()
          caches.open(CACHE).then((c) => c.put(e.request, clone))
        }
        return res
      }).catch(() => cached)
      return cached || fetchPromise
    })
  )
})