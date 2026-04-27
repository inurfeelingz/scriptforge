// frontend/src/lib/notifications.js
// Notification layer — two modes:
//   1. Local browser notification (tab inactive, no Push API needed)
//   2. Web Push via VAPID (background delivery even when tab is closed)

const API_BASE = import.meta.env.VITE_API_URL || '/api'

// ── Local notification ────────────────────────────────────────────────────────

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  const perm = await Notification.requestPermission()
  return perm === 'granted'
}

export function notifyGeneration(trackName, episodeNumber) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return

  const n = new Notification('Episode ready', {
    body:   `Ep ${episodeNumber} — "${trackName}" is ready to review`,
    icon:   '/icons/icon-192x192.png',
    tag:    'whispacuts-generation',
    silent: false,
  })
  setTimeout(() => n.close(), 8000)
  n.onclick = () => { window.focus(); n.close() }
}

// ── Push API (VAPID) ──────────────────────────────────────────────────────────

let _pushEnabled  = false
let _subscription = null

export async function subscribeToPush(accessToken) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  try {
    const keyRes = await fetch(`${API_BASE}/push/vapid-public-key`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!keyRes.ok) return false
    const { publicKey } = await keyRes.json()
    if (!publicKey) return false

    const registration = await navigator.serviceWorker.ready
    let subscription   = await registration.pushManager.getSubscription()

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
    }

    const saveRes = await fetch(`${API_BASE}/push/subscribe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body:    JSON.stringify({ subscription }),
    })

    if (saveRes.ok) { _pushEnabled = true; _subscription = subscription; return true }
    return false
  } catch (err) {
    console.warn('[notifications] Push subscription failed:', err.message)
    return false
  }
}

export async function unsubscribeFromPush(accessToken) {
  if (!_subscription) return
  try {
    await _subscription.unsubscribe()
    await fetch(`${API_BASE}/push/unsubscribe`, {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body:    JSON.stringify({ endpoint: _subscription.endpoint }),
    })
    _pushEnabled = false; _subscription = null
  } catch (err) { console.warn('[notifications] Unsubscribe failed:', err.message) }
}

export async function getPushStatus(accessToken) {
  try {
    const res = await fetch(`${API_BASE}/push/status`, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) return { active: false, vapidConfigured: false }
    return res.json()
  } catch { return { active: false, vapidConfigured: false } }
}

export async function sendTestPush(accessToken) {
  const res = await fetch(`${API_BASE}/push/test`, {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error('Test push failed')
  return res.json()
}

export function isPushEnabled() { return _pushEnabled }

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
    console.log('[sw] Registered:', reg.scope)
    return reg
  } catch (err) { console.warn('[sw] Failed:', err.message); return null }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw     = window.atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}