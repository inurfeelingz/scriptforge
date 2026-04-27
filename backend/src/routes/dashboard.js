// backend/src/routes/dashboard.js
// Dashboard-specific endpoints:
//   GET /api/dashboard/brief     — AI daily directive (cached 4h)
//   GET /api/dashboard/pipeline  — Episode pipeline state for kanban view
//   PATCH /api/dashboard/pipeline/:id/status — Advance episode status from kanban

const express  = require('express')
const { supabase } = require('../utils/supabase')
const { generateDailyBrief } = require('../services/dailyBrief')

const router = express.Router()

// ─── DAILY BRIEF ─────────────────────────────────────────────────────────────

router.get('/brief', async (req, res) => {
  const { categoryId } = req.query
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  try {
    const brief = await generateDailyBrief(req.user.id, categoryId)
    res.json(brief)
  } catch (err) {
    console.error('[dashboard/brief]', err.message)
    // Never fail hard — fall back to a safe default
    res.json({
      directive: 'Open Generate and start your next episode.',
      action:    'GENERATE',
      route:     '/generate',
      pipeline:  null,
      fromCache: false,
    })
  }
})

// ─── PIPELINE ────────────────────────────────────────────────────────────────
// Returns all episodes grouped by status lane for the kanban view.

router.get('/pipeline', async (req, res) => {
  const { categoryId } = req.query
  if (!categoryId) return res.status(400).json({ error: 'categoryId required' })

  const { data, error } = await supabase
    .from('episodes')
    .select('id, episode_number, track_name, track_mood, status, published_at, yt_retention_score, updated_at')
    .eq('user_id', req.user.id)
    .eq('category_id', categoryId)
    .order('episode_number', { ascending: false })
    .limit(50)

  if (error) return res.status(500).json({ error: error.message })

  const LANES = ['draft', 'ready', 'recorded', 'edited', 'published']
  const lanes = Object.fromEntries(LANES.map(l => [l, []]))

  for (const ep of data || []) {
    const lane = LANES.includes(ep.status) ? ep.status : 'draft'
    lanes[lane].push(ep)
  }

  res.json({ lanes, total: (data || []).length })
})

// ─── ADVANCE STATUS ───────────────────────────────────────────────────────────
// PATCH /api/dashboard/pipeline/:id/status
// Body: { status: 'ready' | 'recorded' | 'edited' | 'published' }
// One-tap status advancement from the kanban lane.

router.patch('/pipeline/:id/status', async (req, res) => {
  const { status } = req.body
  const VALID = ['draft', 'ready', 'recorded', 'edited', 'published']

  if (!VALID.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID.join(', ')}` })
  }

  const updates = {
    status,
    updated_at: new Date().toISOString(),
  }

  // Auto-set published_at when marking published
  if (status === 'published') {
    updates.published_at = new Date().toISOString()
  }

  const { data, error } = await supabase
    .from('episodes')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id)
    .select('id, episode_number, track_name, status, published_at')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ episode: data })
})

module.exports = router
