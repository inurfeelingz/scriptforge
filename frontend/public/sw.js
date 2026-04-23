// frontend/public/sw.js
// Service worker for WhispaCuts Companion PWA.
// Handles: offline caching, background sync for queued entries.

const CACHE_NAME = 'sf-companion-v1'
const PRECACHE   = [
  '/companion',
  '/manifest.json',
]

// ── Install: precache the companion shell ────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE))
  )
  self.skipWaiting()
})

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// ── Fetch: serve companion shell from cache when offline ─────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)

  // Only intercept same-origin navigation requests for companion
  if (event.request.mode === 'navigate' && url.pathname === '/companion') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/companion'))
    )
    return
  }

  // API calls: network first, fail silently (app handles offline queuing)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(err => {
        return new Response(JSON.stringify({ error: 'offline', queued: true }), {
          status:  503,
          headers: { 'Content-Type': 'application/json' }
        })
      })
    )
    return
  }

  // Static assets: cache first
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).then(response => {
        if (response.ok && event.request.method === 'GET') {
          const clone = response.clone()
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone))
        }
        return response
      })
    )
  )
})

// ── Background sync: flush offline queue when back online ────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-session-entries') {
    event.waitUntil(syncSessionEntries())
  }
})

async function syncSessionEntries() {
  // The main app handles offline queuing via IndexedDB/memory.
  // This is a signal to the page to flush.
  const clients = await self.clients.matchAll()
  clients.forEach(client => client.postMessage({ type: 'SYNC_ENTRIES' }))
}
