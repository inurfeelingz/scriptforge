// backend/src/routes/admin.js
// Admin-only management routes
// Mount in server.js: app.use('/api/admin', require('./routes/admin'))

const express = require('express')
const { supabase } = require('../utils/supabase')
const authMiddleware = require('../middleware/auth')

const router = express.Router()

// All admin routes require auth + is_admin flag
router.use(authMiddleware)
router.use((req, res, next) => {
  if (!req.profile?.is_admin) {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
})

// GET /api/admin/users — list all users with tier info
router.get('/users', async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name, tier, is_admin, episodes_this_month, max_episodes_pm, max_categories, created_at')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ users: data })
})

// PATCH /api/admin/users/:id/tier — change a user's tier
router.patch('/users/:id/tier', async (req, res) => {
  const { tier } = req.body
  const validTiers = ['free', 'pro', 'studio']

  if (!validTiers.includes(tier)) {
    return res.status(400).json({ error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` })
  }

  const limits = {
    free:   { max_episodes_pm: 8,    max_categories: 3    },
    pro:    { max_episodes_pm: 30,   max_categories: 10   },
    studio: { max_episodes_pm: 9999, max_categories: 9999 },
  }

  const { data, error } = await supabase
    .from('profiles')
    .update({ tier, ...limits[tier], updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id, email, tier, max_episodes_pm, max_categories')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ user: data })
})

// PATCH /api/admin/users/:id/admin — toggle admin flag
router.patch('/users/:id/admin', async (req, res) => {
  const { is_admin } = req.body

  const { data, error } = await supabase
    .from('profiles')
    .update({ is_admin: !!is_admin, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id, email, is_admin')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ user: data })
})

// POST /api/admin/reset-usage/:id — reset monthly episode count
router.post('/reset-usage/:id', async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .update({ episodes_this_month: 0, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select('id, email, episodes_this_month')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ user: data })
})

// GET /api/admin/stats — platform-wide stats
router.get('/stats', async (req, res) => {
  const [usersResult, episodesResult] = await Promise.all([
    supabase.from('profiles').select('tier', { count: 'exact' }),
    supabase.from('episodes').select('id', { count: 'exact' }),
  ])

  const tierCounts = (usersResult.data || []).reduce((acc, u) => {
    acc[u.tier] = (acc[u.tier] || 0) + 1
    return acc
  }, {})

  res.json({
    totalUsers:    usersResult.count || 0,
    totalEpisodes: episodesResult.count || 0,
    tierBreakdown: tierCounts,
  })
})

module.exports = router
// ── GET /api/admin/token-usage — aggregated token usage across all AI calls ──
router.get('/token-usage', async (req, res) => {
  const { data, error } = await supabase
    .from('token_usage_log')
    .select('action, input_tokens, output_tokens, cost_usd, created_at, user_id')
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) return res.status(500).json({ error: error.message })

  // Aggregate
  const totals = (data || []).reduce((acc, row) => {
    acc.input_tokens  += row.input_tokens  || 0
    acc.output_tokens += row.output_tokens || 0
    acc.cost_usd      += parseFloat(row.cost_usd || 0)
    acc.calls         += 1
    return acc
  }, { input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0 })

  // Group by action
  const byAction = {}
  for (const row of (data || [])) {
    const a = row.action || 'unknown'
    if (!byAction[a]) byAction[a] = { input_tokens: 0, output_tokens: 0, cost_usd: 0, calls: 0 }
    byAction[a].input_tokens  += row.input_tokens  || 0
    byAction[a].output_tokens += row.output_tokens || 0
    byAction[a].cost_usd      += parseFloat(row.cost_usd || 0)
    byAction[a].calls         += 1
  }

  res.json({ totals, byAction, recent: (data || []).slice(0, 50) })
})

// ── GET /api/admin/anthropic-balance — fetch live balance from Anthropic API ─
router.get('/anthropic-balance', async (req, res) => {
  try {
    const response = await fetch('https://api.anthropic.com/v1/organizations/billing', {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
    })

    if (!response.ok) {
      // Billing endpoint may not be available on all plans — try usage endpoint
      return res.json({ balance: null, error: 'Balance API not available — check console.anthropic.com', status: response.status })
    }

    const data = await response.json()
    res.json({
      balance:    data.credit_balance,
      currency:   data.currency || 'USD',
      lowCredit:  (data.credit_balance || 0) < 10,  // warn under $10
      rawData:    data,
    })
  } catch (err) {
    res.json({ balance: null, error: err.message })
  }
})