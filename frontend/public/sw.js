// frontend/public/sw.js — WhispaCuts service worker
// Auto-updates: bumps CACHE_VERSION, clears old caches, activates immediately.
// On update: posts UPDATE_AVAILABLE to all clients so the app can prompt reload.

const CACHE_VERSION = 'wc-v6'   // ← bump this string on every deploy
const STATIC_CACHE  = `${CACHE_VERSION}-static`
const DYNAMIC_CACHE = `${CACHE_VERSION}-dynamic`

const PRECACHE = ['/', '/manifest.json', '/favicon.svg']

const OFFLINE_PAGES = ['/', '/teleprompter', '/vault', '/companion']

// ── Install: cache shell, skip waiting immediately ────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())   // activate new SW without waiting for tabs to close
  )
})

// ── Activate: delete ALL old caches, claim clients ───────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(k => k !== STATIC_CACHE && k !== DYNAMIC_CACHE)
          .map(k => {
            console.log('[sw] Deleting old cache:', k)
            return caches.delete(k)
          })
      ))
      .then(() => self.clients.claim())   // take control of all open tabs immediately
      .then(() => notifyClients({ type: 'SW_UPDATED', version: CACHE_VERSION }))
  )
})

// ── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)

  if (request.method !== 'GET')               return
  if (url.origin !== self.location.origin)    return
  if (url.pathname.startsWith('/__'))         return  // Vite HMR
  if (url.pathname.startsWith('/@'))          return  // Vite internals

  // API: network first, cache reads for offline fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, DYNAMIC_CACHE,
      ['episodes', 'vault', 'categories']))
    return
  }

  // Navigation: offline pages get cache-first; everything else network-first
  if (request.mode === 'navigate') {
    const isOffline = OFFLINE_PAGES.some(p =>
      url.pathname === p || url.pathname.startsWith(p + '/'))
    event.respondWith(isOffline
      ? cacheFirst(request, STATIC_CACHE)
      : networkFirstNav(request))
    return
  }

  // JS/CSS: network-first so new deploys always load fresh code
  // Images/fonts: stale-while-revalidate (safe to cache)
  if (url.pathname.match(/\.(js|css)$/) ||
      url.pathname.startsWith('/assets/')) {
    event.respondWith(networkFirstAsset(request))
    return
  }
  if (url.pathname.match(/\.(png|jpg|webp|svg|ico|woff2?|ttf)$/) ||
      url.pathname.startsWith('/icons/')) {
    event.respondWith(staleWhileRevalidate(request))
    return
  }

  event.respondWith(fetch(request).catch(async () => (await caches.match(request)) || new Response('', { status: 503 })))
})

// ── Strategies ────────────────────────────────────────────────────────────────

async function networkFirst(request, cacheName, cacheableKeywords = []) {
  try {
    const response = await fetch(request)
    if (response.ok && cacheableKeywords.some(k => request.url.includes(k))) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    return cached || new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )
  }
}

async function networkFirstNav(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(DYNAMIC_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request) || await caches.match('/')
    return cached || new Response('Offline — please reconnect', { status: 503, headers: { 'Content-Type': 'text/plain' } })
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request)
  if (cached) {
    // Revalidate in background
    fetch(request).then(r => {
      if (r.ok) caches.open(cacheName).then(c => c.put(request, r))
    }).catch(() => {})
    return cached
  }
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(cacheName)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    return (await caches.match('/')) || new Response('Offline', { status: 503 })
  }
}

async function networkFirstAsset(request) {
  try {
    const response = await fetch(request)
    if (response.ok) {
      const cache = await caches.open(STATIC_CACHE)
      cache.put(request, response.clone())
    }
    return response
  } catch {
    const cached = await caches.match(request)
    return cached || new Response('Asset unavailable offline', { status: 503 })
  }
}

async function staleWhileRevalidate(request) {
  const cache  = await caches.open(STATIC_CACHE)
  const cached = await cache.match(request)
  const fresh  = fetch(request).then(r => {
    if (r.ok) cache.put(request, r.clone())
    return r
  }).catch(() => null)
  return cached || await fresh
}

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', event => {
  if (!event.data) return
  let payload
  try   { payload = event.data.json() }
  catch { payload = { title: 'WhispaCuts', body: event.data.text() } }

  const { title = 'WhispaCuts', body = '', icon = '/icons/icon-192x192.png',
          badge = '/icons/icon-48x48.png', tag = 'whispacuts',
          data = {}, actions = [] } = payload

  event.waitUntil(
    self.registration.showNotification(title, {
      body, icon, badge, tag, data, actions,
      requireInteraction: tag === 'episode-ready',
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  if (event.action === 'dismiss') return
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        const existing = clients.find(c => c.url.includes(self.location.origin))
        if (existing) { existing.focus(); existing.navigate(self.location.origin + url); return }
        return self.clients.openWindow(self.location.origin + url)
      })
  )
})

// ── Background sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-session-entries') {
    event.waitUntil(
      self.clients.matchAll()
        .then(clients => clients.forEach(c => c.postMessage({ type: 'SYNC_ENTRIES' })))
    )
  }
})

// ── Messages from main thread ─────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

// ── Utility ───────────────────────────────────────────────────────────────────
async function notifyClients(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true })
  clients.forEach(c => c.postMessage(message))
}