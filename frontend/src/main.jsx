// frontend/src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './companion.css'
import { registerServiceWorker } from './lib/notifications'

// Register service worker — covers offline pages + push notifications
window.addEventListener('load', () => {
  registerServiceWorker()
})

// Apply saved theme before first paint
try {
  const t = localStorage.getItem('wc_theme')
  if (t === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
    document.documentElement.style.setProperty('--sf-bg',   '#f8f6f2')
    document.documentElement.style.setProperty('--sf-text', '#1a1a1a')
  }
} catch {}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)