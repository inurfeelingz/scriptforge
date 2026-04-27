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