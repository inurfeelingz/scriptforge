// frontend/src/lib/notifications.js
// Browser Notification API wrapper — notifies you when generation finishes
// even if you've switched tabs. No server required (not Push API — just local).

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  const perm = await Notification.requestPermission()
  return perm === 'granted'
}

export function notifyGeneration(trackName, episodeNumber) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return  // tab is active — no need

  const n = new Notification('Episode ready', {
    body: `Ep ${episodeNumber} — ${trackName} is ready to download`,
    icon: '/manifest.json',  // fallback — replace with actual icon path
    tag:  'scriptforge-generation',  // replaces previous notification instead of stacking
    silent: false,
  })

  // Auto-close after 8 seconds
  setTimeout(() => n.close(), 8000)

  // Focus the tab when clicked
  n.onclick = () => {
    window.focus()
    n.close()
  }
}
