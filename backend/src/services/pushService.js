// backend/src/services/pushService.js
// Web Push (VAPID) notification delivery.
// Handles subscription storage, targeted delivery, and broadcast.
//
// Required env vars (Railway):
//   VAPID_PUBLIC_KEY   — generate with: npx web-push generate-vapid-keys
//   VAPID_PRIVATE_KEY  — from the same command
//   VAPID_SUBJECT      — mailto:your@email.com or https://yourdomain.com
//
// The frontend subscribes via the Push API using VAPID_PUBLIC_KEY.
// Subscriptions are stored in push_subscriptions table in Supabase.

const webpush    = require('web-push')
const { supabase } = require('../utils/supabase')

// Configure VAPID — called once at startup
function configure() {
  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    console.warn('[pushService] VAPID keys not configured — push notifications disabled')
    return false
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:admin@whispacuts.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
  return true
}

// ── Subscription management ───────────────────────────────────────────────────

async function saveSubscription(userId, subscription) {
  // subscription = { endpoint, keys: { p256dh, auth } }
  const endpoint = subscription.endpoint
  if (!endpoint) throw new Error('Invalid push subscription — missing endpoint')

  await supabase.from('push_subscriptions').upsert({
    user_id:      userId,
    endpoint,
    p256dh:       subscription.keys?.p256dh,
    auth:         subscription.keys?.auth,
    user_agent:   subscription.userAgent || null,
    subscribed_at: new Date().toISOString(),
    updated_at:   new Date().toISOString(),
  }, { onConflict: 'user_id,endpoint' })
}

async function removeSubscription(userId, endpoint) {
  await supabase.from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', endpoint)
}

async function getSubscriptions(userId) {
  const { data } = await supabase.from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId)
  return data || []
}

// ── Send to a single user (all their devices) ─────────────────────────────────

async function sendToUser(userId, payload) {
  if (!process.env.VAPID_PUBLIC_KEY) return { sent: 0, failed: 0 }

  const subs    = await getSubscriptions(userId)
  let sent = 0, failed = 0
  const expired = []

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify(payload),
        { TTL: 86400 }   // 24h — if device is offline, deliver when it comes back
      )
      sent++
    } catch (err) {
      // 410 Gone = subscription expired/revoked — clean up
      if (err.statusCode === 410 || err.statusCode === 404) {
        expired.push(sub.endpoint)
      }
      failed++
    }
  }

  // Clean up expired subscriptions
  if (expired.length) {
    await supabase.from('push_subscriptions')
      .delete()
      .eq('user_id', userId)
      .in('endpoint', expired)
  }

  return { sent, failed }
}

// ── Notification payloads ─────────────────────────────────────────────────────

function episodeReadyPayload(trackName, episodeNumber) {
  return {
    title: 'Episode ready',
    body:  `Ep ${episodeNumber} — "${trackName}" is ready to review`,
    icon:  '/icons/icon-192x192.png',
    badge: '/icons/icon-48x48.png',
    tag:   'episode-ready',
    data:  { url: '/generate', type: 'episode_ready' },
    actions: [
      { action: 'open',    title: 'Open WhispaCuts' },
      { action: 'dismiss', title: 'Dismiss'         },
    ],
  }
}

function scheduleReminderPayload(message, route = '/') {
  return {
    title: 'WhispaCuts',
    body:  message,
    icon:  '/icons/icon-192x192.png',
    badge: '/icons/icon-48x48.png',
    tag:   'schedule-reminder',
    data:  { url: route, type: 'schedule_reminder' },
    actions: [
      { action: 'open',    title: 'Open' },
      { action: 'dismiss', title: 'Later' },
    ],
  }
}

function weeklyPullPayload(videoCount, episodesMatched) {
  return {
    title: 'Analytics updated',
    body:  `${videoCount} videos synced from YouTube · ${episodesMatched} episodes matched`,
    icon:  '/icons/icon-192x192.png',
    tag:   'analytics-pull',
    data:  { url: '/analytics', type: 'analytics_pull' },
  }
}

module.exports = {
  configure,
  saveSubscription,
  removeSubscription,
  getSubscriptions,
  sendToUser,
  episodeReadyPayload,
  scheduleReminderPayload,
  weeklyPullPayload,
}
