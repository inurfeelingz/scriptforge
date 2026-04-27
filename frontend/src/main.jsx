// frontend/src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './companion.css'

// ── Service worker registration + auto-update ─────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      console.log('[sw] Registered:', reg.scope)

      // Check for updates immediately on load, then every 60 seconds
      reg.update()
      setInterval(() => reg.update(), 60 * 1000)

      // When a new SW is waiting, activate it immediately
      reg.addEventListener('updatefound', () => {
        const incoming = reg.installing
        if (!incoming) return
        incoming.addEventListener('statechange', () => {
          if (incoming.state === 'installed' && navigator.serviceWorker.controller) {
            // New version available — tell it to skip waiting and reload
            incoming.postMessage({ type: 'SKIP_WAITING' })
          }
        })
      })

      // When SW activates a new version, reload the page to get fresh assets
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload()
      })

      // Listen for SW_UPDATED message (sent from sw.js activate event)
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'SW_UPDATED') {
          console.log('[sw] Updated to', event.data.version)
        }
      })
    } catch (err) {
      console.warn('[sw] Registration failed:', err.message)
    }
  })
}

// ── Apply saved theme before first paint ──────────────────────────────────────
try {
  const t = localStorage.getItem('wc_theme')
  if (t === 'light') {
    const root = document.documentElement
    root.setAttribute('data-theme', 'light')
    root.style.setProperty('--bg',       '#f4f3f8')
    root.style.setProperty('--surface',  '#ffffff')
    root.style.setProperty('--text',     '#1a1824')
    root.style.setProperty('--text2',    '#5a5870')
    root.style.setProperty('--text3',    '#9a98b0')
    root.style.setProperty('--accent',   '#b8882a')
  }
} catch {}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)