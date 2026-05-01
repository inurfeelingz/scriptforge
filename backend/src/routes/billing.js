// backend/src/routes/billing.js
// PayPal subscription billing — monthly and yearly plans
// Tiers: free | pro | studio
// Plans created via PayPal Developer Dashboard, IDs stored in env vars

const express     = require('express')
const axios       = require('axios')
const { supabase } = require('../utils/supabase')
const router      = express.Router()

const PAYPAL_BASE = process.env.PAYPAL_ENV === 'production'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com'

// Plan IDs — set these in Railway after creating plans in PayPal Developer Dashboard
const PLANS = {
  pro_monthly:    process.env.PAYPAL_PRO_MONTHLY_PLAN_ID,
  pro_yearly:     process.env.PAYPAL_PRO_YEARLY_PLAN_ID,
  studio_monthly: process.env.PAYPAL_STUDIO_MONTHLY_PLAN_ID,
  studio_yearly:  process.env.PAYPAL_STUDIO_YEARLY_PLAN_ID,
}

const TIER_LIMITS = {
  free:   { max_episodes_pm: 2,     max_categories: 1  },
  pro:    { max_episodes_pm: 15,    max_categories: 3  },
  studio: { max_episodes_pm: 99999, max_categories: 99 },
}

// ── Get PayPal access token ───────────────────────────────────────────────────
async function getPayPalToken() {
  const res = await axios.post(
    `${PAYPAL_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      auth: {
        username: process.env.PAYPAL_CLIENT_ID,
        password: process.env.PAYPAL_CLIENT_SECRET,
      },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }
  )
  return res.data.access_token
}

// ── GET /api/billing/plans ────────────────────────────────────────────────────
// Returns available plans with pricing for the frontend
router.get('/plans', (req, res) => {
  res.json({
    plans: [
      {
        id:       'free',
        name:     'Free',
        monthly:  0,
        yearly:   0,
        features: [
          '2 episodes per month',
          '1 workspace',
          'Basic VO script',
          'Companion app',
        ],
        limits: TIER_LIMITS.free,
      },
      {
        id:            'pro',
        name:          'Pro',
        monthly:       19,
        yearly:        190,
        yearlyMonthly: 15.83,
        savings:       38,
        planIds: {
          monthly: PLANS.pro_monthly,
          yearly:  PLANS.pro_yearly,
        },
        features: [
          '15 episodes per month',
          '3 workspaces',
          'Full generation (VO + EDL + Shorts + Metadata)',
          'Companion app',
          'YouTube Analytics',
          'Session journals',
        ],
        limits: TIER_LIMITS.pro,
        popular: true,
      },
      {
        id:            'studio',
        name:          'Studio',
        monthly:       49,
        yearly:        490,
        yearlyMonthly: 40.83,
        savings:       98,
        planIds: {
          monthly: PLANS.studio_monthly,
          yearly:  PLANS.studio_yearly,
        },
        features: [
          'Unlimited episodes',
          'Unlimited workspaces',
          'Everything in Pro',
          'Series bible & voice training',
          'Priority generation',
          'Script library',
        ],
        limits: TIER_LIMITS.studio,
      },
    ],
  })
})

// ── GET /api/billing/status ───────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('tier, subscription_id, subscription_status, subscription_period, subscription_next_billing')
    .eq('id', req.user.id)
    .single()

  res.json({
    tier:               profile?.tier || 'free',
    subscriptionId:     profile?.subscription_id,
    status:             profile?.subscription_status,
    period:             profile?.subscription_period,
    nextBilling:        profile?.subscription_next_billing,
    limits:             TIER_LIMITS[profile?.tier || 'free'],
  })
})

// ── POST /api/billing/subscribe ──────────────────────────────────────────────
// Creates a PayPal subscription and returns approval URL
router.post('/subscribe', async (req, res) => {
  const { planKey } = req.body  // e.g. 'pro_monthly', 'studio_yearly'

  const planId = PLANS[planKey]
  if (!planId) return res.status(400).json({ error: `Unknown plan: ${planKey}` })

  try {
    const token = await getPayPalToken()
    const response = await axios.post(
      `${PAYPAL_BASE}/v1/billing/subscriptions`,
      {
        plan_id: planId,
        application_context: {
          brand_name:          'WhispaCuts',
          locale:              'en-US',
          shipping_preference: 'NO_SHIPPING',
          user_action:         'SUBSCRIBE_NOW',
          return_url: `${process.env.FRONTEND_URL}/settings?billing=success&plan=${planKey}`,
          cancel_url: `${process.env.FRONTEND_URL}/settings?billing=cancelled`,
        },
      },
      {
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer:         'return=representation',
        },
      }
    )

    const sub = response.data
    const approvalUrl = sub.links?.find(l => l.rel === 'approve')?.href

    // Store pending subscription ID
    await supabase
      .from('profiles')
      .update({ subscription_id: sub.id, subscription_status: 'pending' })
      .eq('id', req.user.id)

    res.json({ subscriptionId: sub.id, approvalUrl })
  } catch (err) {
    const detail = err.response?.data?.message || err.message
    console.error('[billing] Subscribe error:', detail)
    res.status(500).json({ error: `PayPal error: ${detail}` })
  }
})

// ── POST /api/billing/webhook ─────────────────────────────────────────────────
// PayPal webhook — handles subscription activation, renewal, cancellation
// Add this URL in PayPal Developer Dashboard → Webhooks
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const event = JSON.parse(req.body)
  const type  = event.event_type
  const sub   = event.resource

  console.info('[billing] Webhook:', type, sub?.id)

  try {
    if (type === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      // Subscription approved — upgrade tier
      const planId  = sub.plan_id
      const tier    = Object.entries(PLANS).find(([k,v]) => v === planId)?.[0]?.split('_')[0] || 'pro'
      const period  = planId === PLANS[`${tier}_yearly`] ? 'yearly' : 'monthly'

      await supabase
        .from('profiles')
        .update({
          tier,
          subscription_id:           sub.id,
          subscription_status:       'active',
          subscription_period:       period,
          subscription_next_billing: sub.billing_info?.next_billing_time,
          ...TIER_LIMITS[tier],
        })
        .eq('subscription_id', sub.id)

      console.info('[billing] Activated:', tier, period, sub.id)
    }

    if (type === 'BILLING.SUBSCRIPTION.RENEWED') {
      await supabase
        .from('profiles')
        .update({
          subscription_status:       'active',
          subscription_next_billing: sub.billing_info?.next_billing_time,
        })
        .eq('subscription_id', sub.id)
    }

    if (type === 'BILLING.SUBSCRIPTION.CANCELLED' ||
        type === 'BILLING.SUBSCRIPTION.EXPIRED'   ||
        type === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      await supabase
        .from('profiles')
        .update({
          tier:                'free',
          subscription_status: type.split('.').pop().toLowerCase(),
          ...TIER_LIMITS.free,
        })
        .eq('subscription_id', sub.id)

      console.info('[billing] Downgraded to free:', sub.id)
    }

    if (type === 'PAYMENT.SALE.COMPLETED') {
      // Payment received — log it
      await supabase.from('billing_events').insert({
        user_subscription_id: sub.billing_agreement_id,
        event_type:           'payment',
        amount:               sub.amount?.total,
        currency:             sub.amount?.currency,
        paypal_event_id:      event.id,
        created_at:           new Date().toISOString(),
      }).catch(() => {})  // non-critical
    }
  } catch (err) {
    console.error('[billing] Webhook handler error:', err.message)
  }

  res.json({ received: true })
})

// ── POST /api/billing/cancel ─────────────────────────────────────────────────
router.post('/cancel', async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('subscription_id')
    .eq('id', req.user.id)
    .single()

  if (!profile?.subscription_id) {
    return res.status(400).json({ error: 'No active subscription' })
  }

  try {
    const token = await getPayPalToken()
    await axios.post(
      `${PAYPAL_BASE}/v1/billing/subscriptions/${profile.subscription_id}/cancel`,
      { reason: 'User requested cancellation' },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    )

    await supabase
      .from('profiles')
      .update({ subscription_status: 'cancelled' })
      .eq('id', req.user.id)

    res.json({ cancelled: true })
  } catch (err) {
    const detail = err.response?.data?.message || err.message
    res.status(500).json({ error: `Cancel failed: ${detail}` })
  }
})

module.exports = router
