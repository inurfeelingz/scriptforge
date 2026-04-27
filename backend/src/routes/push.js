// backend/src/routes/push.js
// Push notification subscription management.
//
//   GET    /api/push/vapid-public-key   — returns VAPID public key for frontend subscribe
//   POST   /api/push/subscribe          — saves a push subscription
//   DELETE /api/push/unsubscribe        — removes a push subscription
//   GET    /api/push/status             — checks if user has active subscriptions
//   POST   /api/push/test               — sends a test push to the current user

const express      = require('express')
const pushService  = require('../services/pushService')

const router = express.Router()

// ─── VAPID PUBLIC KEY ─────────────────────────────────────────────────────────
// Frontend needs this to call PushManager.subscribe()

router.get('/vapid-public-key', (req, res) => {
  const key = process.env.VAPID_PUBLIC_KEY
  if (!key) return res.status(503).json({ error: 'Push notifications not configured' })
  res.json({ publicKey: key })
})

// ─── SUBSCRIBE ────────────────────────────────────────────────────────────────

router.post('/subscribe', async (req, res) => {
  const { subscription } = req.body
  if (!subscription?.endpoint) {
    return res.status(400).json({ error: 'Valid push subscription required' })
  }
  try {
    await pushService.saveSubscription(req.user.id, subscription)
    res.json({ subscribed: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── UNSUBSCRIBE ──────────────────────────────────────────────────────────────

router.delete('/unsubscribe', async (req, res) => {
  const { endpoint } = req.body
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' })
  try {
    await pushService.removeSubscription(req.user.id, endpoint)
    res.json({ unsubscribed: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── STATUS ───────────────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const subs = await pushService.getSubscriptions(req.user.id)
    res.json({
      active:            subs.length > 0,
      subscriptionCount: subs.length,
      vapidConfigured:   !!process.env.VAPID_PUBLIC_KEY,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ─── TEST PUSH ────────────────────────────────────────────────────────────────

router.post('/test', async (req, res) => {
  try {
    const result = await pushService.sendToUser(
      req.user.id,
      pushService.scheduleReminderPayload(
        'WhispaCuts push notifications are working.',
        '/'
      )
    )
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
