// backend/src/routes/billing.js
// Single unified plan — WhispaCuts Studio
// All features included. No tier gating beyond free vs paid.

const express      = require('express')
const axios        = require('axios')
const { supabase } = require('../utils/supabase')
const router       = express.Router()

const PAYPAL_BASE = process.env.PAYPAL_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

// One plan, two billing periods
const PLANS = {
  studio_monthly: process.env.PAYPAL_STUDIO_MONTHLY_PLAN_ID,
  studio_yearly:  process.env.PAYPAL_STUDIO_YEARLY_PLAN_ID,
}

const STUDIO_LIMITS = { max_episodes_pm: 99999, max_categories: 99 }
const FREE_LIMITS   = { max_episodes_pm: 3,     max_categories: 1  }

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

// GET /api/billing/plans
router.get('/plans', (req, res) => {
  res.json({
    plans: [
      {
        id: 'free', name: 'Free', monthly: 0, yearly: 0,
        features: [
          '3 episodes per month',
          '1 workspace',
          'Full generation (VO + EDL + Shorts + Metadata)',
          'Companion app',
        ],
        limits: FREE_LIMITS,
      },
      {
        id: 'studio', name: 'Studio', monthly: 49, yearly: 490,
        yearlyMonthly: 40.83, savings: 98,
        planIds: { monthly: PLANS.studio_monthly, yearly: PLANS.studio_yearly },
        features: [
          'Unlimited episodes',
          'Unlimited workspaces',
          'Full AI generation — VO, EDL, Shorts, Metadata',
          'Companion voice recorder',
          'YouTube Analytics & scheduling',
          'Session journals & script library',
          'Series bible & voice training',
          'Shot list generator',
          'Sound library',
          'Knowledge base chat (KP)',
        ],
        limits: STUDIO_LIMITS,
        popular: true,
      },
    ],
  })
})

// GET /api/billing/status
router.get('/status', async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('tier, subscription_id, subscription_status, subscription_period, subscription_next_billing')
    .eq('id', req.user.id)
    .single()

  const tier = profile?.tier === 'pro' ? 'studio' : (profile?.tier || 'free')
  res.json({
    tier,
    subscriptionId: profile?.subscription_id,
    status:         profile?.subscription_status,
    period:         profile?.subscription_period,
    nextBilling:    profile?.subscription_next_billing,
    limits:         tier === 'studio' ? STUDIO_LIMITS : FREE_LIMITS,
  })
})

// POST /api/billing/subscribe
router.post('/subscribe', async (req, res) => {
  const { planKey } = req.body  // 'studio_monthly' | 'studio_yearly'
  const planId = PLANS[planKey]
  if (!planId) return res.status(400).json({ error: `Unknown plan: ${planKey}` })

  try {
    const token = await getPayPalToken()
    const response = await axios.post(
      `${PAYPAL_BASE}/v1/billing/subscriptions`,
      {
        plan_id: planId,
        application_context: {
          brand_name: 'WhispaCuts', locale: 'en-US',
          shipping_preference: 'NO_SHIPPING', user_action: 'SUBSCRIBE_NOW',
          return_url: `${process.env.FRONTEND_URL}/billing?billing=success&plan=${planKey}`,
          cancel_url: `${process.env.FRONTEND_URL}/billing?billing=cancelled`,
        },
      },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' } }
    )

    const sub = response.data
    const approvalUrl = sub.links?.find(l => l.rel === 'approve')?.href
    await supabase.from('profiles').update({ subscription_id: sub.id, subscription_status: 'pending' }).eq('id', req.user.id)
    res.json({ subscriptionId: sub.id, approvalUrl })
  } catch (err) {
    const detail = err.response?.data?.message || err.message
    console.error('[billing] Subscribe error:', detail)
    res.status(500).json({ error: `PayPal error: ${detail}` })
  }
})

// POST /api/billing/webhook
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = JSON.parse(req.body)
  const type  = event.event_type
  const sub   = event.resource
  console.info('[billing] Webhook:', type, sub?.id)

  try {
    if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      const period = sub.plan_id === PLANS.studio_yearly ? 'yearly' : 'monthly'
      await supabase.from('profiles').update({
        tier: 'studio', subscription_id: sub.id, subscription_status: 'active',
        subscription_period: period, subscription_next_billing: sub.billing_info?.next_billing_time,
        ...STUDIO_LIMITS,
      }).eq('subscription_id', sub.id)
      console.info('[billing] Activated: studio', period, sub.id)
    }

    if (type === 'BILLING.SUBSCRIPTION.RENEWED') {
      await supabase.from('profiles').update({
        subscription_status: 'active',
        subscription_next_billing: sub.billing_info?.next_billing_time,
      }).eq('subscription_id', sub.id)
    }

    if (['BILLING.SUBSCRIPTION.CANCELLED','BILLING.SUBSCRIPTION.EXPIRED','BILLING.SUBSCRIPTION.SUSPENDED'].includes(type)) {
      await supabase.from('profiles').update({
        tier: 'free', subscription_status: type.split('.').pop().toLowerCase(), ...FREE_LIMITS,
      }).eq('subscription_id', sub.id)
      console.info('[billing] Downgraded to free:', sub.id)
    }

    if (type === 'PAYMENT.SALE.COMPLETED') {
      await supabase.from('billing_events').insert({
        user_subscription_id: sub.billing_agreement_id,
        event_type: 'payment', amount: sub.amount?.total, currency: sub.amount?.currency,
        paypal_event_id: event.id, created_at: new Date().toISOString(),
      }).catch(() => {})
    }
  } catch (err) {
    console.error('[billing] Webhook handler error:', err.message)
  }
  res.json({ received: true })
})

// POST /api/billing/cancel
router.post('/cancel', async (req, res) => {
  const { data: profile } = await supabase.from('profiles').select('subscription_id').eq('id', req.user.id).single()
  if (!profile?.subscription_id) return res.status(400).json({ error: 'No active subscription' })

  try {
    const token = await getPayPalToken()
    await axios.post(
      `${PAYPAL_BASE}/v1/billing/subscriptions/${profile.subscription_id}/cancel`,
      { reason: 'User requested cancellation' },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    )
    await supabase.from('profiles').update({ subscription_status: 'cancelled' }).eq('id', req.user.id)
    res.json({ cancelled: true })
  } catch (err) {
    res.status(500).json({ error: `Cancel failed: ${err.response?.data?.message || err.message}` })
  }
})

module.exports = router