// frontend/src/main.jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import './companion.css'

// Register service worker for companion PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(console.warn)
  })
}

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
