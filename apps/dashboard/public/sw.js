const CACHE_NAME = 'emit-infra-v1'

const STATIC_PATTERNS = [
  /^\/_next\/static\//,
  /^\/icon.*\.png$/,
  /^\/favicon\.ico$/,
  /^\/manifest\.json$/,
  /^\/icon\.svg$/,
]

const API_PATTERN = /localhost:3001/

function isStatic(url) {
  const { pathname } = new URL(url)
  return STATIC_PATTERNS.some(p => p.test(pathname))
}

function isApi(url) {
  return API_PATTERN.test(url)
}

self.addEventListener('install', event => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = request.url

  // Never cache API calls
  if (isApi(url)) return

  if (isStatic(url)) {
    // Cache-first for static assets
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
    // Network-first for everything else (page navigations, etc.)
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    )
  }
})
