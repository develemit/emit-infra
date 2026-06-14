const CACHE_NAME = 'emit-infra-v4'
const OFFLINE_URL = '/offline'

const STATIC_PATTERNS = [
  /^\/_next\/static\//,
  /^\/icon.*\.png$/,
  /^\/favicon\.ico$/,
  /^\/manifest\.json$/,
  /^\/icon\.svg$/,
]

function isStatic(url) {
  const { pathname } = new URL(url)
  return STATIC_PATTERNS.some(p => p.test(pathname))
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('push', (event) => {
  let payload = { title: 'emit-infra', body: '' }
  try {
    if (event.data) payload = event.data.json()
  } catch {
    // Non-JSON body — keep defaults
  }

  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-32.png',
    tag: payload.tag,
    data: { url: payload.url || '/' },
    requireInteraction: false,
  }

  event.waitUntil(self.registration.showNotification(payload.title || 'emit-infra', options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil((async () => {
    const want = new URL(targetUrl, self.registration.scope)
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      try {
        const clientUrl = new URL(client.url)
        if (clientUrl.origin === want.origin) {
          await client.focus()
          client.postMessage({ type: 'sw:navigate', url: want.pathname + want.search })
          return
        }
      } catch {
        // bad URL — fall through
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(want.href)
  })())
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  if (isStatic(request.url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached
          return fetch(request).then(res => {
            if (res.ok) cache.put(request, res.clone())
            return res
          })
        })
      )
    )
  } else {
    // Network-first; fall back to cached copy, then offline page
    event.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok && request.destination === 'document') {
            caches.open(CACHE_NAME).then(cache => cache.put(request, res.clone()))
          }
          return res
        })
        .catch(() =>
          caches.match(request).then(cached => cached ?? caches.match(OFFLINE_URL))
        )
    )
  }
})
