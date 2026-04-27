// frontend/public/sw.js
// WhispaCuts service worker — Batch 6:
//   Offline-first: Teleprompter, Vault, episode review work without internet.
//   Push: handles incoming VAPID push notifications.
//   Background sync: companion session entries flush when reconnected.

const CACHE_VERSION = 'wc-v3'
const STATIC_CACHE  = `${CACHE_VERSION}-static`
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`

// ── Pages that should work fully offline ─────────────────────────────────────
const OFFLINE_PAGES = [
  '/',
  '/teleprompter',
  '/vault',
  '/companion',
]

// ── Static assets to precache on install ─────────────────────────────────────
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
]

// ── Install ───────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  )
})

// ── Activate: clean old caches ────────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k.startsWith('wc-') && k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  )
})

// ── Fetch strategy ────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  // Skip non-GET, cross-origin, and extension requests
  if (request.method !== 'GET') return
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/__')) return  // Vite HMR

  // API calls: network first, offline fallback for reads
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithOfflineFallback(request))
    return
  }

  // Navigation to offline pages: cache first, network fallback
  if (request.mode === 'navigate') {
    const isOfflinePage = OFFLINE_PAGES.some(p =>
      url.pathname === p || url.pathname.startsWith(p + '/')
    )
    if (isOfflinePage) {
      event.respondWith(cacheFirstWithNetworkUpdate(request))
      return
    }
    // Other navigation: network first, fall back to cached shell
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) cacheResponse(DYNAMIC_CACHE, request, response.clone())
          return response
        })
        .catch(() => caches.match('/') || caches.match(request))
    )
    return
  }

  // Static assets (JS, CSS, images, fonts): stale-while-revalidate
  if (
    url.pathname.match(/\.(js|css|png|jpg|svg|ico|woff2?|ttf)$/) ||
    url.pathname.startsWith('/assets/')
  ) {
    event.respondWith(staleWhileRevalidate(request))
    return
  }

  // Everything else: network first
  event.respondWith(fetch(request).catch(() => caches.match(request)))
})

// ── Cache strategies ──────────────────────────────────────────────────────────

async function networkFirstWithOfflineFallback(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      // Only cache GET API reads — skip mutations
      const url = new URL(request.url)
      if (['episodes', 'vault', 'categories'].some(p => url.pathname.includes(p))) {
        await cacheResponse(DYNAMIC_CACHE, request, response.clone())
      }
    }
    return response
  } catch {
    const cached = await caches.match(request)
    return cached || new Response(
      JSON.stringify({ error: 'offline', cached: false }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

async function cacheFirstWithNetworkUpdate(request) {
  const cached = await caches.match(request)
  const networkFetch = fetch(request).then(response => {
    if (response.ok) cacheResponse(STATIC_CACHE, request, response.clone())
    return response
  }).catch(() => null)

  return cached || networkFetch || caches.match('/')
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone())
    return response
  }).catch(() => cached)
  return cached || networkFetch
}

async function cacheResponse(cacheName, request, response) {
  try {
    const cache = await caches.open(cacheName)
    await cache.put(request, response)
  } catch {}
}

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return

  let payload
  try { payload = event.data.json() }
  catch { payload = { title: 'WhispaCuts', body: event.data.text() } }

  const {
    title   = 'WhispaCuts',
    body    = '',
    icon    = '/icons/icon-192x192.png',
    badge   = '/icons/icon-48x48.png',
    tag     = 'whispacuts',
    data    = {},
    actions = [],
  } = payload

  event.waitUntil(
    self.registration.showNotification(title, {
      body, icon, badge, tag, data, actions,
      requireInteraction: tag === 'episode-ready',  // stay until dismissed for important ones
    })
  )
})

// ── Notification click ────────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close()

  if (event.action === 'dismiss') return

  const url = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Focus existing tab if open
      const existing = clients.find(c => c.url.includes(self.location.origin))
      if (existing) {
        existing.focus()
        existing.navigate(self.location.origin + url)
        return
      }
      // Open new window
      return self.clients.openWindow(self.location.origin + url)
    })
  )
})

// ── Background sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-session-entries') {
    event.waitUntil(
      self.clients.matchAll().then(clients =>
        clients.forEach(c => c.postMessage({ type: 'SYNC_ENTRIES' }))
      )
    )
  }
})

// ── Message from main thread ──────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})