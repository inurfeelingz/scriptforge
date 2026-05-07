// backend/src/routes/credits.js
// Credit balance, purchase, and admin management
// Mount in server.js: app.use('/api/credits', authMiddleware, require('./routes/credits'))

const express      = require('express')
const axios        = require('axios')
const { supabase } = require('../utils/supabase')
const { getBalance, topUp, CREDIT_COSTS, TIER_CREDITS } = require('../utils/creditManager')
const router       = express.Router()

const PAYPAL_BASE = process.env.PAYPAL_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

// Credit top-up packs — price in USD, credits awarded
// Priced so users get fair value and you maintain ~2× cost margin
const CREDIT_PACKS = [
  { id: 'pack_50',  credits: 50,  price: 5,  label: '50 credits',  perCredit: '$0.10', episodes: '~5 episodes',  planEnvKey: 'PAYPAL_CREDITS_50_PLAN_ID'  },
  { id: 'pack_150', credits: 150, price: 12, label: '150 credits', perCredit: '$0.08', episodes: '~15 episodes', planEnvKey: 'PAYPAL_CREDITS_150_PLAN_ID' },
  { id: 'pack_350', credits: 350, price: 25, label: '350 credits', perCredit: '$0.07', episodes: '~35 episodes', planEnvKey: 'PAYPAL_CREDITS_350_PLAN_ID' },
]

async function getPayPalToken() {
  const res = await axios.post(
    `${PAYPAL_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      auth: { username: process.env.PAYPAL_CLIENT_ID, password: process.env.PAYPAL_CLIENT_SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  )
  return res.data.access_token
}

// ── GET /api/credits/balance ──────────────────────────────────────────────────
router.get('/balance', async (req, res) => {
  try {
    const balance = await getBalance(req.user.id)
    res.json({
      ...balance,
      costs: CREDIT_COSTS,
      packs: CREDIT_PACKS.map(p => ({ ...p, planId: process.env[p.planEnvKey] })),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── POST /api/credits/purchase ────────────────────────────────────────────────
// Creates a PayPal one-time payment for a credit pack
router.post('/purchase', async (req, res) => {
  const { packId } = req.body
  const pack = CREDIT_PACKS.find(p => p.id === packId)
  if (!pack) return res.status(400).json({ error: `Unknown pack: ${packId}` })

  try {
    const token = await getPayPalToken()

    // Create a one-time PayPal order (not subscription)
    const response = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders`,
      {
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'USD',
            value: pack.price.toFixed(2),
          },
          description: `WhispaCuts ${pack.label} — ${pack.episodes}`,
          custom_id: `${req.user.id}:${packId}`,
        }],
        application_context: {
          brand_name:          'WhispaCuts',
          locale:              'en-US',
          shipping_preference: 'NO_SHIPPING',
          user_action:         'PAY_NOW',
          return_url: `${process.env.FRONTEND_URL}/billing?credits=success&pack=${packId}&order={id}`,
          cancel_url: `${process.env.FRONTEND_URL}/billing?credits=cancelled`,
        },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    )

    const order = response.data
    const approvalUrl = order.links?.find(l => l.rel === 'approve')?.href

    // Store pending purchase
    await supabase.from('credit_transactions').insert({
      user_id:    req.user.id,
      amount:     pack.credits,
      type:       'purchase_pending',
      reason:     packId,
      paypal_order_id: order.id,
      balance_after: null,
      created_at: new Date().toISOString(),
    }).catch(() => {})

    res.json({ orderId: order.id, approvalUrl, pack })
  } catch (err) {
    const detail = err.response?.data?.message || err.message
    console.error('[credits/purchase]', detail)
    res.status(500).json({ error: `PayPal error: ${detail}` })
  }
})

// ── POST /api/credits/capture ─────────────────────────────────────────────────
// Called after PayPal approval — capture payment and award credits
router.post('/capture', async (req, res) => {
  const { orderId, packId } = req.body
  if (!orderId || !packId) return res.status(400).json({ error: 'orderId and packId required' })

  const pack = CREDIT_PACKS.find(p => p.id === packId)
  if (!pack) return res.status(400).json({ error: 'Unknown pack' })

  try {
    const token = await getPayPalToken()

    // Capture the payment
    const response = await axios.post(
      `${PAYPAL_BASE}/v2/checkout/orders/${orderId}/capture`,
      {},
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    )

    const capture = response.data
    if (capture.status !== 'COMPLETED') {
      return res.status(400).json({ error: `Payment not completed: ${capture.status}` })
    }

    // Award credits
    const { newBalance } = await topUp(req.user.id, pack.credits, packId)

    // Update pending transaction
    await supabase
      .from('credit_transactions')
      .update({ type: 'purchase', balance_after: newBalance, updated_at: new Date().toISOString() })
      .eq('paypal_order_id', orderId)
      .catch(() => {})

    console.info(`[credits] Purchase complete: user=${req.user.id} pack=${packId} credits=${pack.credits} new_balance=${newBalance}`)
    res.json({ success: true, creditsAdded: pack.credits, newBalance })
  } catch (err) {
    const detail = err.response?.data?.message || err.message
    console.error('[credits/capture]', detail)
    res.status(500).json({ error: `Capture failed: ${detail}` })
  }
})

// ── GET /api/credits/history ──────────────────────────────────────────────────
router.get('/history', async (req, res) => {
  const { data, error } = await supabase
    .from('credit_transactions')
    .select('amount, type, reason, balance_after, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ transactions: data || [] })
})

// ── POST /api/credits/admin-topup ─────────────────────────────────────────────
// Admin only — manually top up a user
router.post('/admin-topup', async (req, res) => {
  if (!req.profile?.is_admin) return res.status(403).json({ error: 'Admin only' })

  const { userId, amount, reason = 'admin_gift' } = req.body
  if (!userId || !amount) return res.status(400).json({ error: 'userId and amount required' })

  try {
    const { newBalance } = await topUp(userId, amount, reason)
    res.json({ success: true, newBalance })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router